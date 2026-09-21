from __future__ import annotations

import io
import json
import math
import os
import re
import ssl
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import Lock, Thread
from typing import Any, Callable, Literal

import akshare as ak
import pandas as pd
import requests
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pypdf import PdfReader
from requests.adapters import HTTPAdapter
from urllib.parse import urljoin
from urllib3 import PoolManager


ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = Path(os.environ.get("STOCK_TOOL_CACHE_DIR") or ROOT / ".cache" / "stock_tool")
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CNINFO_HOME = "https://www.cninfo.com.cn/new/index"
EASTMONEY_QUOTE = "https://quote.eastmoney.com/"
EASTMONEY_F10 = "https://emweb.securities.eastmoney.com/PC_HSF10"
EASTMONEY_DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get"
THS_F10 = "https://basic.10jqka.com.cn/new"
BROWSER_HEADERS = {"User-Agent": "Mozilla/5.0"}
TZ = timezone(timedelta(hours=8))
CNINFO_JS_LOCK = Lock()
CNINFO_QUERY_LOCK = Lock()
CACHE_LOCKS: dict[str, Lock] = {}
CACHE_LOCK_GUARD = Lock()
_REQUEST = requests.sessions.Session.request
SourceMode = Literal["official", "strict", "structured"]
SearchScope = Literal["current", "extended"]


def _request_with_default_timeout(self: requests.Session, method: str, url: str, **kwargs: Any):
    kwargs.setdefault("timeout", 15)
    return _REQUEST(self, method, url, **kwargs)


requests.sessions.Session.request = _request_with_default_timeout


class TLS12Adapter(HTTPAdapter):
    def init_poolmanager(self, connections: int, maxsize: int, block: bool = False, **kwargs: Any):
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.maximum_version = ssl.TLSVersion.TLSv1_2
        kwargs["ssl_context"] = context
        self.poolmanager = PoolManager(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            **kwargs,
        )

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]
RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "60"))
RATE_LIMIT_HITS: dict[str, list[float]] = {}
RATE_LIMIT_LOCK = Lock()

app = FastAPI(title="A股信息查询本地服务", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def rate_limit_exceeded(client: str) -> bool:
    """Per-client sliding window. Protects the upstream sites, not the data."""
    if RATE_LIMIT_PER_MINUTE <= 0:
        return False
    now = time.time()
    with RATE_LIMIT_LOCK:
        hits = [stamp for stamp in RATE_LIMIT_HITS.get(client, []) if now - stamp < 60]
        if len(hits) >= RATE_LIMIT_PER_MINUTE:
            RATE_LIMIT_HITS[client] = hits
            return True
        hits.append(now)
        RATE_LIMIT_HITS[client] = hits
        if len(RATE_LIMIT_HITS) > 512:
            for stale in [key for key, value in RATE_LIMIT_HITS.items() if not value]:
                RATE_LIMIT_HITS.pop(stale, None)
        return False


@app.middleware("http")
async def limit_request_rate(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "")
        client = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
        if rate_limit_exceeded(client):
            return JSONResponse(
                status_code=429,
                content=response(
                    {},
                    [],
                    [f"请求过于频繁：每个来源每分钟最多 {RATE_LIMIT_PER_MINUTE} 次。该限制用于保护上游披露站点。"],
                    status="error",
                ),
            )
    return await call_next(request)


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def clean_scalar(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (datetime, pd.Timestamp, date)):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if hasattr(value, "item"):
        value = value.item()
    return value


def cache_file(key: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", key)
    return CACHE_DIR / f"{safe}.json"


COMPANY_CACHE_LIMIT = int(os.environ.get("COMPANY_CACHE_LIMIT", "5"))
MARGIN_CACHE_DAYS = int(os.environ.get("MARGIN_CACHE_DAYS", "24"))
COMPANY_CODE_IN_KEY = re.compile(r"(?<!\d)(\d{6})(?!\d)")
CACHE_EVICT_LOCK = Lock()


def cached_company_codes() -> dict[str, list[Path]]:
    groups: dict[str, list[Path]] = {}
    for path in CACHE_DIR.glob("*.json"):
        match = COMPANY_CODE_IN_KEY.search(path.stem)
        if match:
            groups.setdefault(match.group(1), []).append(path)
    return groups


def prune_company_cache(keep: str | None = None) -> list[str]:
    """Keep at most COMPANY_CACHE_LIMIT companies on disk, evicting least recently used."""
    with CACHE_EVICT_LOCK:
        groups = cached_company_codes()
        if len(groups) <= COMPANY_CACHE_LIMIT:
            return []
        recency = {
            code: max((path.stat().st_mtime for path in paths), default=0.0)
            for code, paths in groups.items()
        }
        if keep in recency:
            recency[keep] = time.time()
        ordered = sorted(recency, key=lambda code: recency[code], reverse=True)
        evicted: list[str] = []
        for code in ordered[COMPANY_CACHE_LIMIT:]:
            for path in groups[code]:
                try:
                    path.unlink()
                except OSError:
                    continue
            evicted.append(code)
        return evicted


def prune_margin_cache() -> int:
    """Daily margin snapshots cover the whole market and are shared across companies,
    so they are capped by count per exchange instead of by company."""
    removed = 0
    with CACHE_EVICT_LOCK:
        for exchange in ("SSE", "SZSE"):
            files = sorted(
                CACHE_DIR.glob(f"margin_{exchange}_*.json"),
                key=lambda path: path.stem,
                reverse=True,
            )
            for path in files[MARGIN_CACHE_DAYS:]:
                try:
                    path.unlink()
                    removed += 1
                except OSError:
                    continue
    return removed


def cache_lock(key: str) -> Lock:
    with CACHE_LOCK_GUARD:
        return CACHE_LOCKS.setdefault(key, Lock())


def cached(key: str, ttl_seconds: int, loader: Callable[[], Any], refresh: bool = False) -> Any:
    path = cache_file(key)

    def read_fresh() -> Any:
        if not path.exists() or time.time() - path.stat().st_mtime >= ttl_seconds:
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    if not refresh:
        value = read_fresh()
        if value is not None:
            return value
    with cache_lock(key):
        if not refresh:
            value = read_fresh()
            if value is not None:
                return value
        value = loader()
        _write_json_atomic(path, value)
        code = COMPANY_CODE_IN_KEY.search(path.stem)
        if code:
            prune_company_cache(code.group(1))
        return value


def frame_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame is None or frame.empty:
        return []
    return [
        {str(key): clean_scalar(value) for key, value in row.items()}
        for row in frame.to_dict(orient="records")
    ]


def source(
    source_id: str,
    publisher: str,
    title: str,
    url: str,
    *,
    period: str | None = None,
    published_at: str | None = None,
    tier: str = "official",
) -> dict[str, Any]:
    return {
        "source_id": source_id,
        "publisher": publisher,
        "title": title,
        "url": url,
        "period": period,
        "published_at": published_at,
        "retrieved_at": now_iso(),
        "tier": tier,
    }


def field(value: Any, source_id: str, period: str | None = None) -> dict[str, Any] | None:
    value = clean_scalar(value)
    if value is None or value == "" or not source_id:
        return None
    result = {"value": value, "source_id": source_id}
    if period:
        result["period"] = period
    return result


def response(
    data: Any,
    sources: list[dict[str, Any]],
    warnings: list[str],
    *,
    status: str | None = None,
) -> dict[str, Any]:
    if status is None:
        status = "partial" if warnings else ("ok" if data else "empty")
    return {
        "data": data,
        "sources": sources,
        "warnings": warnings,
        "as_of": now_iso(),
        "status": status,
    }


def normalize_code(raw: str) -> str:
    match = re.search(r"(\d{6})", raw)
    if not match:
        raise ValueError("股票代码必须为六位数字")
    return match.group(1)


def exchange_for(code: str) -> str:
    if code.startswith(("4", "8", "92")):
        return "BSE"
    if code.startswith(("0", "2", "3")):
        return "SZSE"
    return "SSE"


def market_label(code: str) -> str:
    return {"SSE": "上交所", "SZSE": "深交所", "BSE": "北交所"}[exchange_for(code)]


def quote_url(code: str) -> str:
    prefix = "bj" if exchange_for(code) == "BSE" else "sz" if exchange_for(code) == "SZSE" else "sh"
    return f"{EASTMONEY_QUOTE}{prefix}{code}.html"


def market_symbol(code: str, *, lower: bool = False) -> str:
    prefix = "BJ" if exchange_for(code) == "BSE" else "SZ" if exchange_for(code) == "SZSE" else "SH"
    symbol = f"{prefix}{code}"
    return symbol.lower() if lower else symbol


MASTER_SOURCES = {
    "sse-stock-list": ("上海证券交易所", "上交所股票列表", "https://www.sse.com.cn/assortment/stock/list/share/", "official"),
    "szse-stock-list": ("深圳证券交易所", "深交所股票列表", "https://www.szse.cn/market/product/stock/list/index.html", "official"),
    "bse-stock-list": ("北京证券交易所", "北交所股票列表", "https://www.bse.cn/nq/listedcompany.html", "official"),
    "eastmoney-stock-list": ("东方财富", "沪深北 A 股行情代码表", "https://quote.eastmoney.com/center/gridlist.html", "secondary"),
    "sina-stock-list": ("新浪财经", "沪深 A 股行情代码表", "https://vip.stock.finance.sina.com.cn/mkt/", "secondary"),
    "cninfo-company-list": (
        "巨潮资讯",
        "证券简称与代码列表",
        "https://www.cninfo.com.cn/new/data/szse_stock.json",
        "official",
    ),
}
MASTER_OFFICIAL_SOURCE = {
    "SSE": "sse-stock-list",
    "SZSE": "szse-stock-list",
    "BSE": "bse-stock-list",
}
MASTER_SOURCE_PRIORITY = {
    "sse-stock-list": 0,
    "szse-stock-list": 0,
    "bse-stock-list": 0,
    "eastmoney-stock-list": 1,
    "sina-stock-list": 2,
}
STOCK_MASTER_TTL = 24 * 3600
STOCK_MASTER_REFRESH_LOCK = Lock()


def master_source(source_id: str) -> dict[str, Any]:
    publisher, title, url, tier = MASTER_SOURCES[source_id]
    return source(source_id, publisher, title, url, tier=tier)


def szse_a_share_list() -> list[dict[str, Any]]:
    session = requests.Session()
    session.mount("https://www.szse.cn", TLS12Adapter())
    response_value = session.get(
        "https://www.szse.cn/api/report/ShowReport",
        params={
            "SHOWTYPE": "xlsx",
            "CATALOGID": "1110",
            "TABKEY": "tab1",
            "random": "0.6935816432433362",
        },
        headers={
            "Referer": "https://www.szse.cn/market/product/stock/list/index.html",
            "User-Agent": "Mozilla/5.0",
        },
        timeout=20,
    )
    response_value.raise_for_status()
    frame = pd.read_excel(io.BytesIO(response_value.content))
    frame["A股代码"] = (
        frame["A股代码"]
        .astype(str)
        .str.split(".", expand=True)
        .iloc[:, 0]
        .str.zfill(6)
    )
    return frame_records(frame)


def normalize_master_batch(
    rows: list[dict[str, Any]], source_id: str
) -> list[dict[str, str]]:
    output: list[dict[str, str]] = []
    for row in rows:
        raw_code = str(
            row.get("code")
            or row.get("代码")
            or row.get("证券代码")
            or row.get("A股代码")
            or ""
        )
        code_match = re.search(r"(\d{6})", raw_code.split(".")[0])
        code = code_match.group(1) if code_match else ""
        name = str(
            row.get("name")
            or row.get("名称")
            or row.get("证券简称")
            or row.get("A股简称")
            or ""
        ).strip()
        if not re.fullmatch(r"\d{6}", code) or not name:
            continue
        output.append(
            {
                "code": code,
                "name": name,
                "exchange": exchange_for(code),
                "market": market_label(code),
                "source_id": source_id,
            }
        )
    return output


def merge_stock_master_batches(
    batches: list[tuple[list[dict[str, Any]], str]],
    official_sources: set[str],
    stale: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    current: list[dict[str, str]] = []
    for rows, source_id in batches:
        current.extend(normalize_master_batch(rows, source_id))
    current.sort(key=lambda item: MASTER_SOURCE_PRIORITY[item["source_id"]])

    output: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in current:
        if item["code"] not in seen:
            seen.add(item["code"])
            output.append(item)

    missing_official_exchanges = {
        exchange
        for exchange, source_id in MASTER_OFFICIAL_SOURCE.items()
        if source_id not in official_sources
    }
    for item in stale or []:
        if (
            item.get("exchange") in missing_official_exchanges
            and item.get("code") not in seen
            and item.get("source_id") in MASTER_SOURCES
        ):
            seen.add(item["code"])
            output.append(item)
    return sorted(output, key=lambda item: item["code"])


def _read_stock_master_cache() -> list[dict[str, str]]:
    path = cache_file("stock_master")
    if not path.exists():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _write_json_atomic(path: Path, value: Any) -> None:
    temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.{threading.get_ident()}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, default=clean_scalar),
        encoding="utf-8",
    )
    temporary.replace(path)


SSE_STOCK_LIST = "https://query.sse.com.cn/sseQuery/commonQuery.do"


def sse_a_share_list() -> list[dict[str, Any]]:
    """上交所主板与科创板股票列表。响应接近两兆，用比全局默认更长的超时。"""
    rows: list[dict[str, Any]] = []
    for stock_type in ("1", "8"):
        payload = requests.get(
            SSE_STOCK_LIST,
            params={
                "STOCK_TYPE": stock_type,
                "REG_PROVINCE": "",
                "CSRC_CODE": "",
                "STOCK_CODE": "",
                "sqlId": "COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L",
                "COMPANY_STATUS": "2,4,5,7,8",
                "type": "inParams",
                "isPagination": "true",
                "pageHelp.cacheSize": "1",
                "pageHelp.beginPage": "1",
                "pageHelp.pageSize": "10000",
                "pageHelp.pageNo": "1",
                "pageHelp.endPage": "1",
            },
            headers={
                **BROWSER_HEADERS,
                "Host": "query.sse.com.cn",
                "Referer": "https://www.sse.com.cn/assortment/stock/list/share/",
            },
            timeout=90,
        )
        payload.raise_for_status()
        for item in (payload.json() or {}).get("result") or []:
            code = str(item.get("A_STOCK_CODE") or "").strip()
            if code:
                rows.append({"证券代码": code, "证券简称": str(item.get("SEC_NAME_CN") or "").strip()})
    return rows


def _refresh_stock_master(stale: list[dict[str, str]]) -> list[dict[str, str]]:
    with STOCK_MASTER_REFRESH_LOCK:
        official_loaders = (
            (sse_a_share_list, "sse-stock-list"),
            (szse_a_share_list, "szse-stock-list"),
            (lambda: frame_records(ak.stock_info_bj_name_code()), "bse-stock-list"),
        )
        batches: list[tuple[list[dict[str, Any]], str]] = []
        successful_sources: set[str] = set()
        with ThreadPoolExecutor(max_workers=len(official_loaders)) as pool:
            future_sources = {pool.submit(loader): source_id for loader, source_id in official_loaders}
            for future in as_completed(future_sources):
                try:
                    rows = future.result()
                    if rows:
                        source_id = future_sources[future]
                        batches.append((rows, source_id))
                        successful_sources.add(source_id)
                except Exception:
                    continue
        if not set(MASTER_OFFICIAL_SOURCE.values()) <= successful_sources:
            secondary_loaders = (
                (lambda: frame_records(ak.stock_zh_a_spot_em()), "eastmoney-stock-list"),
                (lambda: frame_records(ak.stock_zh_a_spot()), "sina-stock-list"),
            )
            with ThreadPoolExecutor(max_workers=len(secondary_loaders)) as pool:
                future_sources = {pool.submit(loader): source_id for loader, source_id in secondary_loaders}
                for future in as_completed(future_sources):
                    try:
                        rows = future.result()
                        if rows:
                            source_id = future_sources[future]
                            batches.append((rows, source_id))
                            successful_sources.add(source_id)
                    except Exception:
                        continue
        if not batches:
            if stale:
                return stale
            raise RuntimeError("沪深北官方与备用股票代码表均不可用")

        official_sources = successful_sources.intersection(MASTER_OFFICIAL_SOURCE.values())
        merged = merge_stock_master_batches(batches, official_sources, stale)
        if not merged:
            if stale:
                return stale
            raise RuntimeError("股票代码表响应为空")

        meta = {
            "refreshed_at": now_iso(),
            "official_sources": sorted(official_sources),
            "secondary_sources": sorted(
                successful_sources.intersection({"eastmoney-stock-list", "sina-stock-list"})
            ),
            "stale_fallback_exchanges": sorted(
                exchange
                for exchange, source_id in MASTER_OFFICIAL_SOURCE.items()
                if source_id not in official_sources
            ),
        }
        _write_json_atomic(cache_file("stock_master"), merged)
        _write_json_atomic(cache_file("stock_master_meta"), meta)
        return merged


def stock_master(refresh: bool = False) -> list[dict[str, str]]:
    path = cache_file("stock_master")
    stale = _read_stock_master_cache()
    is_fresh = path.exists() and time.time() - path.stat().st_mtime < STOCK_MASTER_TTL
    if stale and is_fresh and not refresh:
        return stale
    if stale and not refresh:
        if not STOCK_MASTER_REFRESH_LOCK.locked():
            Thread(target=_refresh_stock_master, args=(stale,), daemon=True).start()
        return stale
    return _refresh_stock_master(stale)


def normalize_cninfo_companies(
    payload: Any,
    current_codes: set[str],
) -> list[dict[str, str]]:
    if isinstance(payload, dict):
        rows = payload.get("stockList") or payload.get("data") or []
    else:
        rows = payload
    output: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows if isinstance(rows, list) else []:
        code = str(row.get("code") or row.get("证券代码") or "").strip().zfill(6)
        name = str(row.get("zwjc") or row.get("简称") or row.get("name") or "").strip()
        security_type = str(row.get("category") or row.get("证券类别") or "").strip()
        if (
            code in seen
            or not re.fullmatch(r"\d{6}", code)
            or not name
            or security_type not in {"A股", "B股", "CDR"}
        ):
            continue
        seen.add(code)
        output.append(
            {
                "code": code,
                "name": name,
                "exchange": exchange_for(code),
                "market": market_label(code),
                "source_id": "cninfo-company-list",
                "security_type": security_type,
                "listing_status": "current" if code in current_codes else "historical_or_other",
            }
        )
    return output


def extended_company_master(refresh: bool = False) -> list[dict[str, str]]:
    current = stock_master(refresh=False)
    current_codes = {item["code"] for item in current}

    def load() -> list[dict[str, str]]:
        response_value = requests.get(
            "https://www.cninfo.com.cn/new/data/szse_stock.json",
            headers={
                "Referer": CNINFO_HOME,
                "User-Agent": "Mozilla/5.0",
            },
            timeout=20,
        )
        response_value.raise_for_status()
        return normalize_cninfo_companies(response_value.json(), current_codes)

    historical = cached("cninfo_company_master", 24 * 3600, load, refresh)
    for item in historical:
        item["listing_status"] = (
            "current" if item["code"] in current_codes else "historical_or_other"
        )
    by_code = {item["code"]: item for item in historical}
    for item in current:
        by_code[item["code"]] = {
            **item,
            "security_type": "A股",
            "listing_status": "current",
        }
    return sorted(by_code.values(), key=lambda item: item["code"])


def stock_master_audit(items: list[dict[str, str]]) -> dict[str, Any]:
    codes = [item.get("code", "") for item in items]
    counts = {
        exchange: sum(item.get("exchange") == exchange for item in items)
        for exchange in MASTER_OFFICIAL_SOURCE
    }
    source_counts = {
        source_id: sum(item.get("source_id") == source_id for item in items)
        for source_id in MASTER_SOURCES
    }
    invalid_codes = sorted({code for code in codes if not re.fullmatch(r"\d{6}", code)})
    duplicate_count = len(codes) - len(set(codes))
    meta_path = cache_file("stock_master_meta")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    except (OSError, json.JSONDecodeError):
        meta = {}
    if not meta:
        master_path = cache_file("stock_master")
        meta = {
            "refreshed_at": (
                datetime.fromtimestamp(master_path.stat().st_mtime, TZ).isoformat(timespec="seconds")
                if master_path.exists()
                else None
            ),
            "official_sources": sorted(
                source_id
                for source_id in MASTER_OFFICIAL_SOURCE.values()
                if source_counts[source_id]
            ),
            "secondary_sources": sorted(
                source_id
                for source_id in ("eastmoney-stock-list", "sina-stock-list")
                if source_counts[source_id]
            ),
            "metadata_inferred_from_rows": True,
        }
    return {
        "total": len(items),
        "exchange_counts": counts,
        "source_counts": source_counts,
        "duplicate_count": duplicate_count,
        "invalid_codes": invalid_codes,
        "all_exchanges_present": all(counts.values()),
        "integrity_ok": duplicate_count == 0 and not invalid_codes and all(counts.values()),
        "refresh": meta,
    }


def lookup_company(code: str, refresh: bool = False) -> dict[str, str]:
    company = next((item for item in stock_master(refresh) if item["code"] == code), None)
    if not company:
        # 巨潮历史公司表不可用时按“查不到”处理，否则上游异常会直接冒成 500。
        try:
            extended = extended_company_master(refresh)
        except Exception:
            extended = []
        company = next((item for item in extended if item["code"] == code), None)
    if not company:
        raise ValueError(f"未在当前 A 股或巨潮历史公司列表中找到 {code}")
    return company


def first_value(row: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        if name in row and clean_scalar(row[name]) not in (None, ""):
            return clean_scalar(row[name])
    return None


def parse_date(value: Any) -> str | None:
    value = clean_scalar(value)
    if value is None:
        return None
    text = str(value)[:10].replace("/", "-")
    match = re.search(r"\d{4}-?\d{2}-?\d{2}", text)
    if not match:
        return text
    digits = re.sub(r"\D", "", match.group())
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"


def latest_report_source(code: str, refresh: bool = False) -> dict[str, Any] | None:
    records = filings_since(
        filing_index(code, refresh), (date.today() - timedelta(days=500)).isoformat()
    )
    records = [
        row
        for row in records
        if any(
            word in str(first_value(row, ("公告标题", "标题", "announcementTitle")) or "")
            for word in ("年度报告", "半年度报告", "季度报告")
        )
    ]
    if not records:
        return None
    row = records[0]
    title = first_value(row, ("公告标题", "标题", "announcementTitle")) or f"{code} 定期报告"
    url = first_value(row, ("公告链接", "网址", "url")) or CNINFO_HOME
    published = parse_date(first_value(row, ("公告时间", "公告日期", "announcementTime")))
    return source(
        f"cninfo-report-{code}-{published or 'latest'}",
        "巨潮资讯",
        str(title),
        str(url),
        published_at=published,
        period=str(title),
    )


def profile_records(code: str, refresh: bool = False) -> list[dict[str, Any]]:
    def load() -> list[dict[str, Any]]:
        with CNINFO_JS_LOCK:
            return frame_records(ak.stock_profile_cninfo(symbol=code))

    return cached(f"profile_{code}", 12 * 3600, load, refresh)


def profile_data(code: str, refresh: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    records = profile_records(code, refresh)
    if not records:
        return {}, source(f"cninfo-profile-{code}", "巨潮资讯", f"{code} 公司概况", CNINFO_HOME)
    row = records[0]
    src = source(f"cninfo-profile-{code}", "巨潮资讯", f"{code} 公司概况", CNINFO_HOME)
    mapping = {
        "company_name": ("公司名称", "公司全称"),
        "short_name": ("A股简称", "证券简称"),
        "legal_representative": ("法人代表", "法定代表人"),
        "registered_capital": ("注册资本", "注册资金"),
        "listing_date": ("上市日期",),
        "website": ("官方网站", "公司网址"),
        "office_address": ("办公地址",),
        "industry": ("所属行业", "行业"),
        "main_business": ("主营业务", "经营范围"),
    }
    data = {
        key: field(first_value(row, candidates), src["source_id"])
        for key, candidates in mapping.items()
    }
    return {key: value for key, value in data.items() if value}, src


def profile_data_structured(code: str, refresh: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    def load() -> list[dict[str, Any]]:
        return frame_records(ak.stock_individual_info_em(symbol=code))

    records = cached(f"profile_structured_{code}", 12 * 3600, load, refresh)
    values = {
        str(first_value(row, ("item", "项目")) or ""): first_value(row, ("value", "值"))
        for row in records
    }
    src = source(
        f"eastmoney-profile-{code}",
        "东方财富",
        f"{code} 结构化公司资料",
        quote_url(code),
        tier="secondary",
    )
    mapping = {
        "company_name": ("公司全称", "公司名称"),
        "short_name": ("股票简称",),
        "listing_date": ("上市时间", "上市日期"),
        "industry": ("行业",),
    }
    data = {
        key: field(next((values[name] for name in names if values.get(name) not in (None, "")), None), src["source_id"])
        for key, names in mapping.items()
    }
    return {key: value for key, value in data.items() if value}, src


def discover_company_icon(website: str) -> str:
    base_url = website.strip()
    if not re.match(r"^https?://", base_url, re.IGNORECASE):
        base_url = f"https://{base_url}"
    if not re.match(r"^https?://", base_url, re.IGNORECASE):
        raise ValueError("公司官网地址无效")
    homepage = requests.get(
        base_url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=15,
    )
    homepage.raise_for_status()
    for tag in re.findall(r"<link\b[^>]*>", homepage.text, flags=re.IGNORECASE):
        rel_match = re.search(r"\brel\s*=\s*['\"]([^'\"]+)['\"]", tag, flags=re.IGNORECASE)
        href_match = re.search(r"\bhref\s*=\s*['\"]([^'\"]+)['\"]", tag, flags=re.IGNORECASE)
        if rel_match and href_match and "icon" in rel_match.group(1).lower():
            return urljoin(homepage.url, href_match.group(1))
    raise ValueError("公司官网未声明站点图标")


@app.get("/api/company/{raw_code}/logo", response_class=RedirectResponse)
def company_logo(raw_code: str, refresh: bool = False) -> RedirectResponse:
    code = normalize_code(raw_code)
    lookup_company(code)
    profile, _ = profile_data(code, refresh=False)
    website = profile.get("website", {}).get("value")
    if not website:
        raise ValueError("公司概况未披露官方网站")
    logo_url = cached(
        f"company_logo_{code}",
        24 * 3600,
        lambda: discover_company_icon(str(website)),
        refresh,
    )
    return RedirectResponse(str(logo_url), status_code=307)


def number_or_none(value: Any, multiplier: float = 1) -> float | None:
    try:
        return float(value) * multiplier if value not in (None, "", "-") else None
    except (TypeError, ValueError):
        return None


def tencent_quote(code: str) -> dict[str, Any]:
    symbol = market_symbol(code, lower=True)
    response_value = requests.get(
        "https://qt.gtimg.cn/q=" + symbol,
        headers={
            "Referer": "https://stockapp.finance.qq.com/",
            "User-Agent": "Mozilla/5.0",
        },
        timeout=10,
    )
    response_value.raise_for_status()
    response_value.encoding = "gbk"
    match = re.search(r'="(.*)"', response_value.text)
    values = match.group(1).split("~") if match else []
    if len(values) < 47 or not values[3]:
        raise ValueError("腾讯行情响应缺少单股字段")
    raw_time = values[30]
    quote_time = (
        f"{raw_time[:4]}-{raw_time[4:6]}-{raw_time[6:8]} {raw_time[8:10]}:{raw_time[10:12]}:{raw_time[12:14]}"
        if re.fullmatch(r"\d{14}", raw_time)
        else raw_time
    )
    return {
        "name": values[1],
        "code": values[2],
        "latest": number_or_none(values[3]),
        "previous_close": number_or_none(values[4]),
        "open": number_or_none(values[5]),
        "volume_lots": number_or_none(values[36]),
        "amount": number_or_none(values[37], 10000),
        "change": number_or_none(values[31]),
        "change_percent": number_or_none(values[32]),
        "high": number_or_none(values[33]),
        "low": number_or_none(values[34]),
        "turnover_rate": number_or_none(values[38]),
        "pe_ratio": number_or_none(values[39]),
        "market_cap": number_or_none(values[44], 1e8),
        "float_market_cap": number_or_none(values[45], 1e8),
        "pb_ratio": number_or_none(values[46]),
        "quote_time": quote_time,
    }


@app.get("/api/company/{raw_code}/quote")
def company_quote(
    raw_code: str,
    refresh: bool = False,
    mode: SourceMode = "official",
) -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
        if mode == "strict":
            return response(
                {},
                [],
                ["仅官方来源模式不展示二手实时行情。"],
                status="empty",
            )
        source_id = f"tencent-quote-{code}"
        values = cached(f"quote_{code}", 30, lambda: tencent_quote(code), refresh)
        data = {
            key: field(value, source_id)
            for key, value in values.items()
            if key not in {"name", "code"} and value not in (None, "")
        }
        src = source(
            source_id,
            "腾讯证券",
            f"{code} 实时行情",
            f"https://gu.qq.com/{market_symbol(code, lower=True)}",
            tier="secondary",
        )
        return response(data, [src], [])
    except Exception as exc:
        return response({}, [], [f"实时行情获取失败：{type(exc).__name__}: {exc}"], status="error")


def _em_company_type(symbol: str) -> str:
    url = "https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/Index"
    html = requests.get(url, params={"type": "web", "code": symbol.lower()}, timeout=45).text
    match = re.search(r'id=["\']hidctype["\'][^>]*value=["\'](\d+)["\']', html)
    if not match:
        raise ValueError("无法识别东方财富财报公司类型")
    return match.group(1)


def _em_statement_rows(code: str, statement: str) -> list[dict[str, Any]]:
    symbol = market_symbol(code)
    company_type = _em_company_type(symbol)
    prefix = "lrb" if statement == "profit" else "zcfzb"
    base = "https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis"
    params = {"companyType": company_type, "reportDateType": "0", "code": symbol}
    dates_response = requests.get(f"{base}/{prefix}DateAjaxNew", params=params, timeout=45).json()
    date_rows = dates_response.get("data") or []
    dates = sorted(
        {parse_date(row.get("REPORT_DATE")) for row in date_rows if parse_date(row.get("REPORT_DATE"))},
        reverse=True,
    )
    if not dates:
        return []
    latest = dates[0]
    wanted = dates[:4]
    previous = f"{int(latest[:4]) - 1}{latest[4:]}"
    if previous in dates and previous not in wanted:
        wanted.append(previous)
    for item in dates:
        if item.endswith("-12-31") and item not in wanted:
            wanted.append(item)
        if len([value for value in wanted if value.endswith("-12-31")]) >= 5:
            break
    output: list[dict[str, Any]] = []
    for start_index in range(0, len(wanted), 5):
        detail_params = {
            **params,
            "reportType": "1",
            "dates": ",".join(wanted[start_index : start_index + 5]),
        }
        payload = requests.get(f"{base}/{prefix}AjaxNew", params=detail_params, timeout=45).json()
        output.extend(payload.get("data") or [])
    return [{str(key): clean_scalar(value) for key, value in row.items()} for row in output]


def financial_frames(code: str, refresh: bool = False) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    def profit() -> list[dict[str, Any]]:
        return _em_statement_rows(code, "profit")

    def balance() -> list[dict[str, Any]]:
        return _em_statement_rows(code, "balance")

    with ThreadPoolExecutor(max_workers=2) as pool:
        profit_future = pool.submit(cached, f"profit_{code}_q4", 12 * 3600, profit, refresh)
        balance_future = pool.submit(cached, f"balance_{code}_q4", 12 * 3600, balance, refresh)
        return profit_future.result(), balance_future.result()


def report_period(row: dict[str, Any]) -> str | None:
    return parse_date(first_value(row, ("REPORT_DATE", "REPORT_DATE_NAME", "报告日", "报告期")))


def prior_same_period(rows: list[dict[str, Any]], period: str | None) -> dict[str, Any] | None:
    if not period:
        return None
    try:
        target = f"{int(period[:4]) - 1}{period[4:]}"
    except ValueError:
        return None
    return next((row for row in rows if report_period(row) == target), None)


def financial_data(
    code: str, refresh: bool = False, link_official_report: bool = True
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    profits, balances = financial_frames(code, refresh)
    if not profits and not balances:
        return {}, [], ["未取得结构化财务报表。"]
    profits.sort(key=lambda row: report_period(row) or "", reverse=True)
    balances.sort(key=lambda row: report_period(row) or "", reverse=True)
    latest_profit = profits[0] if profits else {}
    latest_balance = balances[0] if balances else {}
    period = report_period(latest_profit) or report_period(latest_balance)
    prior_profit = prior_same_period(profits, period)
    prior_balance = prior_same_period(balances, period)
    secondary_id = f"eastmoney-financial-{code}-{period or 'latest'}"
    sources = [
        source(
            secondary_id,
            "东方财富",
            f"{code} 结构化财务报表",
            quote_url(code),
            period=period,
            tier="secondary",
        )
    ]
    if link_official_report:
        try:
            report_src = latest_report_source(code, refresh)
        except Exception:
            report_src = None
        if report_src:
            sources.append(report_src)
        else:
            warnings.append("未能回链最新定期报告原文；结构化财务数据仍标记为二手来源。")

    def metric(
        rows_now: dict[str, Any],
        rows_prior: dict[str, Any] | None,
        names: tuple[str, ...],
        yoy_names: tuple[str, ...] = (),
    ) -> dict[str, Any] | None:
        value = first_value(rows_now, names)
        if value is None:
            return None
        item: dict[str, Any] = {"value": value, "source_id": secondary_id, "period": period}
        previous = first_value(rows_prior or {}, names)
        if previous is not None:
            item["previous_value"] = previous
        yoy = first_value(rows_now, yoy_names)
        if yoy is None and previous not in (None, 0):
            try:
                yoy = (float(value) / float(previous) - 1) * 100
            except (TypeError, ValueError, ZeroDivisionError):
                yoy = None
        if yoy is not None:
            item["yoy_percent"] = clean_scalar(yoy)
        return item

    metrics = {
        "revenue": metric(
            latest_profit,
            prior_profit,
            ("TOTAL_OPERATE_INCOME", "OPERATE_INCOME", "营业总收入", "营业收入"),
            ("TOTAL_OPERATE_INCOME_YOY", "OPERATE_INCOME_YOY", "营业总收入同比"),
        ),
        "net_profit": metric(
            latest_profit,
            prior_profit,
            ("PARENT_NETPROFIT", "NETPROFIT", "归属于母公司股东的净利润", "净利润"),
            ("PARENT_NETPROFIT_YOY", "NETPROFIT_YOY", "归母净利润同比"),
        ),
        "contract_liabilities": metric(
            latest_balance,
            prior_balance,
            ("CONTRACT_LIAB", "合同负债"),
        ),
        "accounts_receivable": metric(
            latest_balance,
            prior_balance,
            ("ACCOUNTS_RECE", "ACCOUNT_RECE", "应收账款"),
        ),
    }
    annual: list[dict[str, Any]] = []
    for row in profits:
        row_period = report_period(row)
        if not row_period or not row_period.endswith("-12-31"):
            continue
        revenue = first_value(row, ("TOTAL_OPERATE_INCOME", "OPERATE_INCOME", "营业总收入", "营业收入"))
        profit = first_value(row, ("PARENT_NETPROFIT", "NETPROFIT", "归属于母公司股东的净利润", "净利润"))
        if revenue is not None or profit is not None:
            annual_source_id = f"eastmoney-financial-{code}-{row_period}"
            sources.append(
                source(
                    annual_source_id,
                    "东方财富",
                    f"{code} {row_period[:4]} 年度结构化财务报表",
                    quote_url(code),
                    period=row_period,
                    tier="secondary",
                )
            )
            annual.append(
                {
                    "period": row_period,
                    "revenue": revenue,
                    "net_profit": profit,
                    "source_id": annual_source_id,
                }
            )
        if len(annual) >= 5:
            break
    return (
        {
            "period": period,
            "metrics": {key: value for key, value in metrics.items() if value},
            "annual_metrics": annual,
        },
        sources,
        warnings,
    )


def business_segments(code: str, refresh: bool = False) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    symbol = market_symbol(code)

    def load() -> list[dict[str, Any]]:
        return frame_records(ak.stock_zygc_em(symbol=symbol))

    records = cached(f"segments_{code}", 12 * 3600, load, refresh)
    if not records:
        return [], None
    periods = sorted(
        {parse_date(first_value(row, ("报告日期", "REPORT_DATE"))) for row in records},
        reverse=True,
    )
    periods = [item for item in periods if item]
    period = next((item for item in periods if item.endswith(("-06-30", "-12-31"))), periods[0] if periods else None)
    rows = [row for row in records if parse_date(first_value(row, ("报告日期", "REPORT_DATE"))) == period]
    src = source(
        f"eastmoney-segments-{code}-{period}",
        "东方财富",
        f"{code} 主营构成",
        quote_url(code),
        period=period,
        tier="secondary",
    )
    result = []
    for row in rows:
        name = first_value(row, ("主营构成", "分类名称", "ITEM_NAME"))
        revenue = first_value(row, ("主营收入", "营业收入", "MAIN_BUSINESS_INCOME"))
        if name is None or revenue is None:
            continue
        result.append(
            {
                "category_type": first_value(row, ("分类类型", "分类方向")),
                "name": name,
                "revenue": revenue,
                "revenue_share_percent": number_or_none(first_value(row, ("收入比例", "主营收入占比")), 100),
                "gross_margin_percent": number_or_none(first_value(row, ("毛利率",)), 100),
                "period": period,
                "source_id": src["source_id"],
            }
        )
    return result, src


def shareholder_data(
    code: str, periods: list[str], refresh: bool = False
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    sources: list[dict[str, Any]] = []
    output: list[dict[str, Any]] = []
    quarter_periods = sorted(
        {p for p in periods if p and p[5:] in ("03-31", "06-30", "09-30", "12-31")},
        reverse=True,
    )
    successful_periods = 0
    for period in quarter_periods:
        compact = period.replace("-", "")

        def load(compact_date: str = compact) -> list[dict[str, Any]]:
            return frame_records(ak.stock_gdfx_top_10_em(symbol=market_symbol(code, lower=True), date=compact_date))

        try:
            records = cached(f"shareholders_{code}_{compact}", 12 * 3600, load, refresh)
        except ValueError:
            continue
        except Exception as exc:
            warnings.append(f"{period} 股东数据获取失败：{type(exc).__name__}")
            continue
        if not records:
            continue
        successful_periods += 1
        src = source(
            f"eastmoney-shareholders-{code}-{period}",
            "东方财富",
            f"{code} 前十大股东",
            quote_url(code),
            period=period,
            tier="secondary",
        )
        sources.append(src)
        for row in records[:10]:
            output.append(
                {
                    "period": period,
                    "name": first_value(row, ("股东名称", "HOLDER_NAME")),
                    "shares": first_value(row, ("持股数量", "持股数", "HOLD_NUM")),
                    "ratio_percent": first_value(row, ("占总股本持股比例", "持股比例", "HOLD_RATIO")),
                    "change": first_value(row, ("持股变动", "增减", "HOLD_NUM_CHANGE")),
                    "holder_type": first_value(row, ("股东性质", "股份类型", "HOLDER_TYPE")),
                    "source_id": src["source_id"],
                }
            )
        if successful_periods >= 2:
            break
    if not output:
        warnings.append("未取得最近两个已披露季度的前十大股东结构化数据。")
    return output, sources, warnings


@app.get("/api/market-brief")
def market_brief(refresh: bool = False) -> dict[str, Any]:
    def load() -> list[dict[str, Any]]:
        return frame_records(ak.stock_info_global_em())

    try:
        records = cached("market_headlines", 6 * 3600, load, refresh)
    except Exception as exc:
        return response(
            {"headlines": []},
            [],
            [f"财经头条获取失败：{type(exc).__name__}: {exc}"],
            status="error",
        )

    headlines: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    for index, row in enumerate(records[:8]):
        title = str(first_value(row, ("标题", "title")) or "").strip()
        url = str(first_value(row, ("链接", "url")) or "").strip()
        if not title or not url:
            continue
        published_at = str(first_value(row, ("发布时间", "时间", "published_at")) or "").strip() or None
        source_id = f"eastmoney-headline-{re.sub(r'[^0-9]', '', published_at or '')}-{index}"
        sources.append(
            source(
                source_id,
                "东方财富",
                title,
                url,
                published_at=published_at,
                tier="secondary",
            )
        )
        headlines.append(
            {
                "title": title,
                "summary": first_value(row, ("摘要", "summary")),
                "published_at": published_at,
                "url": url,
                "source_id": source_id,
            }
        )
    return response(
        {"headlines": headlines},
        sources,
        [] if headlines else ["当前未取得可链接的财经头条。"],
        status=None if headlines else "empty",
    )


def sector_source(
    kind: Literal["industry", "concept"],
    provider: Literal["eastmoney", "sina"],
    suffix: str = "",
) -> dict[str, Any]:
    label = "行业板块" if kind == "industry" else "概念板块"
    if provider == "sina":
        return source(
            f"sina-sector-{kind}{suffix}",
            "新浪财经",
            f"A股{label}实时行情",
            "https://finance.sina.com.cn/stock/sl/",
            tier="secondary",
        )
    return source(
        f"eastmoney-sector-{kind}{suffix}",
        "东方财富",
        f"A股{label}实时行情",
        f"https://quote.eastmoney.com/center/boardlist.html#{kind}_board",
        tier="secondary",
    )


@app.get("/api/sectors")
def sectors(
    kind: Literal["industry", "concept"] = "industry",
    refresh: bool = False,
) -> dict[str, Any]:
    eastmoney_loader = ak.stock_board_industry_name_em if kind == "industry" else ak.stock_board_concept_name_em

    def load() -> list[dict[str, Any]]:
        indicator = "新浪行业" if kind == "industry" else "概念"
        try:
            rows = frame_records(ak.stock_sector_spot(indicator=indicator))
            if rows:
                return [{**row, "_provider": "sina"} for row in rows]
        except Exception:
            pass
        return [
            {**row, "_provider": "eastmoney"}
            for row in frame_records(eastmoney_loader())
        ]

    try:
        records = cached(
            f"sector_boards_{kind}",
            5 * 60,
            load,
            refresh,
        )
    except Exception as exc:
        return response(
            {"kind": kind, "boards": []},
            [],
            [f"板块行情获取失败：{type(exc).__name__}: {exc}"],
            status="error",
        )

    provider: Literal["eastmoney", "sina"] = (
        "sina" if records and records[0].get("_provider") == "sina" else "eastmoney"
    )
    src = sector_source(kind, provider)
    boards: list[dict[str, Any]] = []
    for row in records:
        name = first_value(row, ("板块名称", "名称", "板块"))
        if not name:
            continue
        boards.append(
            {
                "name": name,
                "code": first_value(row, ("板块代码", "代码", "label")),
                "latest": first_value(row, ("最新价", "平均价格")),
                "change_percent": first_value(row, ("涨跌幅",)),
                "turnover_rate": first_value(row, ("换手率",)),
                "turnover_amount": first_value(row, ("成交额", "总成交额")),
                "market_cap": first_value(row, ("总市值",)),
                "advancers": first_value(row, ("上涨家数",)),
                "decliners": first_value(row, ("下跌家数",)),
                "leader": first_value(row, ("领涨股票", "股票名称")),
                "leader_change_percent": first_value(
                    row,
                    ("领涨股票-涨跌幅", "领涨股票涨跌幅", "个股-涨跌幅"),
                ),
                "source_id": src["source_id"],
            }
        )
    return response(
        {"kind": kind, "boards": boards},
        [src] if boards else [],
        [] if boards else ["当前未取得板块行情。"],
        status=None if boards else "empty",
    )


@app.get("/api/sectors/{kind}/{board_name}")
def sector_members(
    kind: Literal["industry", "concept"],
    board_name: str,
    board_code: str | None = None,
    refresh: bool = False,
) -> dict[str, Any]:
    eastmoney_loader = ak.stock_board_industry_cons_em if kind == "industry" else ak.stock_board_concept_cons_em

    def load() -> list[dict[str, Any]]:
        if board_code and not board_code.startswith("BK"):
            try:
                rows = frame_records(ak.stock_sector_detail(sector=board_code))
                if rows:
                    return [{**row, "_provider": "sina"} for row in rows]
            except Exception:
                pass
        try:
            rows = frame_records(eastmoney_loader(symbol=board_name))
            if rows:
                return [{**row, "_provider": "eastmoney"} for row in rows]
        except Exception:
            pass
        return []

    try:
        records = cached(
            f"sector_members_{kind}_{board_name}_{board_code or ''}",
            5 * 60,
            load,
            refresh,
        )
    except Exception as exc:
        return response(
            {"kind": kind, "name": board_name, "companies": []},
            [],
            [f"{board_name}成份行情获取失败：{type(exc).__name__}: {exc}"],
            status="error",
        )

    safe_name = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]", "", board_name)
    provider: Literal["eastmoney", "sina"] = (
        "sina" if records and records[0].get("_provider") == "sina" else "eastmoney"
    )
    src = sector_source(kind, provider, f"-{safe_name}")
    companies: list[dict[str, Any]] = []
    for row in records:
        code = first_value(row, ("代码", "证券代码", "code"))
        name = first_value(row, ("名称", "证券简称", "name"))
        if not code or not name:
            continue
        market_cap = first_value(row, ("总市值", "mktcap"))
        if provider == "sina" and market_cap is not None:
            market_cap = float(market_cap) * 10000
        companies.append(
            {
                "code": str(code).zfill(6),
                "name": name,
                "latest": first_value(row, ("最新价", "trade")),
                "change_percent": first_value(row, ("涨跌幅", "changepercent")),
                "turnover_rate": first_value(row, ("换手率", "turnoverratio")),
                "amount": first_value(row, ("成交额", "amount")),
                "market_cap": market_cap,
                "pe_ratio": first_value(row, ("市盈率-动态", "市盈率", "per")),
                "source_id": src["source_id"],
            }
        )
    return response(
        {"kind": kind, "name": board_name, "companies": companies},
        [src] if companies else [],
        [] if companies else [f"当前未取得{board_name}成份行情。"],
        status=None if companies else "empty",
    )


@app.get("/api/search")
def search(
    q: str = Query(min_length=1),
    scope: SearchScope = "current",
    refresh: bool = False,
) -> dict[str, Any]:
    try:
        items = extended_company_master(refresh) if scope == "extended" else stock_master(refresh)
        keyword = q.strip().lower()
        exact = [item for item in items if keyword in (item["code"].lower(), item["name"].lower())]
        fuzzy = [
            item
            for item in items
            if item not in exact and (keyword in item["code"].lower() or keyword in item["name"].lower())
        ]
        results = (exact + fuzzy)[:20]
        source_ids = {item["source_id"] for item in results}
        sources = [master_source(source_id) for source_id in source_ids]
        return response(
            results,
            sources,
            [] if results else [
                "没有匹配的当前上市 A 股。"
                if scope == "current"
                else "没有匹配的当前或历史上市公司、B 股或 CDR。"
            ],
            status=None if results else "empty",
        )
    except Exception as exc:
        return response([], [], [f"股票代码表获取失败：{type(exc).__name__}: {exc}"], status="error")


@app.get("/api/company/{raw_code}/overview")
def overview(raw_code: str, refresh: bool = False, mode: SourceMode = "official") -> dict[str, Any]:
    warnings: list[str] = []
    sources: list[dict[str, Any]] = []
    try:
        code = normalize_code(raw_code)
        company = lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")

    master_src = master_source(company["source_id"])
    if mode != "strict" or master_src["tier"] == "official":
        sources.append(master_src)
    else:
        warnings.append("当前股票代码表记录来自二手回退源；仅官方模式未将其写入响应字段。")

    profile: dict[str, Any] = {}
    financial: dict[str, Any] = {}
    segments: list[dict[str, Any]] = []
    shareholders: list[dict[str, Any]] = []
    periods = [
        f"{year}-{suffix}"
        for year in range(date.today().year, date.today().year - 3, -1)
        for suffix in ("12-31", "09-30", "06-30", "03-31")
        if f"{year}-{suffix}" <= date.today().isoformat()
    ]

    def load_profile():
        return profile_data_structured(code, refresh) if mode == "structured" else profile_data(code, refresh)

    def load_financial():
        return financial_data(code, refresh, mode == "official")

    with ThreadPoolExecutor(max_workers=4) as pool:
        profile_future = pool.submit(load_profile)
        financial_future = pool.submit(load_financial) if mode != "strict" else None
        segments_future = pool.submit(business_segments, code, refresh) if mode != "strict" else None
        shareholders_future = pool.submit(shareholder_data, code, periods, refresh) if mode != "strict" else None

        try:
            profile, profile_src = profile_future.result()
            sources.append(profile_src)
        except Exception as exc:
            warnings.append(f"公司概况获取失败：{type(exc).__name__}: {exc}")

        if mode == "strict":
            warnings.append("仅官方来源模式未展示缺少官方结构化接口的财务、主营构成和股东数值。")
        else:
            try:
                financial, financial_sources, financial_warnings = financial_future.result()
                sources.extend(financial_sources)
                warnings.extend(financial_warnings)
            except Exception as exc:
                warnings.append(f"财务数据获取失败：{type(exc).__name__}: {exc}")
            try:
                segments, segment_src = segments_future.result()
                if segment_src:
                    sources.append(segment_src)
                else:
                    warnings.append("未取得最近年报或半年报主营构成。")
            except Exception as exc:
                warnings.append(f"主营构成获取失败：{type(exc).__name__}: {exc}")
            try:
                shareholders, shareholder_sources, shareholder_warnings = shareholders_future.result()
                sources.extend(shareholder_sources)
                warnings.extend(shareholder_warnings)
            except Exception as exc:
                warnings.append(f"股东数据获取失败：{type(exc).__name__}: {exc}")

    identity_src = master_src["source_id"]
    identity = {}
    if mode != "strict" or master_src["tier"] == "official":
        identity = {
            "code": field(code, identity_src),
            "name": field(company["name"], identity_src),
            "exchange": field(company["exchange"], identity_src),
            "market": field(company["market"], identity_src),
        }
    data = {
        "identity": {key: value for key, value in identity.items() if value},
        "profile": profile,
        "financial": financial,
        "shareholders": shareholders,
        "business_segments": segments,
    }
    return response(data, sources, warnings)


def margin_rows_for_date(exchange: str, trade_date: str) -> list[dict[str, Any]]:
    if exchange == "SSE":
        rows = frame_records(ak.stock_margin_detail_sse(date=trade_date))
    elif exchange == "SZSE":
        rows = frame_records(ak.stock_margin_detail_szse(date=trade_date))
    else:
        return []
    return rows


def margin_item(code: str, row: dict[str, Any], trade_date: str, source_id: str) -> dict[str, Any]:
    return {
        "date": f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:]}",
        "financing_buy": first_value(row, ("融资买入额",)),
        "financing_repay": first_value(row, ("融资偿还额",)),
        "financing_balance": first_value(row, ("融资余额",)),
        "securities_lending_sell": first_value(row, ("融券卖出量", "融券卖出量（股）")),
        "securities_lending_repay": first_value(row, ("融券偿还量",)),
        "securities_lending_balance": first_value(row, ("融券余额", "融券余量")),
        "margin_total": first_value(row, ("融资融券余额",)),
        "source_id": source_id,
    }


@app.get("/api/company/{raw_code}/capital")
def capital(
    raw_code: str,
    days: int = Query(20, ge=1, le=60),
    refresh: bool = False,
    mode: SourceMode = "official",
) -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")
    exchange = exchange_for(code)
    if exchange == "BSE":
        return response(
            {"daily_margin": [], "institution_signals": []},
            [],
            ["当前连接器未提供可稳定核验的北交所逐股日频两融数据；未使用资金流估算替代。"],
            status="empty",
        )
    publisher = "上海证券交易所" if exchange == "SSE" else "深圳证券交易所"
    url = (
        "https://www.sse.com.cn/market/othersdata/margin/detail/"
        if exchange == "SSE"
        else "https://www.szse.cn/marketServices/deal/finance/index.html"
    )
    candidates: list[str] = []
    cursor = date.today()
    while len(candidates) < max(days + 12, 18):
        if cursor.weekday() < 5:
            candidates.append(cursor.strftime("%Y%m%d"))
        cursor -= timedelta(days=1)
    found: list[dict[str, Any]] = []
    warnings: list[str] = []

    def fetch(day: str) -> tuple[str, list[dict[str, Any]]]:
        all_rows = cached(
            f"margin_{exchange}_{day}",
            6 * 3600,
            lambda: margin_rows_for_date(exchange, day),
            refresh,
        )
        rows = [
            row
            for row in all_rows
            if str(first_value(row, ("标的证券代码", "证券代码", "代码")) or "").zfill(6) == code
        ]
        return day, rows

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch, day): day for day in candidates}
        for future in as_completed(futures):
            day = futures[future]
            try:
                _, rows = future.result()
                if rows:
                    found.append((day, rows[0]))
            except Exception:
                continue
    prune_margin_cache()
    found.sort(key=lambda item: item[0], reverse=True)
    found = found[:days]
    if not found:
        return response(
            {"daily_margin": [], "institution_signals": []},
            [],
            ["未找到该证券最近交易日的官方两融明细；可能并非融资融券标的，或交易所接口暂时不可用。"],
            status="empty",
        )
    source_id = f"{exchange.lower()}-margin-{code}"
    src = source(source_id, publisher, f"{code} 融资融券交易明细", url)
    daily = [margin_item(code, row, day, source_id) for day, row in reversed(found)]
    for index, item in enumerate(daily):
        if index == 0:
            item["financing_balance_change"] = None
            continue
        current = item.get("financing_balance")
        previous = daily[index - 1].get("financing_balance")
        try:
            item["financing_balance_change"] = float(current) - float(previous)
        except (TypeError, ValueError):
            item["financing_balance_change"] = None
    warnings.append("未将商业平台“主力资金净流入”视为机构资金；日频机构净买卖没有统一官方完整口径。")
    if mode == "structured":
        warnings.append("两融模块仍使用交易所逐股明细；结构化优先模式不以商业资金流估算替代官方口径。")
    return response({"daily_margin": daily, "institution_signals": []}, [src], warnings)


CONTRACT_WORDS = ("合同", "中标", "订单", "框架协议", "重大项目")


def extract_contract_fields(url: str) -> dict[str, str]:
    if ".pdf" not in url.lower():
        return {}
    raw = requests.get(url, timeout=15).content
    reader = PdfReader(io.BytesIO(raw))
    text = "\n".join((page.extract_text() or "") for page in reader.pages[:12])
    fields: dict[str, str] = {}
    patterns = {
        "counterparty": r"(?:交易对方|合同对方|甲方|招标人)[：:\s]{1,4}([^\n；;]{2,80})",
        "amount_text": r"(?:合同金额|中标金额|交易金额)[：:\s]{1,4}([^\n；;]{1,60})",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        if match:
            fields[key] = re.sub(r"\s+", "", match.group(1)).strip("。")
    return fields


@app.get("/api/company/{raw_code}/contracts")
def contracts(
    raw_code: str,
    months: int = Query(24, ge=1, le=60),
    refresh: bool = False,
    mode: SourceMode = "official",
) -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response([], [], [str(exc)], status="error")
    end = date.today()
    start = end - timedelta(days=round(months * 30.44))
    try:
        records = filings_since(filing_index(code, refresh), start.isoformat())
    except Exception as exc:
        return response([], [], [f"巨潮公告查询失败：{type(exc).__name__}: {exc}"], status="error")
    matches = []
    sources = []
    for index, row in enumerate(records):
        title = str(first_value(row, ("公告标题", "标题", "announcementTitle")) or "")
        if not any(word in title for word in CONTRACT_WORDS):
            continue
        published = parse_date(first_value(row, ("公告时间", "公告日期", "announcementTime")))
        url = str(first_value(row, ("公告链接", "网址", "url")) or CNINFO_HOME)
        source_id = f"cninfo-contract-{code}-{published or index}"
        provider = str(row.get("_provider") or "巨潮资讯")
        src = source(source_id, provider, title, url, published_at=published)
        sources.append(src)
        item: dict[str, Any] = {
            "title": title,
            "published_at": published,
            "url": url,
            "source_id": source_id,
        }
        matches.append(item)
    if mode != "structured" and matches:
        def contract_fields(index: int, item: dict[str, Any]) -> tuple[int, dict[str, str]]:
            cache_key = f"contract_fields_{code}_{item.get('published_at') or index}_{index}"
            fields = cached(
                cache_key,
                30 * 24 * 3600,
                lambda: extract_contract_fields(str(item["url"])),
                refresh,
            )
            return index, fields

        with ThreadPoolExecutor(max_workers=min(4, len(matches))) as pool:
            futures = [pool.submit(contract_fields, index, item) for index, item in enumerate(matches)]
            for future in as_completed(futures):
                try:
                    index, extracted = future.result()
                    matches[index].update(extracted)
                except Exception:
                    continue
    warnings = [] if matches else [f"最近 {months} 个月未检索到标题含合同、中标、订单、框架协议或重大项目的公告。"]
    if not sources:
        sources.append(
            source(
                f"cninfo-contract-search-{code}",
                "巨潮资讯",
                f"{code} 最近 {months} 个月公告检索",
                "https://www.cninfo.com.cn/new/disclosure",
                period=f"{start.isoformat()} 至 {end.isoformat()}",
            )
        )
    return response(matches, sources, warnings, status=None if matches else "empty")


def current_industry(code: str, refresh: bool = False) -> tuple[str | None, dict[str, Any] | None]:
    start = (date.today() - timedelta(days=3650)).strftime("%Y%m%d")
    end = date.today().strftime("%Y%m%d")

    def load() -> list[dict[str, Any]]:
        with CNINFO_JS_LOCK:
            return frame_records(ak.stock_industry_change_cninfo(symbol=code, start_date=start, end_date=end))

    records = cached(f"industry_{code}", 24 * 3600, load, refresh)
    if not records:
        return None, None
    row = records[-1]
    name = first_value(row, ("行业名称", "证监会行业名称", "行业门类"))
    src = source(f"cninfo-industry-{code}", "巨潮资讯", f"{code} 行业归属", CNINFO_HOME)
    return str(name) if name else None, src


@app.get("/api/company/{raw_code}/peers")
def peers(raw_code: str, refresh: bool = False, mode: SourceMode = "official") -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")
    sources: list[dict[str, Any]] = []
    warnings: list[str] = []
    industry_src: dict[str, Any] | None = None
    board_name = ""
    try:
        if mode == "structured":
            profile, industry_src = profile_data_structured(code, refresh)
            industry_field = profile.get("industry")
            industry = str(industry_field["value"]) if industry_field else None
            board_name = industry or ""
            sources.append(industry_src)
        else:
            profile, industry_src = profile_data(code)
            industry_field = profile.get("industry")
            industry = str(industry_field["value"]) if industry_field else None
            sources.append(industry_src)
            if not industry:
                industry, industry_src = current_industry(code, refresh)
                if industry_src:
                    sources.append(industry_src)
    except Exception as exc:
        return response({}, [], [f"行业归属查询失败：{type(exc).__name__}: {exc}"], status="error")
    if not industry:
        return response({}, sources, ["未取得可核验的行业归属，未生成同业名单。"], status="empty")
    if mode == "strict":
        return response(
            {"industry": field(industry, industry_src["source_id"] if industry_src else "")},
            sources,
            ["仅官方来源模式展示官方行业归属，但不使用二手行业板块生成同业名单。"],
            status="partial",
        )
    try:
        if not board_name:
            try:
                info_rows = frame_records(ak.stock_individual_info_em(symbol=code))
                industry_row = next(
                    (row for row in info_rows if str(first_value(row, ("item", "项目")) or "") == "行业"),
                    None,
                )
                board_name = str(first_value(industry_row or {}, ("value", "值")) or "")
                if board_name:
                    classification_src = source(
                        f"eastmoney-industry-classification-{code}",
                        "东方财富",
                        f"{code} 行业板块分类",
                        quote_url(code),
                        tier="secondary",
                    )
                    sources.append(classification_src)
            except Exception:
                pass
        if not board_name:
            boards = frame_records(
                cached("industry_boards", 24 * 3600, lambda: frame_records(ak.stock_board_industry_name_em()), refresh)
            )
            board = next(
                (
                    row
                    for row in boards
                    if str(first_value(row, ("板块名称", "名称")) or "") in industry
                    or industry in str(first_value(row, ("板块名称", "名称")) or "")
                ),
                None,
            )
            board_name = str(first_value(board or {}, ("板块名称", "名称")) or "")
        if not board_name:
            return response(
                {"industry": field(industry, industry_src["source_id"] if industry_src else "")},
                sources,
                ["官方行业名称未能与二手行业板块一一匹配，未生成同业名单。"],
                status="partial",
            )
        members = cached(
            f"industry_members_{board_name}",
            24 * 3600,
            lambda: frame_records(ak.stock_board_industry_cons_em(symbol=board_name)),
            refresh,
        )
        peer_src = source(
            f"eastmoney-industry-{board_name}",
            "东方财富",
            f"{board_name} 行业板块成份",
            "https://quote.eastmoney.com/center/boardlist.html",
            tier="secondary",
        )
        sources.append(peer_src)
        peer_rows = []
        for row in members:
            peer_code = str(first_value(row, ("代码", "证券代码")) or "").zfill(6)
            if peer_code == code or not re.fullmatch(r"\d{6}", peer_code):
                continue
            peer_rows.append(
                {
                    "code": peer_code,
                    "name": first_value(row, ("名称", "证券简称")),
                    "latest_price": first_value(row, ("最新价",)),
                    "market_cap": first_value(row, ("总市值",)),
                    "source_id": peer_src["source_id"],
                }
            )
            if len(peer_rows) >= 10:
                break
        return response(
            {
                "label": "同业可比公司",
                "industry": field(industry, industry_src["source_id"] if industry_src else ""),
                "board_name": field(board_name, peer_src["source_id"]),
                "companies": peer_rows,
            },
            sources,
            warnings,
        )
    except Exception as exc:
        return response(
            {"industry": field(industry, industry_src["source_id"] if industry_src else "")},
            sources,
            [f"同业成份查询失败：{type(exc).__name__}: {exc}"],
            status="partial",
        )


def em_f10(module: str, page: str, params: dict[str, Any]) -> dict[str, Any]:
    value = requests.get(f"{EASTMONEY_F10}/{module}/{page}", params=params, headers=BROWSER_HEADERS, timeout=30)
    value.raise_for_status()
    return value.json()


def em_datacenter(report_name: str, columns: str, filters: str, sort: str, page_size: int = 50) -> list[dict[str, Any]]:
    value = requests.get(
        EASTMONEY_DATACENTER,
        params={
            "reportName": report_name,
            "columns": columns,
            "filter": filters,
            "sortColumns": sort,
            "sortTypes": "-1",
            "pageSize": str(page_size),
            "pageNumber": "1",
            "source": "WEB",
            "client": "WEB",
        },
        headers=BROWSER_HEADERS,
        timeout=30,
    )
    value.raise_for_status()
    result = value.json().get("result") or {}
    return [
        {str(key): clean_scalar(item) for key, item in row.items()}
        for row in (result.get("data") or [])
    ]


def ths_page(code: str, page: str, refresh: bool = False) -> str:
    def load() -> str:
        value = requests.get(f"{THS_F10}/{code}/{page}.html", headers=BROWSER_HEADERS, timeout=30)
        value.raise_for_status()
        value.encoding = "gbk"
        return value.text

    return cached(f"ths_{page}_{code}", 12 * 3600, load, refresh)


def strip_tags(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


THS_PARTNER_ROW = re.compile(
    r'<div class="clientname">([^<]*)</div>\s*</td>\s*<td class="tc">([^<]*)</td>\s*<td class="tc">([^<]*)</td>'
)
THS_PERSON_INTRO = re.compile(
    r'class="title">\s*<h3>\s*([^<]+?)\s*</h3>.*?class="mainintro">\s*<div>\s*<p>(.*?)</p>',
    re.S,
)
CONTROL_LABELS = (
    ("控股股东", "controlling_shareholder"),
    ("实际控制人", "actual_controller"),
    ("最终控制人", "ultimate_controller"),
)


def ths_partners(html: str) -> dict[str, Any]:
    start = html.find('id="provider"')
    if start < 0:
        return {}
    section = html[start:]
    period = re.search(r'class="operateTab"[^>]*>(\d{4}-\d{2}-\d{2})<', section)
    result: dict[str, Any] = {"period": period.group(1) if period else None}
    for label, key, total_pattern in (
        ("客户名称", "customers", r"前5大客户：共销售了<i>([^<]*)</i>元,占([^<]*)的<i>([^<]*)</i>"),
        ("供应商名称", "suppliers", r"前5大供应商：共采购了<i>([^<]*)</i>元,占([^<]*)的<i>([^<]*)</i>"),
    ):
        index = section.find(label)
        rows = (
            THS_PARTNER_ROW.findall(section[index : section.find("</table>", index)])
            if index >= 0
            else []
        )
        result[key] = [
            {"name": name.strip(), "amount_text": amount.strip(), "share_text": share.strip()}
            for name, amount, share in rows
        ]
        total = re.search(total_pattern, section)
        if total:
            result[f"{key}_total"] = {
                "amount_text": total.group(1),
                "denominator": total.group(2),
                "share_text": total.group(3),
            }
    return result


def ths_control_chain(html: str) -> dict[str, Any]:
    people = {name: strip_tags(intro) for name, intro in THS_PERSON_INTRO.findall(html)}
    chain: dict[str, Any] = {}
    for label, key in CONTROL_LABELS:
        match = re.search(rf">{label}：</strong>(.*?)</div>", html, re.S)
        if not match:
            continue
        text = strip_tags(match.group(1))
        name = re.split(r"[（(]", text)[0].strip()
        if not name:
            continue
        ratio = re.search(r"比例：([\d.]+)\s*%", text)
        item: dict[str, Any] = {"name": name}
        if ratio:
            item["ratio_percent"] = float(ratio.group(1))
        if name in people:
            item["resume"] = people[name]
        chain[key] = item
    return chain


CNINFO_PDF = "http://static.cninfo.com.cn/finalpage/{day}/{announcement_id}.PDF"
FILING_NOISE = (
    re.compile(r"\S{2,25}\s*20\d{2}\s*年(年度|半年度)报告(全文)?\s*\d{0,4}"),
    re.compile(r"\S{2,40}(募集说明书|招股说明书)(（[^）]{0,12}）)?\s*[\d\-]{0,10}"),
)
PARTNER_TABLE_ROW = re.compile(r"(\d{1,2})\s+(.{1,40}?)\s+([\d,]+\.\d{2})\s+([\d.]+)\s*%")
PARTNER_STARTS = (
    "公司主要销售客户情况",
    "主要销售客户及主要供应商情况",
    "前五名客户合计销售金额",
    "前五名客户销售额",
    "前五名客户",
)
PARTNER_STOPS = ("2.2.2.2", "3、费用", "报告期内公司贸易业务", "费用 单位", "研发投入")
AMOUNT_UNITS = {"元": 1, "万元": 10**4, "百万元": 10**6, "亿元": 10**8}


def partner_totals(text: str, label: str) -> dict[str, Any]:
    match = re.search(
        rf"前五(?:名|大){label}([^%。；]{{0,32}}?)([\d][\d,]*\.?\d*)\s*(亿元|百万元|万元|元|)",
        text,
    )
    if not match:
        return {}
    unit = match.group(3) or ("元" if "（元）" in match.group(1) else "")
    result: dict[str, Any] = {"amount_text": f"{match.group(2)}{unit}"}
    if unit in AMOUNT_UNITS:
        result["amount"] = clean_scalar(float(match.group(2).replace(",", "")) * AMOUNT_UNITS[unit])
    share = re.search(r"([\d.]+)\s*%", text[match.end() : match.end() + 90])
    if share:
        result["share_percent"] = float(share.group(1))
    return result


def parse_partner_section(section_text: str | None) -> dict[str, Any]:
    if not section_text:
        return {}
    result: dict[str, Any] = {}
    for key, label, row_label in (("customers", "客户", "客户名称"), ("suppliers", "供应商", "供应商名称")):
        totals = partner_totals(section_text, label)
        header = section_text.find(row_label)
        rows: list[dict[str, Any]] = []
        if header >= 0:
            body = section_text[header:]
            body = body[: body.find("合计")] if "合计" in body else body
            for rank, name, amount, share in PARTNER_TABLE_ROW.findall(body):
                if int(rank) != len(rows) + 1:
                    continue
                rows.append(
                    {
                        "rank": int(rank),
                        "name": re.sub(r"\s+", "", name),
                        "amount": float(amount.replace(",", "")),
                        "share_percent": float(share),
                    }
                )
        if totals or rows:
            result[key] = {**totals, "rows": rows}
    related = re.search(r"关联方[^%]{0,24}?([\d.]+)\s*%", section_text)
    if related:
        result["related_party_share_percent"] = float(related.group(1))
    return result


EASTMONEY_ANN_LIST = "https://np-anotice-stock.eastmoney.com/api/security/ann"
EASTMONEY_ANN_PAGE = "https://data.eastmoney.com/notices/detail/{code}/{art_code}.html"
EASTMONEY_ANN_PDF = "https://pdf.dfcfw.com/pdf/H2_{art_code}_1.pdf"
SZSE_ANN_LIST = "https://www.szse.cn/api/disc/announcement/annList"
SZSE_ANN_PAGE = "https://www.szse.cn/disclosure/listed/bulletinDetail/index.html?{ann_id}"
SZSE_ANN_PDF = "https://disc.static.szse.cn/download{path}"
SSE_ANN_LIST = "https://query.sse.com.cn/security/stock/queryCompanyBulletin.do"


def cninfo_disclosure(code: str, start: date) -> list[dict[str, Any]]:
    rows = frame_records(
        ak.stock_zh_a_disclosure_report_cninfo(
            symbol=code,
            market="沪深京",
            start_date=start.strftime("%Y%m%d"),
            end_date=date.today().strftime("%Y%m%d"),
        )
    )
    return [{**row, "_provider": "巨潮资讯"} for row in rows]


def eastmoney_disclosure(code: str, start: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for page in range(1, 16):
        payload = requests.get(
            EASTMONEY_ANN_LIST,
            params={
                "page_size": "100",
                "page_index": str(page),
                "ann_type": "A",
                "client_source": "web",
                "stock_list": code,
                "f_node": "0",
                "s_node": "0",
            },
            headers={**BROWSER_HEADERS, "Referer": "https://data.eastmoney.com/notices/"},
            timeout=25,
        )
        payload.raise_for_status()
        items = ((payload.json() or {}).get("data") or {}).get("list") or []
        if not items:
            break
        for item in items:
            published = str(item.get("notice_date") or "")[:10]
            art_code = str(item.get("art_code") or "")
            if not published or not art_code:
                continue
            rows.append(
                {
                    "公告标题": str(item.get("title") or ""),
                    "公告时间": published,
                    "公告链接": EASTMONEY_ANN_PAGE.format(code=code, art_code=art_code),
                    "pdf_url": EASTMONEY_ANN_PDF.format(art_code=art_code),
                    "_provider": "东方财富",
                }
            )
        if str(items[-1].get("notice_date") or "")[:10] < start.isoformat():
            break
    return rows


def szse_disclosure(code: str, start: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for channel in ("fixed_disc", "listedNotice_disc"):
        for page in range(1, 11):
            payload = requests.post(
                SZSE_ANN_LIST,
                json={
                    "seDate": [start.isoformat(), date.today().isoformat()],
                    "stock": [code],
                    "channelCode": [channel],
                    "pageSize": 50,
                    "pageNum": page,
                },
                headers={
                    **BROWSER_HEADERS,
                    "Content-Type": "application/json",
                    "Referer": "https://www.szse.cn/disclosure/listed/notice/index.html",
                },
                timeout=25,
            )
            payload.raise_for_status()
            items = (payload.json() or {}).get("data") or []
            if not items:
                break
            for item in items:
                attach = str(item.get("attachPath") or "")
                rows.append(
                    {
                        "公告标题": str(item.get("title") or ""),
                        "公告时间": str(item.get("publishTime") or "")[:10],
                        "公告链接": SZSE_ANN_PAGE.format(ann_id=item.get("id") or ""),
                        "pdf_url": SZSE_ANN_PDF.format(path=attach) if attach else "",
                        "_provider": "深圳证券交易所",
                    }
                )
    return rows


def sse_disclosure(code: str, start: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for page in range(1, 11):
        payload = requests.get(
            SSE_ANN_LIST,
            params={
                "jsonCallBack": "jsonpCallback",
                "isPagination": "true",
                "productId": code,
                "keyWord": "",
                "securityType": "0101",
                "reportType2": "",
                "reportType": "ALL",
                "beginDate": start.isoformat(),
                "endDate": date.today().isoformat(),
                "pageHelp.pageSize": "50",
                "pageHelp.pageNo": str(page),
                "pageHelp.beginPage": str(page),
                "pageHelp.cacheSize": "1",
                "pageHelp.endPage": str(page),
            },
            headers={**BROWSER_HEADERS, "Referer": "https://www.sse.com.cn/"},
            timeout=25,
        )
        payload.raise_for_status()
        wrapper = re.search(r"jsonpCallback\((.*)\)\s*$", payload.text, re.S)
        grouped = json.loads(wrapper.group(1) if wrapper else payload.text)["pageHelp"]["data"]
        items = [row for group in grouped for row in (group if isinstance(group, list) else [group])]
        if not items:
            break
        for item in items:
            path = str(item.get("URL") or "")
            rows.append(
                {
                    "公告标题": str(item.get("TITLE") or ""),
                    "公告时间": str(item.get("SSEDATE") or "")[:10],
                    "公告链接": f"https://www.sse.com.cn{path}" if path else CNINFO_HOME,
                    "_provider": "上海证券交易所",
                }
            )
    return rows


def disclosure_records(code: str, start: date) -> list[dict[str, Any]]:
    """巨潮为证监会指定披露平台，优先使用；被上游拒绝时按交易所与东方财富的公告索引回退。"""
    chain: list[tuple[str, Callable[[str, date], list[dict[str, Any]]]]] = [
        ("巨潮资讯", cninfo_disclosure),
        ("东方财富", eastmoney_disclosure),
    ]
    if exchange_for(code) == "SZSE":
        chain.append(("深圳证券交易所", szse_disclosure))
    elif exchange_for(code) == "SSE":
        chain.append(("上海证券交易所", sse_disclosure))
    with CNINFO_QUERY_LOCK:
        failures: list[str] = []
        for name, loader in chain:
            try:
                rows = loader(code, start)
            except Exception as exc:
                failures.append(f"{name} {type(exc).__name__}")
                continue
            if rows:
                return rows
            failures.append(f"{name} 无记录")
        raise RuntimeError("公告索引不可用（" + "；".join(failures) + "）")


FILING_INDEX_DAYS = 1830


def filing_index(code: str, refresh: bool = False) -> list[dict[str, Any]]:
    start = date.today() - timedelta(days=FILING_INDEX_DAYS)
    return cached(f"filings_{code}", 12 * 3600, lambda: disclosure_records(code, start), refresh)


def filing_archive(code: str, refresh: bool = False) -> list[dict[str, Any]]:
    start = date(date.today().year - 12, 1, 1)
    return cached(
        f"filing_archive_{code}", 30 * 24 * 3600, lambda: disclosure_records(code, start), refresh
    )


def filings_since(records: list[dict[str, Any]], start: str) -> list[dict[str, Any]]:
    rows = [
        {**row, "_published_at": parse_date(first_value(row, ("公告时间", "公告日期", "announcementTime")))}
        for row in records
    ]
    rows = [row for row in rows if row["_published_at"] and row["_published_at"] >= start]
    rows.sort(key=lambda row: row["_published_at"], reverse=True)
    return rows


def latest_filing(
    records: list[dict[str, Any]], pattern: str, exclude: str | None = None
) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for row in records:
        title = str(first_value(row, ("公告标题", "标题", "announcementTitle")) or "")
        if not re.search(pattern, title) or (exclude and re.search(exclude, title)):
            continue
        detail = str(first_value(row, ("公告链接", "网址", "url")) or "")
        published = parse_date(first_value(row, ("公告时间", "公告日期", "announcementTime")))
        pdf_url = str(row.get("pdf_url") or "")
        if not pdf_url and published:
            announcement = re.search(r"announcementId=(\d+)", detail)
            if announcement:
                pdf_url = CNINFO_PDF.format(day=published, announcement_id=announcement.group(1))
        if not pdf_url or not published:
            continue
        candidates.append(
            {
                "title": title,
                "published_at": published,
                "url": detail,
                "pdf_url": pdf_url,
                "provider": str(row.get("_provider") or "巨潮资讯"),
            }
        )
    candidates.sort(key=lambda item: item["published_at"], reverse=True)
    return candidates[0] if candidates else None


def filing_text(cache_key: str, pdf_url: str, refresh: bool = False) -> str:
    def load() -> str:
        value = requests.get(pdf_url, headers=BROWSER_HEADERS, timeout=90)
        value.raise_for_status()
        reader = PdfReader(io.BytesIO(value.content))
        text = re.sub(r"\s+", " ", "\n".join(page.extract_text() or "" for page in reader.pages))
        for noise in FILING_NOISE:
            text = noise.sub(" ", text)
        return re.sub(r"\s+", " ", text)

    return cached(cache_key, 30 * 24 * 3600, load, refresh)


def report_section(
    text: str,
    starts: tuple[str, ...],
    stops: tuple[str, ...],
    limit: int = 3000,
    signal: str | None = None,
) -> str | None:
    def window_at(index: int, start: str) -> str:
        window = text[index : index + limit]
        ends = [window.find(stop, len(start)) for stop in stops]
        ends = [end for end in ends if end > 0]
        return (window[: min(ends)] if ends else window).strip(" 　")

    first: str | None = None
    for start in starts:
        for match in re.finditer(re.escape(start), text):
            window = window_at(match.start(), start)
            if first is None:
                first = window
            if signal is None or re.search(signal, window[:400]):
                return window
    return first


def annual_report_facts(
    code: str, records: list[dict[str, Any]], refresh: bool = False
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    filing = latest_filing(records, r"\d{4}年年度报告", r"摘要|英文|说明|问询|意见|审计|专项")
    if not filing:
        return {}, None
    text = filing_text(f"filing_annual_{code}_{filing['published_at']}", filing["pdf_url"], refresh)
    src = source(
        f"cninfo-annual-{code}-{filing['published_at']}",
        filing["provider"],
        filing["title"],
        filing["url"],
        period=filing["published_at"],
        published_at=filing["published_at"],
    )
    facts = {
        "core_competence": report_section(
            text, ("核心竞争力分析",), ("四、主营业务分析", "第四节", "四、公司未来发展")
        ),
        "industry_position": report_section(
            text, ("公司所处行业情况", "报告期内公司所处行业情况"), ("二、主营业务分析", "三、核心竞争力")
        ),
        "controlling_shareholder": report_section(
            text, ("控股股东情况",), ("公司实际控制人", "实际控制人及其一致行动人"), 1600
        ),
        "actual_controller": report_section(
            text,
            ("实际控制人及其一致行动人", "实际控制人情况", "公司实际控制人"),
            ("公司控股股东或第一大股东", "四、股份回购", "其他持股在"),
            1600,
            signal=r"国籍|实际控制人性质|自然人|不存在实际控制人|无实际控制人",
        ),
    }
    facts["partners"] = parse_partner_section(
        report_section(text, PARTNER_STARTS, PARTNER_STOPS, 1800, signal=r"[\d.]+\s*%")
    )
    return {key: value for key, value in facts.items() if value}, src


def competition_disclosure(
    code: str, records: list[dict[str, Any]], refresh: bool = False
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    pattern = r"(招股说明书|募集说明书)([（(][^）)]*[）)])?$"
    exclude = r"摘要|确认意见|法律意见|核查意见|之|公告"
    # 先用已经抓好的近五年索引；只有里面没有发行文件时，才去爬十二年存档。
    filing = latest_filing(records, pattern, exclude)
    if not filing:
        filing = latest_filing(filing_archive(code, refresh), pattern, exclude)
    if not filing:
        return {}, None
    text = filing_text(f"filing_offering_{code}_{filing['published_at']}", filing["pdf_url"], refresh)
    section_text = report_section(
        text,
        (
            "行业竞争情况",
            "行业竞争状况",
            "行业竞争格局",
            "行业主要参与者",
            "主要竞争对手",
            "同行业可比公司",
            "竞争格局",
            "市场竞争情况",
        ),
        ("三、公司主营业务", "（四）", "四、", "第二节"),
        2600,
        signal=r"主要参与者|竞争对手|主要厂商|主要企业|市场份额|龙头|可比公司",
    )
    if not section_text:
        return {}, None
    src = source(
        f"cninfo-offering-{code}-{filing['published_at']}",
        filing["provider"],
        filing["title"],
        filing["url"],
        period=filing["published_at"],
        published_at=filing["published_at"],
    )
    return (
        {"text": section_text, "document": filing["title"], "published_at": filing["published_at"]},
        src,
    )


@app.get("/api/company/{raw_code}/business")
def business(raw_code: str, refresh: bool = False, mode: SourceMode = "official") -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")

    sources: list[dict[str, Any]] = []
    warnings: list[str] = []
    data: dict[str, Any] = {}
    filing_pool = ThreadPoolExecutor(max_workers=2)
    try:
        filings = filing_index(code, refresh)
    except Exception as exc:
        filings = []
        warnings.append(f"巨潮公告索引获取失败：{type(exc).__name__}: {exc}")
    annual_future = filing_pool.submit(annual_report_facts, code, filings, refresh)
    competition_future = filing_pool.submit(competition_disclosure, code, filings, refresh)

    cninfo_src = source(f"cninfo-profile-{code}", "巨潮资讯", f"{code} 公司概况", CNINFO_HOME)
    try:
        records = profile_records(code, refresh)
        row = records[0] if records else {}
        scope = {
            key: field(first_value(row, names), cninfo_src["source_id"])
            for key, names in (
                ("main_business", ("主营业务",)),
                ("business_scope", ("经营范围",)),
                ("organization_profile", ("机构简介",)),
            )
        }
        data["scope"] = {key: value for key, value in scope.items() if value}
        if data["scope"]:
            sources.append(cninfo_src)
        else:
            warnings.append("巨潮公司概况未返回经营范围或机构简介。")
    except Exception as exc:
        warnings.append(f"经营范围获取失败：{type(exc).__name__}: {exc}")

    try:
        facts, annual_src = annual_future.result()
        if annual_src and facts:
            sources.append(annual_src)
            data["annual_report"] = {**facts, "source_id": annual_src["source_id"], "title": annual_src["title"]}
            partners = facts.get("partners") or {}
            if not partners:
                warnings.append("年报未定位到可解析的前五名客户与供应商披露。")
            elif not any(partners.get(key, {}).get("rows") for key in ("customers", "suppliers")):
                warnings.append("年报只披露前五名客户与供应商的合计金额和占比，未逐户列示。")
        else:
            warnings.append("未定位到可解析的最新年度报告原文。")
    except Exception as exc:
        warnings.append(f"年报原文抽取失败：{type(exc).__name__}: {exc}")
    try:
        competition, competition_src = competition_future.result()
        if competition_src:
            sources.append(competition_src)
            data["competition"] = {**competition, "source_id": competition_src["source_id"]}
        else:
            warnings.append(
                "招股说明书或募集说明书中未定位到行业竞争章节；本站不以推断方式生成境内外可比公司名单。"
            )
    except Exception as exc:
        warnings.append(f"行业竞争章节抽取失败：{type(exc).__name__}: {exc}")
    finally:
        filing_pool.shutdown(wait=False)

    if mode == "strict":
        warnings.append("仅官方来源模式只展示巨潮公司概况与定期报告、发行文件原文，不展示同花顺与东方财富栏目。")
        return response(data, sources, warnings, status="partial")

    ths_products_src = source(
        f"ths-products-{code}",
        "同花顺",
        f"{code} 主营介绍",
        f"{THS_F10}/{code}/operate.html",
        tier="secondary",
    )
    try:
        rows = cached(
            f"ths_products_{code}",
            12 * 3600,
            lambda: frame_records(ak.stock_zyjs_ths(symbol=code)),
            refresh,
        )
        row = rows[0] if rows else {}
        products = {
            key: field(first_value(row, names), ths_products_src["source_id"])
            for key, names in (
                ("product_type", ("产品类型",)),
                ("product_name", ("产品名称",)),
                ("main_business", ("主营业务",)),
            )
        }
        data["products"] = {key: value for key, value in products.items() if value}
        if data["products"]:
            sources.append(ths_products_src)
    except Exception as exc:
        warnings.append(f"主营产品获取失败：{type(exc).__name__}: {exc}")

    company_src = source(
        f"ths-company-{code}",
        "同花顺",
        f"{code} 公司资料与实际控制人",
        f"{THS_F10}/{code}/company.html",
        tier="secondary",
    )
    controller_src = source(
        f"eastmoney-controller-{code}",
        "东方财富",
        f"{code} 实际控制人",
        f"{EASTMONEY_F10}/ShareholderResearch/Index?type=web&code={market_symbol(code)}",
        tier="secondary",
    )
    control: dict[str, Any] = {}
    try:
        control = ths_control_chain(ths_page(code, "company", refresh))
        for item in control.values():
            item["source_id"] = company_src["source_id"]
        if control:
            sources.append(company_src)
    except Exception as exc:
        warnings.append(f"控制关系获取失败：{type(exc).__name__}: {exc}")
    try:
        payload = shareholder_research(code, refresh)
        controller_rows = payload.get("sjkzr") or []
        if controller_rows and "actual_controller" not in control:
            control["actual_controller"] = {
                "name": controller_rows[0].get("HOLDER_NAME"),
                "ratio_percent": clean_scalar(controller_rows[0].get("HOLD_RATIO")),
                "source_id": controller_src["source_id"],
            }
            sources.append(controller_src)
    except Exception as exc:
        warnings.append(f"实际控制人交叉核对失败：{type(exc).__name__}: {exc}")
    data["control"] = control
    if not control:
        warnings.append("未取得可核验的控股股东或实际控制人记录。")
    if not (data.get("annual_report") or {}).get("actual_controller"):
        warnings.append(
            "年报未提供可解析的实际控制人章节；控制关系仅来自二手结构化栏目，请查阅年报“控股股东及实际控制人情况”。"
        )

    try:
        partners = ths_partners(ths_page(code, "operate", refresh))
        if partners.get("customers") or partners.get("suppliers"):
            partner_src = source(
                f"ths-partners-{code}",
                "同花顺",
                f"{code} 主要客户及供应商",
                f"{THS_F10}/{code}/operate.html",
                period=partners.get("period"),
                tier="secondary",
            )
            sources.append(partner_src)
            partners["source_id"] = partner_src["source_id"]
            data["partners"] = partners
        else:
            warnings.append("同花顺未提供前五大客户与供应商集中度栏目。")
    except Exception as exc:
        warnings.append(f"客户与供应商获取失败：{type(exc).__name__}: {exc}")

    filed = (data.get("annual_report") or {}).get("partners") or {}
    disclosed = filed.get("customers", {}).get("rows", []) + filed.get("suppliers", {}).get("rows", [])
    if disclosed and all(re.fullmatch(r"(客户|供应商|单位|公司)\d+", row["name"]) for row in disclosed):
        warnings.append("年报以“客户1/供应商1”等匿名编号披露前五名交易对象，未公开具体企业名称。")
    return response(data, sources, warnings)


FINANCIAL_ROW_FIELDS = (
    ("revenue", ("TOTAL_OPERATE_INCOME", "OPERATE_INCOME"), "profit"),
    ("operating_cost", ("OPERATE_COST",), "profit"),
    ("parent_net_profit", ("PARENT_NETPROFIT",), "profit"),
    ("net_profit", ("NETPROFIT",), "profit"),
    ("accounts_receivable", ("ACCOUNTS_RECE",), "balance"),
    ("contract_liabilities", ("CONTRACT_LIAB",), "balance"),
    ("short_term_loan", ("SHORT_LOAN",), "balance"),
    ("long_term_loan", ("LONG_LOAN",), "balance"),
    ("total_equity", ("TOTAL_EQUITY",), "balance"),
    ("total_assets", ("TOTAL_ASSETS",), "balance"),
)


def ratio(numerator: Any, denominator: Any) -> float | None:
    try:
        if numerator is None or not float(denominator):
            return None
        return clean_scalar(float(numerator) / float(denominator) * 100)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


@app.get("/api/company/{raw_code}/financials")
def financials(
    raw_code: str,
    periods: int = Query(4, ge=1, le=8),
    refresh: bool = False,
    mode: SourceMode = "official",
) -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")
    if mode == "strict":
        return response(
            {"rows": []},
            [],
            ["仅官方来源模式不展示缺少官方结构化接口的报告期财务明细。"],
            status="empty",
        )
    try:
        profits, balances = financial_frames(code, refresh)
    except Exception as exc:
        return response({"rows": []}, [], [f"财务报表获取失败：{type(exc).__name__}: {exc}"], status="error")
    profit_by_period = {report_period(row): row for row in profits if report_period(row)}
    balance_by_period = {report_period(row): row for row in balances if report_period(row)}
    selected = sorted(set(profit_by_period) | set(balance_by_period), reverse=True)[:periods]
    if not selected:
        return response({"rows": []}, [], ["未取得结构化利润表与资产负债表。"], status="empty")

    sources: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for period in selected:
        source_id = f"eastmoney-financial-{code}-{period}"
        sources.append(
            source(
                source_id,
                "东方财富",
                f"{code} {period} 结构化财务报表",
                quote_url(code),
                period=period,
                tier="secondary",
            )
        )
        frames = {"profit": profit_by_period.get(period, {}), "balance": balance_by_period.get(period, {})}
        values = {
            key: first_value(frames[frame], names) for key, names, frame in FINANCIAL_ROW_FIELDS
        }
        revenue = number_or_none(values["revenue"])
        cost = number_or_none(values["operating_cost"])
        rows.append(
            {
                "period": period,
                **{key: values[key] for key in ("revenue", "parent_net_profit", "net_profit")},
                "gross_margin_percent": (
                    ratio(revenue - cost, revenue) if revenue is not None and cost is not None else None
                ),
                "return_on_assets_percent": ratio(values["net_profit"], values["total_assets"]),
                **{
                    key: values[key]
                    for key in (
                        "accounts_receivable",
                        "contract_liabilities",
                        "short_term_loan",
                        "long_term_loan",
                        "total_equity",
                        "total_assets",
                    )
                },
                "source_id": source_id,
            }
        )
    warnings = ["毛利率按（营业总收入−营业成本）÷营业总收入计算，资产利润率按报告期净利润÷期末总资产计算，均未年化。"]
    if any(row["gross_margin_percent"] is None for row in rows):
        warnings.append("部分报告期未披露营业成本，对应毛利率留空。")
    try:
        report_src = latest_report_source(code, refresh)
    except Exception:
        report_src = None
    if report_src:
        sources.append(report_src)
    else:
        warnings.append("未能回链最新定期报告原文；结构化财务数据仍标记为二手来源。")
    return response({"rows": rows}, sources, warnings)


def shareholder_research(code: str, refresh: bool = False) -> dict[str, Any]:
    return cached(
        f"em_shareholder_research_{code}",
        12 * 3600,
        lambda: em_f10("ShareholderResearch", "PageAjax", {"code": market_symbol(code)}),
        refresh,
    )


def research_page(code: str, page: str, period: str, refresh: bool = False) -> list[dict[str, Any]]:
    key = page.replace("Page", "").lower()
    payload = cached(
        f"em_{key}_{code}_{period.replace('-', '')}",
        12 * 3600,
        lambda: em_f10("ShareholderResearch", page, {"code": market_symbol(code), "date": period}),
        refresh,
    )
    return payload.get(key) or []


def report_dates(payload: dict[str, Any], key: str, field_name: str, limit: int = 2) -> list[str]:
    rows = payload.get(key) or []
    dates = sorted({parse_date(row.get(field_name)) for row in rows if parse_date(row.get(field_name))}, reverse=True)
    return dates[:limit]


HOLDER_TYPE_CATEGORIES = {
    "私募基金": "private_fund",
    "全国社保基金": "social_security",
    "证券投资基金": "public_fund",
    "保险产品": "insurance",
    "QFII": "qfii",
}
HOLDER_NAME_CATEGORIES = (
    ("private_fund", ("私募",)),
    ("social_security", ("全国社保基金", "社保基金")),
    ("qfii", ("QFII",)),
)


def holder_category(name: str, holder_type: str) -> str | None:
    category = HOLDER_TYPE_CATEGORIES.get(holder_type)
    if category:
        return category
    for fallback, words in HOLDER_NAME_CATEGORIES:
        if any(word in name for word in words):
            return fallback
    return None


@app.get("/api/company/{raw_code}/institutions")
def institutions(raw_code: str, refresh: bool = False, mode: SourceMode = "official") -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")
    if mode == "strict":
        return response(
            {"aggregate": [], "public_funds": [], "free_float_holders": []},
            [],
            ["仅官方来源模式不展示二手机构持股汇总。"],
            status="empty",
        )
    try:
        payload = shareholder_research(code, refresh)
    except Exception as exc:
        return response({}, [], [f"机构持股获取失败：{type(exc).__name__}: {exc}"], status="error")

    warnings: list[str] = []
    sources: list[dict[str, Any]] = []
    holding_periods = report_dates(payload, "jgcc_date", "REPORT_DATE")
    fund_periods = report_dates(payload, "jjcg_date", "REPORT_DATE")
    holder_periods = report_dates(payload, "sdltgd_date", "END_DATE", limit=3)

    def rows_for(page: str, key: str, period: str, index: int) -> list[dict[str, Any]]:
        if index == 0 and payload.get(key):
            return payload[key]
        return research_page(code, page, period, refresh)

    def module_source(name: str, title: str, period: str) -> dict[str, Any]:
        src = source(
            f"eastmoney-{name}-{code}-{period}",
            "东方财富",
            f"{code} {title}",
            f"{EASTMONEY_F10}/ShareholderResearch/Index?type=web&code={market_symbol(code)}",
            period=period,
            tier="secondary",
        )
        sources.append(src)
        return src

    aggregate: list[dict[str, Any]] = []
    for index, period in enumerate(holding_periods):
        try:
            rows = rows_for("PageJGCC", "jgcc", period, index)
        except Exception as exc:
            warnings.append(f"{period} 机构持股汇总获取失败：{type(exc).__name__}")
            continue
        src = module_source("institution-holding", "机构持股汇总", period)
        for row in rows:
            label = {"00": "机构合计", "01": "基金"}.get(str(row.get("ORG_TYPE")))
            if not label:
                continue
            aggregate.append(
                {
                    "period": period,
                    "org_type": label,
                    "institution_count": clean_scalar(row.get("TOTAL_ORG_NUM")),
                    "shares": clean_scalar(row.get("TOTAL_FREE_SHARES")),
                    "float_share_percent": clean_scalar(row.get("TOTAL_SHARES_RATIO")),
                    "total_share_percent": clean_scalar(row.get("ALL_SHARES_RATIO")),
                    "source_id": src["source_id"],
                }
            )
    if aggregate:
        warnings.append("东方财富机构持股接口未返回其余机构类别的名称，本表只展示可确定标注的“机构合计”与“基金”。")

    funds_by_period: dict[str, dict[str, dict[str, Any]]] = {}
    for index, period in enumerate(fund_periods):
        try:
            rows = rows_for("PageJJCG", "jjcg", period, index)
        except Exception as exc:
            warnings.append(f"{period} 基金持股获取失败：{type(exc).__name__}")
            continue
        src = module_source("fund-holding", "基金持股明细", period)
        funds_by_period[period] = {
            str(row.get("HOLDER_CODE") or row.get("HOLDER_NAME")): {
                "period": period,
                "name": row.get("HOLDER_NAME"),
                "fund_code": row.get("HOLDER_CODE"),
                "shares": clean_scalar(row.get("TOTAL_SHARES")),
                "market_value": clean_scalar(row.get("HOLD_VALUE")),
                "total_share_percent": clean_scalar(row.get("TOTALSHARES_RATIO")),
                "source_id": src["source_id"],
            }
            for row in rows
        }
    public_funds: list[dict[str, Any]] = []
    if fund_periods:
        latest = funds_by_period.get(fund_periods[0], {})
        prior = funds_by_period.get(fund_periods[1], {}) if len(fund_periods) > 1 else {}
        for key, item in latest.items():
            previous = prior.get(key)
            item = dict(item)
            if previous:
                item["previous_shares"] = previous["shares"]
                try:
                    item["share_change"] = clean_scalar(float(item["shares"]) - float(previous["shares"]))
                except (TypeError, ValueError):
                    item["share_change"] = None
            public_funds.append(item)
        for key, item in prior.items():
            if key not in latest:
                public_funds.append({**item, "exited": True})
        warnings.append("基金持股明细为东方财富按持股规模返回的前若干只公募基金，未覆盖全部持有人。")

    holders: list[dict[str, Any]] = []
    for index, period in enumerate(holder_periods):
        try:
            rows = rows_for("PageSDLTGD", "sdltgd", period, index)
        except Exception as exc:
            warnings.append(f"{period} 十大流通股东获取失败：{type(exc).__name__}")
            continue
        src = module_source("free-float-holders", "十大流通股东", period)
        for row in rows:
            name = str(row.get("HOLDER_NAME") or "")
            holder_type = str(row.get("HOLDER_TYPE") or "").strip()
            holders.append(
                {
                    "period": period,
                    "name": name,
                    "holder_type": holder_type or None,
                    "category": holder_category(name, holder_type),
                    "shares": clean_scalar(row.get("HOLD_NUM")),
                    "float_share_percent": clean_scalar(row.get("FREE_HOLDNUM_RATIO")),
                    "change": row.get("HOLD_NUM_CHANGE"),
                    "change_percent": clean_scalar(row.get("CHANGE_RATIO")),
                    "source_id": src["source_id"],
                }
            )
    by_category = {
        category: [item for item in holders if item["category"] == category]
        for category in ("private_fund", "social_security", "public_fund", "insurance", "qfii")
    }
    if holder_periods:
        warnings.append(
            f"持有人类别为东方财富对十大流通股东标注的 HOLDER_TYPE，覆盖 {'、'.join(holder_periods)} "
            "共 " + str(len(holder_periods)) + " 个报告期；未进入十大流通股东的持仓不在任何公开逐股披露渠道内。"
        )
    for category, label in (
        ("private_fund", "私募基金"),
        ("social_security", "社保基金"),
    ):
        if not by_category[category]:
            warnings.append(f"最近 {len(holder_periods)} 个报告期的十大流通股东中没有被标注为{label}的持有人。")
    return response(
        {
            "aggregate": aggregate,
            "public_funds": public_funds,
            "free_float_holders": holders,
            "social_security": by_category["social_security"],
            "private_fund_matches": by_category["private_fund"],
            "qfii": by_category["qfii"],
            "insurance": by_category["insurance"],
            "holder_periods": holder_periods,
        },
        sources,
        warnings,
    )


EASTMONEY_FLOW_CALIBER = "主力净流入（超大单＋大单，东方财富口径）"
SINA_FLOW_CALIBER = "全部委托单净流入（新浪财经口径）"
EASTMONEY_HIS_HOSTS = (
    "push2his.eastmoney.com",
    "1.push2his.eastmoney.com",
    "7.push2his.eastmoney.com",
    "63.push2his.eastmoney.com",
)
EASTMONEY_SECID_MARKET = {"sh": "1", "sz": "0", "bj": "0"}
CYQ_FACTOR = 150
CYQ_WINDOW = 210
TENCENT_KLINE = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
TENCENT_SNAPSHOT = "https://qt.gtimg.cn/q="


def eastmoney_klines(path: str, params: dict[str, str]) -> list[str]:
    """东方财富历史行情接口在部分网络下会被直接断连，按镜像域名依次重试。"""
    failures: list[str] = []
    for host in EASTMONEY_HIS_HOSTS:
        try:
            payload = requests.get(
                f"https://{host}{path}",
                params=params,
                headers={**BROWSER_HEADERS, "Referer": EASTMONEY_QUOTE},
                timeout=20,
            )
            payload.raise_for_status()
            klines = ((payload.json() or {}).get("data") or {}).get("klines") or []
            if klines:
                return klines
            failures.append(f"{host} 无数据")
        except Exception as exc:
            failures.append(f"{host} {type(exc).__name__}")
    raise RuntimeError("；".join(failures))


def eastmoney_daily_flow(code: str, market: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in eastmoney_klines(
        "/api/qt/stock/fflow/daykline/get",
        {
            "lmt": "0",
            "klt": "101",
            "secid": f"{EASTMONEY_SECID_MARKET[market]}.{code}",
            "fields1": "f1,f2,f3,f7",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
            "ut": "b2884a393a59ad64002292a3e90d46a5",
        },
    ):
        cells = line.split(",")
        if len(cells) < 13:
            continue
        rows.append(
            {
                "日期": cells[0],
                "主力净流入-净额": number_or_none(cells[1]),
                "小单净流入-净额": number_or_none(cells[2]),
                "中单净流入-净额": number_or_none(cells[3]),
                "大单净流入-净额": number_or_none(cells[4]),
                "超大单净流入-净额": number_or_none(cells[5]),
                "主力净流入-净占比": number_or_none(cells[6]),
                "收盘价": number_or_none(cells[11]),
                "涨跌幅": number_or_none(cells[12]),
            }
        )
    return rows


def eastmoney_chip_bars(code: str, market: str) -> list[dict[str, Any]]:
    bars: list[dict[str, Any]] = []
    for line in eastmoney_klines(
        "/api/qt/stock/kline/get",
        {
            "secid": f"{EASTMONEY_SECID_MARKET[market]}.{code}",
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
            "klt": "101",
            "fqt": "0",
            "end": date.today().strftime("%Y%m%d"),
            "lmt": str(CYQ_WINDOW),
            "ut": "7eea3edcaed734bea9cbfc24409ed989",
        },
    ):
        cells = line.split(",")
        if len(cells) < 11:
            continue
        bars.append(
            {
                "date": cells[0],
                "open": float(cells[1]),
                "close": float(cells[2]),
                "high": float(cells[3]),
                "low": float(cells[4]),
                "turnover": float(cells[10]),
            }
        )
    return bars


def tencent_chip_bars(code: str) -> list[dict[str, Any]]:
    """腾讯日 K 不下发换手率，按当前流通股本折算，流通股本变动期间会有偏差。"""
    symbol = market_symbol(code, lower=True)
    payload = requests.get(
        TENCENT_KLINE,
        params={"param": f"{symbol},day,,,{CYQ_WINDOW},"},
        headers={**BROWSER_HEADERS, "Referer": "https://gu.qq.com/"},
        timeout=20,
    )
    payload.raise_for_status()
    series = ((payload.json() or {}).get("data") or {}).get(symbol) or {}
    snapshot = requests.get(TENCENT_SNAPSHOT + symbol, headers=BROWSER_HEADERS, timeout=15)
    snapshot.encoding = "gbk"
    cells = snapshot.text.split("~")
    price = number_or_none(cells[3]) if len(cells) > 3 else None
    float_cap = number_or_none(cells[44]) if len(cells) > 44 else None
    if not price or not float_cap:
        raise RuntimeError("腾讯行情未返回流通市值，无法折算换手率")
    float_shares = float_cap * 10**8 / price
    bars: list[dict[str, Any]] = []
    for row in (series.get("day") or series.get("qfqday") or [])[-CYQ_WINDOW:]:
        if len(row) < 6:
            continue
        bars.append(
            {
                "date": str(row[0]),
                "open": float(row[1]),
                "close": float(row[2]),
                "high": float(row[3]),
                "low": float(row[4]),
                "turnover": float(row[5]) * 100 / float_shares * 100,
            }
        )
    return bars


def chip_distribution(bars: list[dict[str, Any]], tail: int) -> list[dict[str, Any]]:
    """东方财富公开的三角形筹码衰减模型，与 akshare 内嵌的 CYQCalculator 同算法。"""
    rows: list[dict[str, Any]] = []
    for index in range(max(0, len(bars) - tail), len(bars)):
        window = bars[: index + 1]
        floor_price = min(bar["low"] for bar in window)
        ceil_price = max(bar["high"] for bar in window)
        step = max(0.01, (ceil_price - floor_price) / (CYQ_FACTOR - 1))
        chips = [0.0] * CYQ_FACTOR

        def slot_of(price: float) -> int:
            return min(CYQ_FACTOR - 1, max(0, math.floor((price - floor_price) / step)))

        for bar in window:
            avg = (bar["open"] + bar["close"] + bar["high"] + bar["low"]) / 4
            rate = min(1.0, max(0.0, bar["turnover"]) / 100)
            peak = CYQ_FACTOR - 1 if bar["high"] == bar["low"] else 2 / (bar["high"] - bar["low"])
            chips = [value * (1 - rate) for value in chips]
            if bar["high"] == bar["low"]:
                chips[slot_of(avg)] += peak * rate / 2
                continue
            low_slot = max(0, math.ceil((bar["low"] - floor_price) / step))
            for slot in range(low_slot, slot_of(bar["high"]) + 1):
                price = floor_price + step * slot
                span = avg - bar["low"] if price <= avg else bar["high"] - avg
                if abs(span) < 1e-8:
                    ratio = 1.0
                elif price <= avg:
                    ratio = (price - bar["low"]) / span
                else:
                    ratio = (bar["high"] - price) / span
                chips[slot] += ratio * peak * rate

        total = sum(chips)

        def cost_at(share: float) -> float:
            carried = 0.0
            for slot, value in enumerate(chips):
                if carried + value > share:
                    return floor_price + slot * step
                carried += value
            return 0.0

        close = bars[index]["close"]
        below = sum(value for slot, value in enumerate(chips) if close >= floor_price + slot * step)
        low_90 = cost_at(total * 0.05)
        high_90 = cost_at(total * 0.95)
        rows.append(
            {
                "日期": bars[index]["date"],
                "获利比例": (below / total) if total else 0.0,
                "平均成本": round(cost_at(total * 0.5), 2),
                "90成本-低": round(low_90, 2),
                "90成本-高": round(high_90, 2),
                "90集中度": ((high_90 - low_90) / (low_90 + high_90)) if (low_90 + high_90) else 0.0,
            }
        )
    return rows


def chip_cost_records(code: str, market: str) -> list[dict[str, Any]]:
    try:
        bars = eastmoney_chip_bars(code, market)
        provider = "东方财富"
    except Exception:
        bars = tencent_chip_bars(code)
        provider = "腾讯财经"
    return [{**row, "_provider": provider} for row in chip_distribution(bars, 3)]


def sina_money_flow(code: str, days: int, source_id: str, refresh: bool = False) -> list[dict[str, Any]]:
    def load() -> list[dict[str, Any]]:
        value = requests.get(
            "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_zjlrqs",
            params={"page": "1", "num": "60", "sort": "opendate", "asc": "0", "daima": market_symbol(code, lower=True)},
            headers={**BROWSER_HEADERS, "Referer": "https://finance.sina.com.cn/"},
            timeout=20,
        )
        value.raise_for_status()
        rows = value.json()
        return rows if isinstance(rows, list) else []

    records = cached(f"sina_moneyflow_{code}", 3600, load, refresh)
    if not records:
        raise ValueError("新浪资金流入趋势响应为空")
    flow: list[dict[str, Any]] = []
    for row in records[:days]:
        flow.append(
            {
                "date": parse_date(row.get("opendate")),
                "close": number_or_none(row.get("trade")),
                "change_percent": number_or_none(row.get("changeratio"), 100),
                "main_net": number_or_none(row.get("netamount")),
                "main_net_percent": number_or_none(row.get("ratioamount"), 100),
                "super_large_net": number_or_none(row.get("r0_net")),
                "source_id": source_id,
            }
        )
    flow.reverse()
    return flow


@app.get("/api/company/{raw_code}/moneyflow")
def moneyflow(
    raw_code: str,
    days: int = Query(22, ge=1, le=120),
    refresh: bool = False,
    mode: SourceMode = "official",
) -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")
    if mode == "strict":
        return response(
            {"daily_main_flow": [], "chip_cost": []},
            [],
            ["仅官方来源模式不展示商业平台的主力资金与筹码成本估算。"],
            status="empty",
        )
    market = {"SSE": "sh", "SZSE": "sz", "BSE": "bj"}[exchange_for(code)]
    sources: list[dict[str, Any]] = []
    warnings: list[str] = [
        "主力资金为交易平台按委托单规模划分的成交统计，不是监管口径的机构买卖；筹码成本为平台依成交分布推算的估计值，不是披露数据。"
    ]
    flow: list[dict[str, Any]] = []
    chips: list[dict[str, Any]] = []
    caliber = EASTMONEY_FLOW_CALIBER
    flow_id = f"eastmoney-moneyflow-{code}"
    chip_id = f"eastmoney-chip-{code}"

    def load_flow() -> list[dict[str, Any]]:
        return eastmoney_daily_flow(code, market)

    def load_chips() -> list[dict[str, Any]]:
        return chip_cost_records(code, market)

    with ThreadPoolExecutor(max_workers=2) as pool:
        flow_future = pool.submit(cached, f"moneyflow_{code}", 3600, load_flow, refresh)
        chip_future = pool.submit(cached, f"chips_{code}", 3600, load_chips, refresh)
        try:
            for row in flow_future.result()[-days:]:
                flow.append(
                    {
                        "date": parse_date(first_value(row, ("日期",))),
                        "close": first_value(row, ("收盘价",)),
                        "change_percent": first_value(row, ("涨跌幅",)),
                        "main_net": first_value(row, ("主力净流入-净额",)),
                        "main_net_percent": first_value(row, ("主力净流入-净占比",)),
                        "super_large_net": first_value(row, ("超大单净流入-净额",)),
                        "large_net": first_value(row, ("大单净流入-净额",)),
                        "medium_net": first_value(row, ("中单净流入-净额",)),
                        "small_net": first_value(row, ("小单净流入-净额",)),
                        "source_id": flow_id,
                    }
                )
            if flow:
                sources.append(
                    source(
                        flow_id,
                        "东方财富",
                        f"{code} 个股资金流向",
                        "https://data.eastmoney.com/zjlx/detail.html",
                        tier="secondary",
                    )
                )
            else:
                warnings.append("未取得该证券的逐日主力资金数据。")
        except Exception as exc:
            warnings.append(f"东方财富主力资金获取失败：{type(exc).__name__}: {exc}")
            try:
                flow_id = f"sina-moneyflow-{code}"
                caliber = SINA_FLOW_CALIBER
                flow = sina_money_flow(code, days, flow_id, refresh)
                sources.append(
                    source(
                        flow_id,
                        "新浪财经",
                        f"{code} 资金流入趋势",
                        f"https://finance.sina.com.cn/realstock/company/{market_symbol(code, lower=True)}/nc.shtml",
                        tier="secondary",
                    )
                )
                warnings.append(
                    "东方财富资金流不可用，已改用新浪财经逐日资金流入趋势；该口径为全部委托单净流入与超大单净流入，与东方财富“主力（超大单＋大单）”口径不同。"
                )
            except Exception as fallback_exc:
                warnings.append(f"新浪备用资金流获取失败：{type(fallback_exc).__name__}: {fallback_exc}")
        try:
            for row in chip_future.result()[-3:]:
                chips.append(
                    {
                        "date": parse_date(first_value(row, ("日期",))),
                        "average_cost": first_value(row, ("平均成本",)),
                        "profit_ratio_percent": number_or_none(first_value(row, ("获利比例",)), 100),
                        "cost_90_low": first_value(row, ("90成本-低",)),
                        "cost_90_high": first_value(row, ("90成本-高",)),
                        "concentration_90_percent": number_or_none(first_value(row, ("90集中度",)), 100),
                        "source_id": chip_id,
                    }
                )
            if chips:
                provider = str((chip_future.result() or [{}])[0].get("_provider") or "东方财富")
                sources.append(
                    source(
                        chip_id,
                        provider,
                        f"{code} 筹码分布",
                        quote_url(code) if provider == "东方财富" else f"https://gu.qq.com/{market_symbol(code, lower=True)}",
                        tier="secondary",
                    )
                )
                if provider != "东方财富":
                    warnings.append(
                        "东方财富历史行情不可用，筹码成本改用腾讯财经日 K 按同一模型推算；换手率按当前流通股本折算，流通股本变动期间与东方财富口径会有偏差。"
                    )
            else:
                warnings.append("未取得该证券的筹码分布数据。")
        except Exception as exc:
            warnings.append(f"筹码成本获取失败：{type(exc).__name__}: {exc}")
    return response({"daily_main_flow": flow, "chip_cost": chips, "caliber": caliber}, sources, warnings)


@app.get("/api/company/{raw_code}/research")
def research(
    raw_code: str,
    months: int = Query(6, ge=1, le=24),
    refresh: bool = False,
    mode: SourceMode = "official",
) -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")
    if mode == "strict":
        return response(
            {"surveys": [], "reports": []},
            [],
            ["仅官方来源模式不展示二手机构调研统计与卖方研报。"],
            status="empty",
        )
    since = (date.today() - timedelta(days=round(months * 30.44))).isoformat()
    sources: list[dict[str, Any]] = []
    warnings: list[str] = []
    surveys: list[dict[str, Any]] = []
    reports: list[dict[str, Any]] = []
    survey_id = f"eastmoney-survey-{code}"
    report_id = f"eastmoney-research-{code}"

    def load_surveys() -> list[dict[str, Any]]:
        return em_datacenter(
            "RPT_ORG_SURVEY",
            "SECURITY_CODE,NOTICE_DATE,RECEIVE_START_DATE,RECEIVE_OBJECT,RECEIVE_PLACE,"
            "RECEIVE_WAY_EXPLAIN,INVESTIGATORS,RECEPTIONIST,NUMBERNEW",
            f'(IS_SOURCE="1")(SECURITY_CODE="{code}")(RECEIVE_START_DATE>\'{since}\')',
            "RECEIVE_START_DATE",
        )

    def load_reports() -> list[dict[str, Any]]:
        return frame_records(ak.stock_research_report_em(symbol=code))

    with ThreadPoolExecutor(max_workers=2) as pool:
        survey_future = pool.submit(cached, f"surveys_{code}_{months}", 12 * 3600, load_surveys, refresh)
        report_future = pool.submit(cached, f"reports_em_{code}", 12 * 3600, load_reports, refresh)
        try:
            for row in survey_future.result():
                surveys.append(
                    {
                        "survey_date": parse_date(row.get("RECEIVE_START_DATE")),
                        "announced_at": parse_date(row.get("NOTICE_DATE")),
                        "institution_count": row.get("NUMBERNEW"),
                        "receive_way": row.get("RECEIVE_WAY_EXPLAIN"),
                        "receive_object": row.get("RECEIVE_OBJECT"),
                        "receive_place": row.get("RECEIVE_PLACE"),
                        "receptionist": row.get("RECEPTIONIST"),
                        "investigators": row.get("INVESTIGATORS"),
                        "source_id": survey_id,
                    }
                )
            if surveys:
                sources.append(
                    source(
                        survey_id,
                        "东方财富",
                        f"{code} 机构调研记录",
                        "https://data.eastmoney.com/jgdy/",
                        period=f"{since} 至 {date.today().isoformat()}",
                        tier="secondary",
                    )
                )
            else:
                warnings.append(f"最近 {months} 个月未检索到已公告的机构调研记录。")
        except Exception as exc:
            warnings.append(f"机构调研获取失败：{type(exc).__name__}: {exc}")
        try:
            for row in report_future.result():
                published = parse_date(first_value(row, ("日期",)))
                if not published or published < since:
                    continue
                reports.append(
                    {
                        "published_at": published,
                        "title": first_value(row, ("报告名称",)),
                        "institution": first_value(row, ("机构",)),
                        "rating": first_value(row, ("东财评级",)),
                        "url": first_value(row, ("报告PDF链接",)),
                        "source_id": report_id,
                    }
                )
            if reports:
                sources.append(
                    source(
                        report_id,
                        "东方财富",
                        f"{code} 个股研究报告",
                        f"https://data.eastmoney.com/report/{code}.html",
                        period=f"{since} 至 {date.today().isoformat()}",
                        tier="secondary",
                    )
                )
            else:
                warnings.append(f"最近 {months} 个月未检索到卖方研究报告。")
        except Exception as exc:
            warnings.append(f"研究报告获取失败：{type(exc).__name__}: {exc}")
    warnings.append("调研纪要与研报结论未做摘要或改写；请点击原文链接核对机构观点。")
    return response({"surveys": surveys, "reports": reports}, sources, warnings)


NEGATIVE_WORDS = (
    "处罚", "罚款", "警示函", "监管措施", "问询函", "关注函", "立案", "调查", "诉讼", "仲裁",
    "违规", "违法", "更正", "致歉", "退市风险", "风险警示", "被执行", "失信", "冻结",
    "债务逾期", "业绩预减", "业绩预亏", "商誉减值", "停产", "召回",
)


def matched_words(title: str) -> list[str]:
    return [word for word in NEGATIVE_WORDS if word in title]


@app.get("/api/company/{raw_code}/sentiment")
def sentiment(
    raw_code: str,
    months: int = Query(12, ge=1, le=36),
    news_limit: int = Query(5, ge=1, le=30),
    refresh: bool = False,
    mode: SourceMode = "official",
) -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")
    end = date.today()
    start = end - timedelta(days=round(months * 30.44))
    sources: list[dict[str, Any]] = []
    warnings: list[str] = []
    announcements: list[dict[str, Any]] = []
    news: list[dict[str, Any]] = []

    try:
        records = filings_since(filing_index(code, refresh), start.isoformat())
        for index, row in enumerate(records):
            title = str(first_value(row, ("公告标题", "标题", "announcementTitle")) or "")
            words = matched_words(title)
            if not words:
                continue
            published = parse_date(first_value(row, ("公告时间", "公告日期", "announcementTime")))
            url = str(first_value(row, ("公告链接", "网址", "url")) or CNINFO_HOME)
            source_id = f"cninfo-negative-{code}-{published or index}-{index}"
            provider = str(row.get("_provider") or "巨潮资讯")
            sources.append(source(source_id, provider, title, url, published_at=published))
            announcements.append(
                {
                    "published_at": published,
                    "title": title,
                    "url": url,
                    "matched_keywords": words,
                    "source_id": source_id,
                }
            )
        announcements.sort(key=lambda item: item["published_at"] or "", reverse=True)
    except Exception as exc:
        warnings.append(f"公告舆情检索失败：{type(exc).__name__}: {exc}")

    if mode != "strict":
        try:
            records = cached(
                f"news_{code}",
                6 * 3600,
                lambda: frame_records(ak.stock_news_em(symbol=code)),
                refresh,
            )
            dated: list[tuple[str, dict[str, Any]]] = []
            for row in records:
                title = str(first_value(row, ("新闻标题", "标题")) or "").strip()
                url = str(first_value(row, ("新闻链接",)) or "").strip()
                stamp = str(first_value(row, ("发布时间",)) or "").strip()
                published = parse_date(stamp)
                if not title or not url or not published:
                    continue
                dated.append((stamp, {
                    "published_at": published,
                    "published_time": stamp,
                    "event": title,
                    "url": url,
                    "publisher": first_value(row, ("文章来源",)),
                    "matched_keywords": matched_words(title),
                }))
            dated.sort(key=lambda item: item[0], reverse=True)
            for index, (_, item) in enumerate(dated[:news_limit]):
                source_id = f"eastmoney-news-{code}-{index}"
                sources.append(
                    source(
                        source_id,
                        str(item["publisher"] or "东方财富"),
                        item["event"],
                        item["url"],
                        published_at=item["published_at"],
                        tier="secondary",
                    )
                )
                news.append({**item, "source_id": source_id})
            if not news:
                warnings.append("未取得该证券的可链接个股新闻。")
        except Exception as exc:
            warnings.append(f"个股新闻检索失败：{type(exc).__name__}: {exc}")
    else:
        warnings.append("仅官方来源模式不检索二手个股新闻。")

    if not announcements:
        warnings.append(f"最近 {months} 个月的公告标题未命中负面关键词。")
    warnings.append(
        f"公告列表按负面关键词筛选；新闻列表不做筛选，按发布时间倒序取最近 {news_limit} 条，"
        "命中关键词的条目会另行标出。本模块只做标题关键词匹配，不判断事实性质与影响，请核对原文。"
    )
    return response(
        {"announcements": announcements, "news": news, "keywords": list(NEGATIVE_WORDS)},
        sources,
        warnings,
        status=None if announcements or news else "empty",
    )


SSE_COMPANY_PAGE = "https://www.sse.com.cn/assortment/stock/list/info/company/index.shtml?COMPANY_CODE={code}"
SSE_NOTICE_PAGE = "https://www.sse.com.cn/disclosure/listedinfo/announcement/index.shtml?productId={code}"
SZSE_COMPANY_PAGE = "https://www.szse.cn/certificate/individual/index.html?code={code}"
SZSE_NOTICE_PAGE = "https://www.szse.cn/disclosure/listed/notice/index.html"
BSE_COMPANY_PAGE = "https://www.bse.cn/products/neeq_listed_companies/general_information.html?companyCode={code}"
BSE_NOTICE_PAGE = "https://www.bse.cn/products/neeq_listed_companies/related_announcement.html?companyCode={code}"
CNINFO_STOCK_PAGE = "http://www.cninfo.com.cn/new/disclosure/stock?stockCode={code}&orgId={org}"
CNINFO_SEARCH_PAGE = "http://www.cninfo.com.cn/new/fulltextSearch?keyWord={code}"


def sse_company_record(code: str, refresh: bool = False) -> dict[str, Any]:
    def load() -> dict[str, Any]:
        value = requests.get(
            "http://query.sse.com.cn/commonQuery.do",
            params={
                "sqlId": "COMMON_SSE_CP_GPJCTPZ_GPLB_GPGK_GSGK_C",
                "COMPANY_CODE": code,
                "isPagination": "false",
            },
            headers={**BROWSER_HEADERS, "Referer": "http://www.sse.com.cn/"},
            timeout=25,
        )
        value.raise_for_status()
        rows = value.json().get("result") or []
        return rows[0] if rows else {}

    return cached(f"sse_company_{code}", 24 * 3600, load, refresh)


def szse_company_record(code: str, refresh: bool = False) -> dict[str, Any]:
    def load() -> dict[str, Any]:
        value = requests.get(
            "https://www.szse.cn/api/report/index/companyGeneralization",
            params={"secCode": code},
            headers={**BROWSER_HEADERS, "Referer": "https://www.szse.cn/"},
            timeout=25,
        )
        value.raise_for_status()
        payload = value.json()
        return {**(payload.get("data") or {}), "plate": payload.get("plate")}

    return cached(f"szse_company_{code}", 24 * 3600, load, refresh)


def bse_company_record(code: str, refresh: bool = False) -> dict[str, Any]:
    def load() -> dict[str, Any]:
        value = requests.post(
            "https://www.bse.cn/nqxxController/nqxxCnzq.do",
            data={
                "page": "0",
                "typejb": "T",
                "xxfcbj[]": "2",
                "xxzqdm": code,
                "sortfield": "xxzqdm",
                "sorttype": "asc",
            },
            headers=BROWSER_HEADERS,
            timeout=25,
        )
        value.raise_for_status()
        text = value.text
        payload = json.loads(text[text.find("[") : -1])
        rows = (payload[0] or {}).get("content") or []
        return rows[0] if rows else {}

    return cached(f"bse_company_{code}", 24 * 3600, load, refresh)


EXCHANGE_FIELD_MAP = {
    "SSE": (
        ("full_name", ("FULL_NAME",), 1),
        ("english_name", ("FULL_NAME_EN",), 1),
        ("listing_date", ("A_LIST_DATE",), 1),
        ("listing_status", ("STATE_CODE_A_DESC",), 1),
        ("board", ("SEC_TYPE",), 1),
        ("csrc_industry", ("CSRC_GREAT_CODE_DESC",), 1),
        ("legal_representative", ("LEGAL_REPRESENTATIVE",), 1),
        ("secretary", ("NAME",), 1),
        ("registered_address", ("REG_ADDRESS",), 1),
        ("office_address", ("OFFICE_ADDRESS",), 1),
        ("area", ("AREA_NAME",), 1),
        ("email", ("E_MAIL_ADDRESS",), 1),
        ("investor_phone", ("INVESTOR_PHONE",), 1),
    ),
    "SZSE": (
        ("full_name", ("gsqc",), 1),
        ("english_name", ("ywqc",), 1),
        ("listing_date", ("agssrq",), 1),
        ("board", ("plate",), 1),
        ("csrc_industry", ("sshymc",), 1),
        ("registered_address", ("zcdz",), 1),
        ("area", ("sheng", "dldq"), 1),
        ("website", ("http",), 1),
        ("total_shares", ("agzgb",), 10000),
        ("float_shares", ("agltgb",), 10000),
    ),
    "BSE": (
        ("english_name", ("xxywjc",), 1),
        ("listing_date", ("xxgprq", "fxssrq"), 1),
        ("csrc_industry", ("xxhyzl",), 1),
        ("area", ("xxssdq",), 1),
        ("total_shares", ("xxzgb",), 1),
        ("float_shares", ("xxfxsgb",), 1),
        ("transfer_mode", ("xxzrlx",), 1),
        ("sponsor", ("xxzbqs",), 1),
    ),
}
EXCHANGE_PUBLISHER = {"SSE": "上海证券交易所", "SZSE": "深圳证券交易所", "BSE": "北京证券交易所"}
SZSE_BOARDS = {"CY": "创业板", "ZB": "主板", "Z": "主板", "ZX": "中小板"}


def exchange_org_id(code: str, refresh: bool = False) -> str | None:
    try:
        for row in filing_index(code, refresh):
            match = re.search(r"orgId=([A-Za-z0-9]+)", str(first_value(row, ("公告链接", "网址", "url")) or ""))
            if match:
                return match.group(1)
    except Exception:
        return None
    return None


@app.get("/api/company/{raw_code}/exchange")
def exchange(raw_code: str, refresh: bool = False, mode: SourceMode = "official") -> dict[str, Any]:
    try:
        code = normalize_code(raw_code)
        lookup_company(code)
    except ValueError as exc:
        return response({}, [], [str(exc)], status="error")

    market = exchange_for(code)
    publisher = EXCHANGE_PUBLISHER[market]
    warnings: list[str] = []
    sources: list[dict[str, Any]] = []
    company_page = {
        "SSE": SSE_COMPANY_PAGE,
        "SZSE": SZSE_COMPANY_PAGE,
        "BSE": BSE_COMPANY_PAGE,
    }[market].format(code=code)
    notice_page = {
        "SSE": SSE_NOTICE_PAGE,
        "SZSE": SZSE_NOTICE_PAGE,
        "BSE": BSE_NOTICE_PAGE,
    }[market].format(code=code)

    source_id = f"{market.lower()}-company-{code}"
    src = source(source_id, publisher, f"{code} 交易所上市公司信息", company_page)
    loader = {"SSE": sse_company_record, "SZSE": szse_company_record, "BSE": bse_company_record}[market]
    profile: dict[str, Any] = {}
    try:
        record = loader(code, refresh)
        for key, names, multiplier in EXCHANGE_FIELD_MAP[market]:
            raw = first_value(record, names)
            if isinstance(raw, str):
                raw = raw.strip()
                if raw in ("", "-", "--"):
                    raw = None
            if raw is None:
                continue
            if key in ("total_shares", "float_shares"):
                raw = number_or_none(str(raw).replace(",", ""), multiplier)
            if key == "board":
                raw = SZSE_BOARDS.get(str(raw), raw)
            if key == "listing_date":
                raw = parse_date(raw)
            item = field(raw, source_id)
            if item:
                profile[key] = item
        if profile:
            sources.append(src)
        else:
            warnings.append(f"{publisher}未返回该证券的上市公司登记信息。")
    except Exception as exc:
        warnings.append(f"{publisher}上市公司信息获取失败：{type(exc).__name__}: {exc}")

    org_id = exchange_org_id(code, refresh)
    links = [
        {"label": f"{publisher}·公司概况", "url": company_page, "publisher": publisher, "tier": "official"},
        {"label": f"{publisher}·公司公告", "url": notice_page, "publisher": publisher, "tier": "official"},
        {
            "label": "巨潮资讯·公司披露主页",
            "url": CNINFO_STOCK_PAGE.format(code=code, org=org_id) if org_id else CNINFO_SEARCH_PAGE.format(code=code),
            "publisher": "巨潮资讯",
            "tier": "official",
        },
    ]
    if not org_id:
        warnings.append("未取得巨潮机构编号，公司披露主页链接降级为全文检索。")
    warnings.append(
        "交易所页面为动态加载，链接直达该公司条目；巨潮资讯是证监会指定的信息披露平台，年报等定期报告原文以其发布为准。"
    )
    return response({"market": market, "publisher": publisher, "profile": profile, "links": links}, sources, warnings)


@app.get("/api/health")
def health() -> dict[str, Any]:
    checks: dict[str, Any] = {"service": "ok", "cache_dir": str(CACHE_DIR)}
    warnings: list[str] = []
    try:
        audit = stock_master_audit(stock_master())
        checks["stock_master_count"] = audit["total"]
        checks["stock_master"] = "ok"
        checks["stock_master_coverage"] = audit
        if not audit["integrity_ok"]:
            warnings.append("股票代码表完整性检查未通过。")
    except Exception as exc:
        checks["stock_master"] = "error"
        warnings.append(f"股票代码表上游不可用：{type(exc).__name__}: {exc}")
    return response(checks, [], warnings, status="ok" if not warnings else "partial")


@app.get("/api/coverage")
def coverage(refresh: bool = False) -> dict[str, Any]:
    try:
        audit = stock_master_audit(stock_master(refresh))
    except Exception as exc:
        return response(
            {},
            [],
            [f"股票代码表覆盖检查失败：{type(exc).__name__}: {exc}"],
            status="error",
        )

    warnings: list[str] = []
    official_sources = set(audit["refresh"].get("official_sources", []))
    for exchange, source_id in MASTER_OFFICIAL_SOURCE.items():
        if source_id not in official_sources:
            warnings.append(
                f"{'上交所' if exchange == 'SSE' else '深交所' if exchange == 'SZSE' else '北交所'}"
                "官方代码表本轮未完成核验；搜索范围已由备用全市场表与最近缓存补齐。"
            )
    if not audit["integrity_ok"]:
        warnings.append("代码表存在空市场、重复代码或非六位代码。")
    used_source_ids = {
        source_id for source_id, count in audit["source_counts"].items() if count
    }
    return response(
        audit,
        [master_source(source_id) for source_id in used_source_ids],
        warnings,
        status="ok" if not warnings else "partial",
    )

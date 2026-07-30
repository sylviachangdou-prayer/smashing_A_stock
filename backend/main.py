from __future__ import annotations

import io
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Callable, Literal

import akshare as ak
import pandas as pd
import requests
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / ".cache" / "stock_tool"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CNINFO_HOME = "https://www.cninfo.com.cn/new/index"
EASTMONEY_QUOTE = "https://quote.eastmoney.com/"
TZ = timezone(timedelta(hours=8))
CNINFO_JS_LOCK = Lock()
_REQUEST = requests.sessions.Session.request
SourceMode = Literal["official", "strict", "structured"]


def _request_with_default_timeout(self: requests.Session, method: str, url: str, **kwargs: Any):
    kwargs.setdefault("timeout", 15)
    return _REQUEST(self, method, url, **kwargs)


requests.sessions.Session.request = _request_with_default_timeout

app = FastAPI(title="A股信息查询本地服务", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


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


def cached(key: str, ttl_seconds: int, loader: Callable[[], Any], refresh: bool = False) -> Any:
    path = cache_file(key)
    if not refresh and path.exists() and time.time() - path.stat().st_mtime < ttl_seconds:
        return json.loads(path.read_text(encoding="utf-8"))
    value = loader()
    path.write_text(json.dumps(value, ensure_ascii=False, default=clean_scalar), encoding="utf-8")
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
}


def master_source(source_id: str) -> dict[str, Any]:
    publisher, title, url, tier = MASTER_SOURCES[source_id]
    return source(source_id, publisher, title, url, tier=tier)


def stock_master(refresh: bool = False) -> list[dict[str, str]]:
    def load() -> list[dict[str, str]]:
        batches: list[tuple[list[dict[str, Any]], str]] = []
        official_loaders = (
            (lambda: frame_records(ak.stock_info_sh_name_code(symbol="主板A股")), "sse-stock-list"),
            (lambda: frame_records(ak.stock_info_sh_name_code(symbol="科创板")), "sse-stock-list"),
            (lambda: frame_records(ak.stock_info_sz_name_code(symbol="A股列表")), "szse-stock-list"),
            (lambda: frame_records(ak.stock_info_bj_name_code()), "bse-stock-list"),
        )
        with ThreadPoolExecutor(max_workers=4) as pool:
            future_sources = {pool.submit(loader): source_id for loader, source_id in official_loaders}
            for future in as_completed(future_sources):
                try:
                    rows = future.result()
                    if rows:
                        batches.append((rows, future_sources[future]))
                except Exception:
                    continue
        covered = {source_id for _, source_id in batches}
        missing_exchange = {
            "SSE": "sse-stock-list" not in covered,
            "SZSE": "szse-stock-list" not in covered,
            "BSE": "bse-stock-list" not in covered,
        }
        if any(missing_exchange.values()):
            for loader, source_id in (
                (ak.stock_zh_a_spot_em, "eastmoney-stock-list"),
                (ak.stock_zh_a_spot, "sina-stock-list"),
            ):
                try:
                    fallback = frame_records(loader())
                    if fallback:
                        batches.append((fallback, source_id))
                        break
                except Exception:
                    continue
        output: list[dict[str, str]] = []
        seen: set[str] = set()
        for rows, source_id in batches:
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
                exchange = exchange_for(code)
                if source_id == "eastmoney-stock-list" and not missing_exchange.get(exchange):
                    continue
                if re.fullmatch(r"\d{6}", code) and name and code not in seen:
                    seen.add(code)
                    output.append(
                        {
                            "code": code,
                            "name": name,
                            "exchange": exchange,
                            "market": market_label(code),
                            "source_id": source_id,
                        }
                    )
        return output

    return cached("stock_master", 24 * 3600, load, refresh)


def lookup_company(code: str, refresh: bool = False) -> dict[str, str]:
    company = next((item for item in stock_master(refresh) if item["code"] == code), None)
    if not company:
        raise ValueError(f"未在当前沪深北 A 股代码表中找到 {code}")
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
    end = date.today().strftime("%Y%m%d")
    start = (date.today() - timedelta(days=500)).strftime("%Y%m%d")

    def load() -> list[dict[str, Any]]:
        return frame_records(
            ak.stock_zh_a_disclosure_report_cninfo(
                symbol=code,
                market="沪深京",
                start_date=start,
                end_date=end,
            )
        )

    records = cached(f"reports_{code}", 24 * 3600, load, refresh)
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


def profile_data(code: str, refresh: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    def load() -> list[dict[str, Any]]:
        with CNINFO_JS_LOCK:
            return frame_records(ak.stock_profile_cninfo(symbol=code))

    records = cached(f"profile_{code}", 12 * 3600, load, refresh)
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
    wanted = [latest]
    previous = f"{int(latest[:4]) - 1}{latest[4:]}"
    if previous in dates:
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

    return (
        cached(f"profit_{code}", 12 * 3600, profit, refresh),
        cached(f"balance_{code}", 12 * 3600, balance, refresh),
    )


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
                "revenue_share_percent": first_value(row, ("收入比例", "主营收入占比")),
                "gross_margin_percent": first_value(row, ("毛利率",)),
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
                    "shares": first_value(row, ("持股数量", "HOLD_NUM")),
                    "ratio_percent": first_value(row, ("占总股本持股比例", "持股比例", "HOLD_RATIO")),
                    "change": first_value(row, ("持股变动", "增减", "HOLD_NUM_CHANGE")),
                    "holder_type": first_value(row, ("股东性质", "HOLDER_TYPE")),
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
        records = cached("market_headlines", 10 * 60, load, refresh)
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


@app.get("/api/search")
def search(q: str = Query(min_length=1), refresh: bool = False) -> dict[str, Any]:
    try:
        items = stock_master(refresh)
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
            [] if results else ["没有匹配的当前上市 A 股。"],
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
    try:
        if mode == "structured":
            profile, profile_src = profile_data_structured(code, refresh)
        else:
            profile, profile_src = profile_data(code, refresh)
        sources.append(profile_src)
    except Exception as exc:
        warnings.append(f"公司概况获取失败：{type(exc).__name__}: {exc}")
    if mode != "strict":
        try:
            if mode == "official":
                financial, financial_sources, financial_warnings = financial_data(code, refresh)
            else:
                financial, financial_sources, financial_warnings = financial_data(
                    code,
                    refresh,
                    link_official_report=False,
                )
            sources.extend(financial_sources)
            warnings.extend(financial_warnings)
        except Exception as exc:
            warnings.append(f"财务数据获取失败：{type(exc).__name__}: {exc}")
        try:
            segments, segment_src = business_segments(code, refresh)
            if segment_src:
                sources.append(segment_src)
            else:
                warnings.append("未取得最近年报或半年报主营构成。")
        except Exception as exc:
            warnings.append(f"主营构成获取失败：{type(exc).__name__}: {exc}")
    else:
        warnings.append("仅官方来源模式未展示缺少官方结构化接口的财务、主营构成和股东数值。")
    if mode != "strict":
        try:
            periods = [item["period"] for item in financial.get("annual_metrics", [])]
            latest = financial.get("period")
            if latest:
                periods.insert(0, latest)
                try:
                    year = int(latest[:4])
                    for suffix in ("09-30", "06-30", "03-31", "12-31"):
                        candidate = f"{year}-{suffix}"
                        if candidate <= latest and candidate not in periods:
                            periods.append(candidate)
                    periods.append(f"{year - 1}-12-31")
                except ValueError:
                    pass
            cursor_year = date.today().year
            for year in range(cursor_year, cursor_year - 3, -1):
                for suffix in ("12-31", "09-30", "06-30", "03-31"):
                    candidate = f"{year}-{suffix}"
                    if candidate <= date.today().isoformat() and candidate not in periods:
                        periods.append(candidate)
            shareholders, shareholder_sources, shareholder_warnings = shareholder_data(code, periods, refresh)
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

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch, day): day for day in candidates}
        for future in as_completed(futures):
            day = futures[future]
            try:
                _, rows = future.result()
                if rows:
                    found.append((day, rows[0]))
            except Exception:
                continue
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

    def load() -> list[dict[str, Any]]:
        return frame_records(
            ak.stock_zh_a_disclosure_report_cninfo(
                symbol=code,
                market="沪深京",
                start_date=start.strftime("%Y%m%d"),
                end_date=end.strftime("%Y%m%d"),
            )
        )

    try:
        records = cached(f"announcements_{code}_{months}", 24 * 3600, load, refresh)
    except Exception as exc:
        return response([], [], [f"巨潮公告查询失败：{type(exc).__name__}: {exc}"], status="error")
    records.sort(
        key=lambda row: parse_date(first_value(row, ("公告时间", "公告日期", "announcementTime"))) or "",
        reverse=True,
    )
    matches = []
    sources = []
    for index, row in enumerate(records):
        title = str(first_value(row, ("公告标题", "标题", "announcementTitle")) or "")
        if not any(word in title for word in CONTRACT_WORDS):
            continue
        published = parse_date(first_value(row, ("公告时间", "公告日期", "announcementTime")))
        url = str(first_value(row, ("公告链接", "网址", "url")) or CNINFO_HOME)
        source_id = f"cninfo-contract-{code}-{published or index}"
        src = source(source_id, "巨潮资讯", title, url, published_at=published)
        sources.append(src)
        item: dict[str, Any] = {
            "title": title,
            "published_at": published,
            "url": url,
            "source_id": source_id,
        }
        if mode != "structured":
            try:
                item.update(extract_contract_fields(url))
            except Exception:
                pass
        matches.append(item)
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


@app.get("/api/health")
def health() -> dict[str, Any]:
    checks: dict[str, Any] = {"service": "ok", "cache_dir": str(CACHE_DIR)}
    warnings: list[str] = []
    try:
        checks["stock_master_count"] = len(stock_master())
        checks["stock_master"] = "ok"
    except Exception as exc:
        checks["stock_master"] = "error"
        warnings.append(f"股票代码表上游不可用：{type(exc).__name__}: {exc}")
    return response(checks, [], warnings, status="ok" if not warnings else "partial")

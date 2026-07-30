"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type SourceRef = {
  source_id: string;
  publisher: string;
  title: string;
  url: string;
  period?: string | null;
  published_at?: string | null;
  retrieved_at: string;
  tier: "official" | "secondary";
};

type SourceMode = "official" | "strict" | "structured";

type Sourced<T = string | number> = {
  value: T;
  source_id: string;
  period?: string;
};

type ApiResponse<T> = {
  data: T;
  sources: SourceRef[];
  warnings: string[];
  as_of: string;
  status: "ok" | "partial" | "empty" | "error";
};

type SearchItem = {
  code: string;
  name: string;
  exchange: string;
  market: string;
};

type MarketBriefData = {
  headlines: Array<{
    title: string;
    summary?: string;
    published_at?: string;
    url: string;
    source_id: string;
  }>;
};

type Metric = {
  value: number;
  previous_value?: number;
  yoy_percent?: number;
  source_id: string;
  period?: string;
};

type OverviewData = {
  identity: {
    code?: Sourced;
    name?: Sourced;
    exchange?: Sourced;
    market?: Sourced;
  };
  profile: Record<string, Sourced | undefined>;
  financial: {
    period?: string;
    metrics?: Record<string, Metric>;
    annual_metrics?: Array<{
      period: string;
      revenue?: number;
      net_profit?: number;
      source_id: string;
    }>;
  };
  shareholders: Array<{
    period: string;
    name?: string;
    shares?: number;
    ratio_percent?: number;
    change?: string | number;
    holder_type?: string;
    source_id: string;
  }>;
  business_segments: Array<{
    category_type?: string;
    name: string;
    revenue: number;
    revenue_share_percent?: number;
    gross_margin_percent?: number;
    period?: string;
    source_id: string;
  }>;
};

type CapitalData = {
  daily_margin: Array<{
    date: string;
    financing_buy?: number;
    financing_repay?: number;
    financing_balance?: number;
    financing_balance_change?: number | null;
    securities_lending_sell?: number;
    securities_lending_repay?: number;
    securities_lending_balance?: number;
    margin_total?: number;
    source_id: string;
  }>;
  institution_signals: Array<Record<string, unknown>>;
};

type ContractRow = {
  title: string;
  published_at?: string;
  url: string;
  counterparty?: string;
  amount_text?: string;
  source_id: string;
};

type PeersData = {
  label?: string;
  industry?: Sourced;
  board_name?: Sourced;
  companies?: Array<{
    code: string;
    name?: string;
    latest_price?: number;
    market_cap?: number;
    source_id: string;
  }>;
};

type ReportState = {
  company: SearchItem;
  sourceMode: SourceMode;
  overview?: ApiResponse<OverviewData>;
  capital?: ApiResponse<CapitalData>;
  contracts?: ApiResponse<ContractRow[]>;
  peers?: ApiResponse<PeersData>;
  loading: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8010";
const HISTORY_LIMITS = [5, 10, 20, 50];
const HISTORY_STORAGE_KEY = "stock-tool-search-history";
const HISTORY_LIMIT_STORAGE_KEY = "stock-tool-search-history-limit";
const SOURCE_MODES: Record<SourceMode, { label: string; description: string }> = {
  official: {
    label: "官方披露优先",
    description: "官方原文为核验锚点，二手接口仅用于结构化字段。",
  },
  strict: {
    label: "仅官方来源",
    description: "排除二手结构化数值；没有官方可用字段时保持缺失。",
  },
  structured: {
    label: "结构化数据优先",
    description: "减少官方回链和 PDF 抽取，以明确标注的结构化接口优先。",
  },
};

async function getJson<T>(path: string): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function searchCompanies(keyword: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(keyword)}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: ApiResponse<SearchItem[]> = await response.json();
  return payload.data ?? [];
}

function sourceMap(report?: ReportState) {
  const sources = [
    ...(report?.overview?.sources ?? []),
    ...(report?.capital?.sources ?? []),
    ...(report?.contracts?.sources ?? []),
    ...(report?.peers?.sources ?? []),
  ];
  return new Map(sources.map((item) => [item.source_id, item]));
}

function formatMoney(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  const absolute = Math.abs(number);
  if (absolute >= 1e8) return `${(number / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 亿元`;
  if (absolute >= 1e4) return `${(number / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万元`;
  return `${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元`;
}

function formatNumber(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatPercent(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
}

function SourceLink({
  sourceId,
  sources,
  compact = false,
}: {
  sourceId?: string;
  sources: Map<string, SourceRef>;
  compact?: boolean;
}) {
  const item = sourceId ? sources.get(sourceId) : undefined;
  if (!item) return null;
  return (
    <a
      className={compact ? "source-link compact" : "source-link"}
      href={item.url}
      target="_blank"
      rel="noreferrer"
      title={item.title}
    >
      {item.publisher} ↗
    </a>
  );
}

function StatusBadge({ response }: { response?: ApiResponse<unknown> }) {
  if (!response) return <span className="status-badge loading">读取中</span>;
  return <span className={`status-badge ${response.status}`}>{response.status}</span>;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [reports, setReports] = useState<Record<string, ReportState>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [activeCode, setActiveCode] = useState("");
  const [notice, setNotice] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("official");
  const [history, setHistory] = useState<SearchItem[]>([]);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [historyReady, setHistoryReady] = useState(false);
  const [marketBrief, setMarketBrief] = useState<ApiResponse<MarketBriefData> | null>(null);
  const requestIds = useRef<Record<string, number>>({});

  const active = activeCode ? reports[activeCode] : undefined;
  const sources = useMemo(() => sourceMap(active), [active]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedLimit = Number(window.localStorage.getItem(HISTORY_LIMIT_STORAGE_KEY));
        const nextLimit = HISTORY_LIMITS.includes(storedLimit) ? storedLimit : 10;
        const storedHistory = JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]");
        const validHistory = Array.isArray(storedHistory)
          ? storedHistory.filter((item) => item?.code && item?.name).slice(0, nextLimit)
          : [];
        setHistoryLimit(nextLimit);
        setHistory(validHistory);
      } catch {
        setHistory([]);
      } finally {
        setHistoryReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, historyLimit)));
    window.localStorage.setItem(HISTORY_LIMIT_STORAGE_KEY, String(historyLimit));
  }, [history, historyLimit, historyReady]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/market-brief`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ApiResponse<MarketBriefData>>;
      })
      .then(setMarketBrief)
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setMarketBrief(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        setSuggestions(await searchCompanies(keyword, controller.signal));
      } catch (error) {
        if ((error as Error).name !== "AbortError") setNotice("无法连接本地数据服务。请运行 npm run local。");
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  async function loadCompany(company: SearchItem, refresh = false, mode = sourceMode) {
    if (!refresh && reports[company.code]?.sourceMode === mode) {
      setActiveCode(company.code);
      return;
    }
    if (!reports[company.code] && selected.length >= 5) {
      setNotice("最多同时保留 5 家公司。");
      return;
    }
    setSelected((current) => (current.includes(company.code) ? current : [...current, company.code]));
    setActiveCode(company.code);
    setQuery("");
    setSuggestions([]);
    setReports((current) => ({
      ...current,
      [company.code]: { company, sourceMode: mode, loading: true },
    }));
    const requestId = (requestIds.current[company.code] ?? 0) + 1;
    requestIds.current[company.code] = requestId;
    const modeParam = `mode=${mode}`;
    const suffix = `?${modeParam}${refresh ? "&refresh=true" : ""}`;
    const [overview, capital, contracts, peers] = await Promise.allSettled([
      getJson<OverviewData>(`/api/company/${company.code}/overview${suffix}`),
      getJson<CapitalData>(`/api/company/${company.code}/capital?days=20&${modeParam}${refresh ? "&refresh=true" : ""}`),
      getJson<ContractRow[]>(`/api/company/${company.code}/contracts?months=24&${modeParam}${refresh ? "&refresh=true" : ""}`),
      getJson<PeersData>(`/api/company/${company.code}/peers${suffix}`),
    ]);
    if (requestIds.current[company.code] !== requestId) return;
    const failed = <T,>(result: PromiseSettledResult<ApiResponse<T>>, label: string): ApiResponse<T> =>
      result.status === "fulfilled"
        ? result.value
        : {
            data: {} as T,
            sources: [],
            warnings: [`${label}请求失败：${result.reason instanceof Error ? result.reason.message : "未知错误"}`],
            as_of: new Date().toISOString(),
            status: "error",
          };
    setReports((current) => ({
      ...current,
      [company.code]: {
        company,
        sourceMode: mode,
        overview: failed(overview, "公司总览"),
        capital: failed(capital, "资金面"),
        contracts: failed(contracts, "合同公告"),
        peers: failed(peers, "同业"),
        loading: false,
      },
    }));
  }

  function changeSourceMode(mode: SourceMode) {
    setSourceMode(mode);
    if (active) void loadCompany(active.company, true, mode);
  }

  function rememberCompany(company: SearchItem) {
    setHistory((current) => [
      company,
      ...current.filter((item) => item.code !== company.code),
    ].slice(0, historyLimit));
  }

  function changeHistoryLimit(limit: number) {
    setHistoryLimit(limit);
    setHistory((current) => current.slice(0, limit));
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const keyword = query.trim();
    if (!keyword) return;
    setSearching(true);
    setNotice("");
    try {
      const matches = await searchCompanies(keyword);
      setSuggestions(matches);
      const normalized = keyword.toLowerCase();
      const match = matches.find(
        (company) => company.code.toLowerCase() === normalized || company.name.toLowerCase() === normalized,
      ) ?? matches[0];
      if (match) {
        rememberCompany(match);
        await loadCompany(match);
      } else {
        setNotice("未找到匹配的当前上市 A 股。");
      }
    } catch {
      setNotice("无法连接本地数据服务。请运行 npm run local。");
    } finally {
      setSearching(false);
    }
  }

  function removeCompany(code: string) {
    const next = selected.filter((item) => item !== code);
    setSelected(next);
    if (activeCode === code) setActiveCode(next[0] ?? "");
  }

  const comparison = useMemo(() => {
    const loaded = selected
      .map((code) => reports[code])
      .filter((item) => item?.sourceMode === sourceMode && item?.overview?.data.financial);
    if (loaded.length < 2) return null;
    const periodSets = loaded.map(
      (item) => new Set((item.overview?.data.financial.annual_metrics ?? []).map((row) => row.period)),
    );
    const common = [...periodSets[0]].filter((period) => periodSets.every((set) => set.has(period))).sort().reverse()[0];
    if (!common) return null;
    return {
      period: common,
      rows: loaded.map((item) => ({
        company: item.company,
        metric: item.overview?.data.financial.annual_metrics?.find((row) => row.period === common),
        sources: sourceMap(item),
      })),
    };
  }, [reports, selected, sourceMode]);

  const metrics = active?.overview?.data.financial.metrics ?? {};
  const profile = active?.overview?.data.profile ?? {};
  const shareholders = active?.overview?.data.shareholders ?? [];
  const latestShareholderPeriod = shareholders[0]?.period;
  const latestShareholders = shareholders.filter((item) => item.period === latestShareholderPeriod);
  const segments = active?.overview?.data.business_segments ?? [];
  const margin = active?.capital?.data.daily_margin ?? [];
  const contractRows = active?.contracts?.data ?? [];
  const peerRows = active?.peers?.data.companies ?? [];
  const allWarnings = [
    ...(active?.overview?.warnings ?? []).map((text) => `总览：${text}`),
    ...(active?.capital?.warnings ?? []).map((text) => `资金：${text}`),
    ...(active?.contracts?.warnings ?? []).map((text) => `合同：${text}`),
    ...(active?.peers?.warnings ?? []).map((text) => `同业：${text}`),
  ];

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark"><Image src="/niu-oracle.svg" alt="甲骨文牛字" width={28} height={28} /></span>
          <span><b>A股公司研究台</b><small>LOCAL DISCLOSURE RESEARCH</small></span>
        </a>
        <nav>
          <a href="#overview">公司总览</a>
          <a href="#capital">两融</a>
          <a href="#sources">来源</a>
        </nav>
        <label className="source-mode">
          <i />
          <span>来源模式</span>
          <select
            value={sourceMode}
            onChange={(event) => changeSourceMode(event.target.value as SourceMode)}
            aria-label="来源模式"
          >
            {Object.entries(SOURCE_MODES).map(([value, option]) => (
              <option key={value} value={value}>{option.label}</option>
            ))}
          </select>
        </label>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">A-SHARE DISCLOSURE INTELLIGENCE</p>
          <h1>今天准能行。</h1>
          <p className="hero-copy">
            输入沪深北 A 股公司名称或六位代码。财务、股东、两融、合同公告与同业模块独立读取，单一上游失败不会阻塞整份报告。
          </p>
        </div>
        <div className="hero-stat">
          <span>当前范围</span>
          <strong>沪 · 深 · 北</strong>
          <p>公司概况、财务、股东、主营、两融、合同公告与同业比较；最多保留 5 家公司。</p>
          <small>{SOURCE_MODES[sourceMode].label}：{SOURCE_MODES[sourceMode].description}</small>
        </div>
      </section>

      <section className="search-panel">
        <form className="search-row" onSubmit={submitSearch}>
          <label>
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="公司名称或代码，如：贵州茅台 / 600519"
              aria-label="公司名称或股票代码"
            />
          </label>
          <button type="submit">{searching ? "查询中…" : "开始研究"}</button>
        </form>
        {query && suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((company) => (
              <button key={company.code} onClick={() => { rememberCompany(company); void loadCompany(company); }}>
                <span className="company-dot" />
                <b>{company.name}</b>
                <small>{company.code} · {company.market}</small>
              </button>
            ))}
          </div>
        )}
        <div className="search-lists">
          <div className="memory-group">
            <div className="memory-heading"><span>研究列表</span><small>最多 5 家</small></div>
            <div className="memory-chips">
              {selected.length === 0 && <small>暂无</small>}
              {selected.map((code) => {
                const report = reports[code];
                return (
                  <button
                    key={code}
                    className={`company-chip ${code === activeCode ? "active" : ""}`}
                    onClick={() => report && loadCompany(report.company)}
                  >
                    {report?.company.name ?? code} <small>{code}</small>
                    <i onClick={(event) => { event.stopPropagation(); removeCompany(code); }}>×</i>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="memory-group">
            <div className="memory-heading">
              <span>历史搜索</span>
              <label>
                保留
                <select
                  value={historyLimit}
                  onChange={(event) => changeHistoryLimit(Number(event.target.value))}
                  aria-label="历史搜索保留条数"
                >
                  {HISTORY_LIMITS.map((limit) => <option key={limit} value={limit}>{limit} 条</option>)}
                </select>
              </label>
            </div>
            <div className="memory-chips">
              {history.length === 0 && <small>暂无</small>}
              {history.map((company) => (
                <button key={company.code} className="history-chip" onClick={() => loadCompany(company)}>
                  {company.name} <small>{company.code}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
        {notice && <button className="notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      </section>

      {(!active || (active.loading && !active.overview)) && (marketBrief?.data.headlines.length ?? 0) > 0 && (
        <section className="market-brief">
          <div className="section-heading">
            <div><span>LIVE MARKET BRIEF</span><h2>今日全球财经头条</h2></div>
            <p>由公开财经信息流整理；点击标题查看原文，新闻不参与公司研究结论。</p>
          </div>
          <div className="headline-grid">
            {marketBrief!.data.headlines.map((headline) => (
              <a key={headline.source_id} href={headline.url} target="_blank" rel="noreferrer">
                <small>{headline.published_at?.slice(5, 16) ?? "最新"} · 东方财富</small>
                <h3>{headline.title}</h3>
                {headline.summary && <p>{headline.summary}</p>}
              </a>
            ))}
          </div>
        </section>
      )}

      {comparison && (
        <section className="compare-section">
          <div className="section-heading">
            <div><span>COMMON ANNUAL PERIOD</span><h2>共同完整年度比较</h2></div>
            <p>仅比较所有已选公司均有数据的最近完整年度：{comparison.period}</p>
          </div>
          <div className="table-wrap panel">
            <table>
              <thead><tr><th>公司</th><th>营业收入</th><th>归母净利润</th><th>来源</th></tr></thead>
              <tbody>
                {comparison.rows.map(({ company, metric, sources: rowSources }) => (
                  <tr key={company.code}>
                    <td><b>{company.name}</b><small>{company.code}</small></td>
                    <td>{formatMoney(metric?.revenue)}</td>
                    <td>{formatMoney(metric?.net_profit)}</td>
                    <td><SourceLink sourceId={metric?.source_id} sources={rowSources} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {active && (
        <section className="report-shell">
          <div className="report-head">
            <div className="company-monogram">{active.company.name.slice(0, 1)}</div>
            <div>
              <p>{active.company.market} · {active.company.exchange}</p>
              <h2>{active.company.name} <span>{active.company.code}</span></h2>
              <small>报告抓取时间：{active.overview?.as_of ? new Date(active.overview.as_of).toLocaleString("zh-CN") : "读取中"}</small>
            </div>
            <button
              className="refresh"
              disabled={active.loading}
              onClick={() => loadCompany(active.company, true)}
            >
              {active.loading ? "读取中…" : "绕过缓存刷新"}
            </button>
          </div>

          {active.loading && !active.overview && (
            <div className="loading-panel">
              <p>正在从公开数据源读取四个独立模块…</p>
              <small>预计仍需约 {sourceMode === "official" ? "1–2" : "1"} 分钟；上游接口拥塞时可能延长。</small>
            </div>
          )}

          {active.overview && (
            <section className="report-section" id="overview">
              <div className="section-heading">
                <div><span>OVERVIEW</span><h2>公司概况与核心财务</h2></div>
                <p>收入与归母净利润采用最新报告期及上年同期；金额单位由原始报表统一为人民币元。</p>
              </div>
              <div className="metric-grid">
                {metrics.revenue && (
                  <article>
                    <span>营业收入 · {metrics.revenue.period}</span>
                    <strong>{formatMoney(metrics.revenue.value)}</strong>
                    <small className={(metrics.revenue.yoy_percent ?? 0) >= 0 ? "positive" : "negative"}>
                      同比 {formatPercent(metrics.revenue.yoy_percent)}
                    </small>
                    <SourceLink sourceId={metrics.revenue.source_id} sources={sources} compact />
                  </article>
                )}
                {metrics.net_profit && (
                  <article>
                    <span>归母净利润 · {metrics.net_profit.period}</span>
                    <strong>{formatMoney(metrics.net_profit.value)}</strong>
                    <small className={(metrics.net_profit.yoy_percent ?? 0) >= 0 ? "positive" : "negative"}>
                      同比 {formatPercent(metrics.net_profit.yoy_percent)}
                    </small>
                    <SourceLink sourceId={metrics.net_profit.source_id} sources={sources} compact />
                  </article>
                )}
                {metrics.contract_liabilities && (
                  <article>
                    <span>合同负债 · {metrics.contract_liabilities.period}</span>
                    <strong>{formatMoney(metrics.contract_liabilities.value)}</strong>
                    <small>上年同期 {formatMoney(metrics.contract_liabilities.previous_value)}</small>
                    <SourceLink sourceId={metrics.contract_liabilities.source_id} sources={sources} compact />
                  </article>
                )}
                {metrics.accounts_receivable && (
                  <article>
                    <span>应收账款 · {metrics.accounts_receivable.period}</span>
                    <strong>{formatMoney(metrics.accounts_receivable.value)}</strong>
                    <small>上年同期 {formatMoney(metrics.accounts_receivable.previous_value)}</small>
                    <SourceLink sourceId={metrics.accounts_receivable.source_id} sources={sources} compact />
                  </article>
                )}
              </div>

              {(profile.company_name || profile.main_business || profile.industry) && (
                <article className="panel profile-panel">
                  <div className="panel-title"><div><span>COMPANY PROFILE</span><h3>主要业务与基本信息</h3></div></div>
                  {profile.main_business && <p className="business-copy">{String(profile.main_business.value)}</p>}
                  <dl className="profile-grid">
                    {[
                      ["公司全称", profile.company_name],
                      ["所属行业", profile.industry],
                      ["法定代表人", profile.legal_representative],
                      ["注册资本", profile.registered_capital],
                      ["上市日期", profile.listing_date],
                      ["办公地址", profile.office_address],
                    ].map(([label, item]) => item && (
                      <div key={String(label)}>
                        <dt>{label}</dt>
                        <dd>{String((item as Sourced).value)}</dd>
                        <SourceLink sourceId={(item as Sourced).source_id} sources={sources} compact />
                      </div>
                    ))}
                  </dl>
                </article>
              )}

              {latestShareholders.length > 0 && (
                <article className="panel">
                  <div className="panel-title">
                    <div><span>OWNERSHIP</span><h3>前十大股东</h3></div>
                    <small>{latestShareholderPeriod}</small>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>股东</th><th>类型</th><th>持股数量</th><th>持股比例</th><th>较上期</th><th>来源</th></tr></thead>
                      <tbody>{latestShareholders.map((holder, index) => (
                        <tr key={`${holder.name}-${index}`}>
                          <td>{holder.name ?? "—"}</td>
                          <td>{holder.holder_type ?? "—"}</td>
                          <td>{formatNumber(holder.shares)}</td>
                          <td>{holder.ratio_percent == null ? "—" : `${formatNumber(holder.ratio_percent)}%`}</td>
                          <td>{holder.change ?? "—"}</td>
                          <td><SourceLink sourceId={holder.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </article>
              )}

              {segments.length > 0 && (
                <article className="panel">
                  <div className="panel-title">
                    <div><span>REVENUE MIX</span><h3>主要产品 / 业务收入</h3></div>
                    <small>{segments[0]?.period}</small>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>分类</th><th>产品或业务</th><th>营业收入</th><th>收入占比</th><th>毛利率</th><th>来源</th></tr></thead>
                      <tbody>{segments.map((segment, index) => (
                        <tr key={`${segment.name}-${index}`}>
                          <td>{segment.category_type ?? "—"}</td>
                          <td>{segment.name}</td>
                          <td>{formatMoney(segment.revenue)}</td>
                          <td>{segment.revenue_share_percent == null ? "—" : `${formatNumber(segment.revenue_share_percent)}%`}</td>
                          <td>{segment.gross_margin_percent == null ? "—" : `${formatNumber(segment.gross_margin_percent)}%`}</td>
                          <td><SourceLink sourceId={segment.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </article>
              )}
            </section>
          )}

          {margin.length > 0 && (
            <section className="report-section" id="capital">
              <div className="section-heading">
                <div><span>20 TRADING DAYS</span><h2>融资融券资金面</h2></div>
                <p>逐股官方两融明细；融资余额日变化为相邻交易日余额之差。</p>
              </div>
              <article className="panel chart-panel">
                <div className="panel-title">
                  <div><span>FINANCING BALANCE CHANGE</span><h3>融资余额日变化</h3></div>
                  <SourceLink sourceId={margin[0]?.source_id} sources={sources} />
                </div>
                <div className="bar-chart" aria-label="最近20个交易日融资余额日变化">
                  {margin.map((row) => {
                    const value = Number(row.financing_balance_change ?? 0);
                    const max = Math.max(...margin.map((item) => Math.abs(Number(item.financing_balance_change ?? 0))), 1);
                    return (
                      <div key={row.date} title={`${row.date} ${formatMoney(value)}`}>
                        <i className={value >= 0 ? "up" : "down"} style={{ height: `${8 + Math.abs(value) / max * 82}px` }} />
                        <small>{row.date.slice(5)}</small>
                      </div>
                    );
                  })}
                  <span className="zero-line" />
                </div>
              </article>
              <article className="panel">
                <div className="panel-title"><div><span>DAILY LEDGER</span><h3>逐日融资融券明细</h3></div></div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>交易日</th><th>融资买入</th><th>融资偿还</th><th>融资余额变化</th><th>融资余额</th><th>融券卖出量</th><th>融券余额/余量</th><th>来源</th></tr></thead>
                    <tbody>{[...margin].reverse().map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td>{formatMoney(row.financing_buy)}</td>
                        <td>{formatMoney(row.financing_repay)}</td>
                        <td className={(row.financing_balance_change ?? 0) >= 0 ? "positive" : "negative"}>
                          {formatMoney(row.financing_balance_change)}
                        </td>
                        <td>{formatMoney(row.financing_balance)}</td>
                        <td>{formatNumber(row.securities_lending_sell)}</td>
                        <td>{formatNumber(row.securities_lending_balance)}</td>
                        <td><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </article>
            </section>
          )}

          {peerRows.length > 0 && (
            <section className="report-section" id="peers">
              <div className="section-heading">
                <div><span>PEER SET</span><h2>{active.peers?.data.label ?? "同业可比公司"}</h2></div>
                <p>行业归属来自官方披露；同业成份为二手行业板块匹配，不自动称为“竞争对手”。</p>
              </div>
              <article className="panel">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>公司</th><th>代码</th><th>最新价</th><th>总市值</th><th>来源</th></tr></thead>
                    <tbody>{peerRows.map((peer) => (
                      <tr key={peer.code}>
                        <td>{peer.name ?? "—"}</td>
                        <td>{peer.code}</td>
                        <td>{formatNumber(peer.latest_price)}</td>
                        <td>{formatMoney(peer.market_cap)}</td>
                        <td><SourceLink sourceId={peer.source_id} sources={sources} compact /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </article>
            </section>
          )}

          {contractRows.length > 0 && (
            <section className="report-section" id="contracts">
              <div className="section-heading">
                <div><span>24-MONTH DISCLOSURES</span><h2>合同 / 中标 / 订单公告</h2></div>
                <p>金额和交易对手只在公告文本可确定识别时显示；未披露字段保持空白。</p>
              </div>
              <article className="panel">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>公告日期</th><th>公告标题</th><th>交易对手</th><th>金额原文</th><th>原文</th></tr></thead>
                    <tbody>{contractRows.map((row, index) => (
                      <tr key={`${row.published_at}-${index}`}>
                        <td>{row.published_at ?? "—"}</td>
                        <td>{row.title}</td>
                        <td>{row.counterparty ?? ""}</td>
                        <td>{row.amount_text ?? ""}</td>
                        <td><a className="source-link compact" href={row.url} target="_blank" rel="noreferrer">公告 ↗</a></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </article>
            </section>
          )}

          <section className="report-section" id="sources">
            <div className="section-heading">
              <div><span>SOURCE STATUS</span><h2>来源、状态与缺失项</h2></div>
              <p>二手来源只承担结构化连接，页面明确标记来源层级并尽可能回链官方原报告。</p>
            </div>
            <div className="module-status">
              <div><b>公司总览</b><StatusBadge response={active.overview} /></div>
              <div><b>资金面</b><StatusBadge response={active.capital} /></div>
              <div><b>合同公告</b><StatusBadge response={active.contracts} /></div>
              <div><b>同业</b><StatusBadge response={active.peers} /></div>
            </div>
            {allWarnings.length > 0 && (
              <div className="warnings">
                {allWarnings.map((warning, index) => <p key={index}>{warning}</p>)}
              </div>
            )}
            {sources.size > 0 && (
              <article className="panel">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>层级</th><th>发布机构</th><th>原文标题</th><th>报告期</th><th>发布日期</th><th>抓取时间</th></tr></thead>
                    <tbody>{[...sources.values()].map((item) => (
                      <tr key={item.source_id}>
                        <td><span className={`tier ${item.tier}`}>{item.tier === "official" ? "官方" : "二手"}</span></td>
                        <td>{item.publisher}</td>
                        <td><a className="source-link" href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a></td>
                        <td>{item.period ?? "—"}</td>
                        <td>{item.published_at ?? "—"}</td>
                        <td>{new Date(item.retrieved_at).toLocaleString("zh-CN")}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </article>
            )}
          </section>
        </section>
      )}

      <footer>
        <p>
          本工具构建了一套面向沪深北 A 股公开披露的可复核信息整合流程。系统以公司名称或证券代码为检索键，
          将公司概况、财务报表、股东、主营构成、两融、合同公告与同业资料分模块采集；每个字段通过 source_id
          关联发布机构、原文、报告期、发布日期与抓取时间，并区分官方与二手结构化来源。系统仅执行确定性抽取与
          口径对齐，不对缺失项进行生成式补全；跨公司比较限于最近共同完整年度。因此，输出用于公开信息研究与
          审计追踪，不构成投资建议，结论应以原始披露为准。
        </p>
        <span>METHODS ABSTRACT</span>
      </footer>
    </main>
  );
}

"use client";

import Image from "next/image";
import { track } from "./analytics";
import { CandleChart, type CandleBar } from "./candle-chart";
import { BRAND_MARK } from "./site";
import Link from "next/link";
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
type SearchScope = "current" | "extended";

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
  security_type?: string;
  listing_status?: "current" | "historical_or_other";
};

type QuoteData = Partial<Record<
  "latest" | "previous_close" | "open" | "high" | "low" | "volume_lots" | "amount" |
  "change" | "change_percent" | "turnover_rate" | "pe_ratio" | "pb_ratio" | "market_cap" |
  "float_market_cap" | "quote_time",
  Sourced
>>;

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

type ControlItem = {
  name: string;
  ratio_percent?: number;
  resume?: string;
  source_id: string;
};

type PartnerRow = { name: string; amount_text?: string; share_text?: string };

type FiledPartnerSide = {
  amount_text?: string;
  amount?: number;
  share_percent?: number;
  rows?: Array<{ rank: number; name: string; amount: number; share_percent: number }>;
};

type AnnualReportFacts = {
  core_competence?: string;
  industry_position?: string;
  controlling_shareholder?: string;
  actual_controller?: string;
  partners?: {
    customers?: FiledPartnerSide;
    suppliers?: FiledPartnerSide;
    related_party_share_percent?: number;
  };
  source_id: string;
  title: string;
};

type BusinessData = {
  scope?: Record<string, Sourced | undefined>;
  products?: Record<string, Sourced | undefined>;
  annual_report?: AnnualReportFacts;
  competition?: { text: string; document: string; published_at: string; source_id: string };
  control?: Partial<Record<"controlling_shareholder" | "actual_controller" | "ultimate_controller", ControlItem>>;
  partners?: {
    period?: string;
    customers?: PartnerRow[];
    suppliers?: PartnerRow[];
    customers_total?: { amount_text: string; denominator: string; share_text: string };
    suppliers_total?: { amount_text: string; denominator: string; share_text: string };
    source_id?: string;
  };
};

type FinancialRow = {
  period: string;
  revenue?: number;
  parent_net_profit?: number;
  net_profit?: number;
  gross_margin_percent?: number;
  return_on_assets_percent?: number;
  accounts_receivable?: number;
  contract_liabilities?: number;
  short_term_loan?: number;
  long_term_loan?: number;
  total_equity?: number;
  total_assets?: number;
  source_id: string;
};

type InstitutionsData = {
  aggregate?: Array<{
    period: string;
    org_type: string;
    institution_count?: number;
    shares?: number;
    float_share_percent?: number;
    total_share_percent?: number;
    source_id: string;
  }>;
  public_funds?: Array<{
    period: string;
    name?: string;
    fund_code?: string;
    shares?: number;
    market_value?: number;
    total_share_percent?: number;
    previous_shares?: number;
    share_change?: number | null;
    exited?: boolean;
    source_id: string;
  }>;
  free_float_holders?: HolderRow[];
  social_security?: HolderRow[];
  private_fund_matches?: HolderRow[];
  qfii?: HolderRow[];
  insurance?: HolderRow[];
  holder_periods?: string[];
};

type HolderRow = {
  period: string;
  name: string;
  holder_type?: string;
  category?: string;
  shares?: number;
  float_share_percent?: number;
  change?: string | number;
  change_percent?: number;
  source_id: string;
};

type MoneyFlowData = {
  caliber?: string;
  daily_main_flow?: Array<{
    date: string;
    close?: number;
    change_percent?: number;
    main_net?: number;
    main_net_percent?: number;
    super_large_net?: number;
    large_net?: number;
    medium_net?: number;
    small_net?: number;
    source_id: string;
  }>;
  chip_cost?: Array<{
    date: string;
    average_cost?: number;
    profit_ratio_percent?: number;
    cost_90_low?: number;
    cost_90_high?: number;
    concentration_90_percent?: number;
    source_id: string;
  }>;
};

type ResearchData = {
  surveys?: Array<{
    survey_date?: string;
    announced_at?: string;
    institution_count?: string | number;
    receive_way?: string;
    receive_object?: string;
    receive_place?: string;
    receptionist?: string;
    investigators?: string;
    source_id: string;
  }>;
  reports?: Array<{
    published_at?: string;
    title?: string;
    institution?: string;
    rating?: string;
    url?: string;
    source_id: string;
  }>;
};

type SentimentRow = {
  published_at?: string;
  title: string;
  url: string;
  publisher?: string;
  matched_keywords: string[];
  source_id: string;
};

type NewsRow = {
  published_at?: string;
  published_time?: string;
  event: string;
  url: string;
  publisher?: string;
  matched_keywords: string[];
  source_id: string;
};

type SentimentData = {
  announcements?: SentimentRow[];
  news?: NewsRow[];
  keywords?: string[];
};

type ExchangeData = {
  market?: string;
  publisher?: string;
  profile?: Record<string, Sourced | undefined>;
  links?: Array<{ label: string; url: string; publisher: string; tier: string }>;
};

type ReportState = {
  company: SearchItem;
  sourceMode: SourceMode;
  quote?: ApiResponse<QuoteData>;
  candles?: ApiResponse<{ bars: CandleBar[] }>;
  overview?: ApiResponse<OverviewData>;
  capital?: ApiResponse<CapitalData>;
  contracts?: ApiResponse<ContractRow[]>;
  peers?: ApiResponse<PeersData>;
  business?: ApiResponse<BusinessData>;
  financials?: ApiResponse<{ rows: FinancialRow[] }>;
  institutions?: ApiResponse<InstitutionsData>;
  moneyflow?: ApiResponse<MoneyFlowData>;
  research?: ApiResponse<ResearchData>;
  sentiment?: ApiResponse<SentimentData>;
  exchange?: ApiResponse<ExchangeData>;
  loading: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8010";
const HISTORY_LIMITS = [5, 10, 20, 50];
const HISTORY_STORAGE_KEY = "stock-tool-search-history";
const HISTORY_LIMIT_STORAGE_KEY = "stock-tool-search-history-limit";
const REPORT_SESSION_STORAGE_KEY = "stock-tool-report-session";
const SOURCE_MODES: Record<SourceMode, string> = {
  official: "官方披露优先",
  strict: "仅官方来源",
  structured: "结构化数据优先",
};

async function getJson<T>(path: string, timeoutMs = 45000): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function searchCompanies(keyword: string, scope: SearchScope, signal?: AbortSignal) {
  const response = await fetch(
    `${API_BASE}/api/search?q=${encodeURIComponent(keyword)}&scope=${scope}`,
    { signal },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: ApiResponse<SearchItem[]> = await response.json();
  return payload.data ?? [];
}

function sourceMap(report?: ReportState) {
  const sources = [
    ...(report?.quote?.sources ?? []),
    ...(report?.candles?.sources ?? []),
    ...(report?.overview?.sources ?? []),
    ...(report?.capital?.sources ?? []),
    ...(report?.contracts?.sources ?? []),
    ...(report?.peers?.sources ?? []),
    ...(report?.business?.sources ?? []),
    ...(report?.financials?.sources ?? []),
    ...(report?.institutions?.sources ?? []),
    ...(report?.moneyflow?.sources ?? []),
    ...(report?.research?.sources ?? []),
    ...(report?.sentiment?.sources ?? []),
    ...(report?.exchange?.sources ?? []),
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

const FILING_BREAK = /(?=(?:（[一二三四五六七八九十]{1,3}）|[一二三四五六七八九十]{1,3}、|\d{1,2}、))/;

function FilingProse({ text }: { text: string }) {
  const parts = text.split(FILING_BREAK).map((part) => part.trim()).filter(Boolean);
  return (
    <div className="filing-prose">
      {(parts.length > 1 ? parts : [text]).map((part, index) => <p key={index}>{part}</p>)}
    </div>
  );
}

function Fold({
  label,
  hint,
  open = false,
  children,
}: {
  label: string;
  hint?: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="fold" open={open}>
      <summary><span>{label}</span>{hint && <small>{hint}</small>}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

function BarChart<T extends { date: string }>({
  rows,
  pick,
  label,
}: {
  rows: T[];
  pick: (row: T) => number;
  label: string;
}) {
  const max = Math.max(...rows.map((row) => Math.abs(pick(row))), 1);
  return (
    <div className="bar-chart" aria-label={label}>
      {rows.map((row) => {
        const value = pick(row);
        return (
          <div key={row.date} title={`${row.date} ${formatMoney(value)}`}>
            <i className={value >= 0 ? "up" : "down"} style={{ height: `${8 + Math.abs(value) / max * 82}px` }} />
            <small>{row.date.slice(5)}</small>
          </div>
        );
      })}
      <span className="zero-line" />
    </div>
  );
}

function ItemTitle({ no, children }: { no: number; children: React.ReactNode }) {
  return <h3><i className="item-no">{no}</i>{children}</h3>;
}

function Answer({ children }: { children: React.ReactNode }) {
  return <p className="item-answer">{children}</p>;
}

function StatusBadge({ response }: { response?: ApiResponse<unknown> }) {
  if (!response) return <span className="status-badge loading">读取中</span>;
  const labels = { ok: "完整", partial: "部分", empty: "无数据", error: "失败" };
  return <span className={`status-badge ${response.status}`}>{labels[response.status]}</span>;
}

function officialWebsite(raw?: string) {
  if (!raw) return null;
  const candidate = raw.trim().split(/[\s,，;；]+/)[0];
  if (!candidate) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function CompanyLogo({ code, name, website }: { code: string; name: string; website?: string }) {
  const site = officialWebsite(website);
  const candidates = site
    ? [
        `${API_BASE}/api/company/${code}/logo`,
        `${site.origin}/favicon.ico`,
        `${site.origin}/apple-touch-icon.png`,
        `${site.origin}/favicon.png`,
        `${site.origin}/favicon.svg`,
      ]
    : [];
  const [candidateIndex, setCandidateIndex] = useState(0);

  if (!site || candidateIndex >= candidates.length) {
    return (
      <div className="company-logo company-logo-fallback" title="公司官网图标暂不可用">
        <span>暂无标志</span>
      </div>
    );
  }
  return (
    <a className="company-logo" href={site.href} target="_blank" rel="noreferrer" title={`${name}公司官网`}>
      <Image
        src={candidates[candidateIndex]}
        alt={`${name}公司官网标志`}
        width={44}
        height={44}
        unoptimized
        onError={() => setCandidateIndex((current) => current + 1)}
      />
    </a>
  );
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
  const [searchScope, setSearchScope] = useState<SearchScope>("current");
  const [history, setHistory] = useState<SearchItem[]>([]);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [historyReady, setHistoryReady] = useState(false);
  const [reportSessionReady, setReportSessionReady] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>([]);
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
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(REPORT_SESSION_STORAGE_KEY) ?? "null");
      if (saved?.reports && saved?.selected && saved?.activeCode) {
        setReports(saved.reports);
        setSelected(saved.selected);
        setActiveCode(saved.activeCode);
        if (["official", "strict", "structured"].includes(saved.sourceMode)) {
          setSourceMode(saved.sourceMode);
        }
        if (Array.isArray(saved.openSections)) setOpenSections(saved.openSections);
      }
    } catch {
      window.sessionStorage.removeItem(REPORT_SESSION_STORAGE_KEY);
    } finally {
      setReportSessionReady(true);
    }
  }, []);

  useEffect(() => {
    if (!reportSessionReady) return;
    window.sessionStorage.setItem(
      REPORT_SESSION_STORAGE_KEY,
      JSON.stringify({ reports, selected, activeCode, sourceMode, openSections, savedAt: Date.now() }),
    );
  }, [activeCode, openSections, reportSessionReady, reports, selected, sourceMode]);

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
    setReports((current) => {
      const previous = current[company.code];
      const retained = previous?.sourceMode === mode ? previous : undefined;
      return {
        ...current,
        [company.code]: { ...retained, company, sourceMode: mode, loading: true },
      };
    });
    const requestId = (requestIds.current[company.code] ?? 0) + 1;
    requestIds.current[company.code] = requestId;
    const modeParam = `mode=${mode}`;
    const suffix = `?${modeParam}${refresh ? "&refresh=true" : ""}`;
    const update = (patch: Partial<ReportState>) => {
      if (requestIds.current[company.code] !== requestId) return;
      setReports((current) => ({
        ...current,
        [company.code]: {
          ...(current[company.code] ?? { company, sourceMode: mode, loading: true }),
          ...patch,
        },
      }));
    };
    const failed = <T,>(label: string, data: T, error: unknown): ApiResponse<T> => ({
      data,
      sources: [],
      warnings: [`${label}请求失败：${error instanceof Error ? error.message : "未知错误"}`],
      as_of: new Date().toISOString(),
      status: "error",
    });
    const quoteTask = getJson<QuoteData>(
      `/api/company/${company.code}/quote?${modeParam}${refresh ? "&refresh=true" : ""}`,
      12000,
    ).then((quote) => update({ quote })).catch((error) => update({ quote: failed("实时行情", {} as QuoteData, error) }));
    const candlesTask = getJson<{ bars: CandleBar[] }>(
      `/api/company/${company.code}/candles?days=120&${modeParam}${refresh ? "&refresh=true" : ""}`,
      30000,
    ).then((candles) => update({ candles })).catch((error) => update({ candles: failed("日线行情", { bars: [] }, error) }));
    const overviewTask = getJson<OverviewData>(
      `/api/company/${company.code}/overview${suffix}`,
      45000,
    ).then((overview) => update({ overview })).catch((error) => update({ overview: failed("公司总览", {} as OverviewData, error) }));
    const capitalTask = getJson<CapitalData>(
      `/api/company/${company.code}/capital?days=20&${modeParam}${refresh ? "&refresh=true" : ""}`,
      45000,
    ).then((capital) => update({ capital })).catch((error) => update({ capital: failed("资金面", { daily_margin: [], institution_signals: [] }, error) }));
    const contractsTask = getJson<ContractRow[]>(
      `/api/company/${company.code}/contracts?months=24&${modeParam}${refresh ? "&refresh=true" : ""}`,
      45000,
    ).then((contracts) => update({ contracts })).catch((error) => update({ contracts: failed("合同公告", [], error) }));
    const peersTask = getJson<PeersData>(
      `/api/company/${company.code}/peers${suffix}`,
      30000,
    ).then((peers) => update({ peers })).catch((error) => update({ peers: failed("同业", {}, error) }));
    const businessTask = getJson<BusinessData>(
      `/api/company/${company.code}/business${suffix}`,
      45000,
    ).then((business) => update({ business })).catch((error) => update({ business: failed("基本情况", {}, error) }));
    const financialsTask = getJson<{ rows: FinancialRow[] }>(
      `/api/company/${company.code}/financials?periods=4&${modeParam}${refresh ? "&refresh=true" : ""}`,
      45000,
    ).then((financials) => update({ financials })).catch((error) => update({ financials: failed("报告期财务", { rows: [] }, error) }));
    const institutionsTask = getJson<InstitutionsData>(
      `/api/company/${company.code}/institutions${suffix}`,
      45000,
    ).then((institutions) => update({ institutions })).catch((error) => update({ institutions: failed("机构持股", {}, error) }));
    const moneyflowTask = getJson<MoneyFlowData>(
      `/api/company/${company.code}/moneyflow?days=22&${modeParam}${refresh ? "&refresh=true" : ""}`,
      45000,
    ).then((moneyflow) => update({ moneyflow })).catch((error) => update({ moneyflow: failed("主力资金", {}, error) }));
    const researchTask = getJson<ResearchData>(
      `/api/company/${company.code}/research?months=6&${modeParam}${refresh ? "&refresh=true" : ""}`,
      45000,
    ).then((research) => update({ research })).catch((error) => update({ research: failed("调研与研报", {}, error) }));
    const sentimentTask = getJson<SentimentData>(
      `/api/company/${company.code}/sentiment?months=12&news_limit=5&${modeParam}${refresh ? "&refresh=true" : ""}`,
      45000,
    ).then((sentiment) => update({ sentiment })).catch((error) => update({ sentiment: failed("舆情", {}, error) }));
    const exchangeTask = getJson<ExchangeData>(
      `/api/company/${company.code}/exchange${suffix}`,
      30000,
    ).then((exchange) => update({ exchange })).catch((error) => update({ exchange: failed("交易所登记", {}, error) }));
    await Promise.allSettled([
      quoteTask, candlesTask, overviewTask, capitalTask, contractsTask, peersTask,
      businessTask, financialsTask, institutionsTask, moneyflowTask, researchTask, sentimentTask,
      exchangeTask,
    ]);
    update({ loading: false });
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
      const matches = await searchCompanies(keyword, searchScope);
      setSuggestions(matches);
      const normalized = keyword.toLowerCase();
      const match = matches.find(
        (company) => company.code.toLowerCase() === normalized || company.name.toLowerCase() === normalized,
      ) ?? matches[0];
      if (match) {
        track("company_opened", { code: match.code, exchange: match.exchange, scope: searchScope });
        rememberCompany(match);
        void loadCompany(match);
      } else {
        track("company_not_found", { scope: searchScope });
        setNotice(
          searchScope === "current"
            ? "未找到匹配的当前上市 A 股。"
            : "未找到匹配的当前或历史上市公司、B 股或 CDR。",
        );
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

  const quote = active?.quote?.data ?? {};
  const candleBars = active?.candles?.data.bars ?? [];
  const quoteNumber = (key: keyof QuoteData) => {
    const value = quote[key]?.value;
    return value == null ? undefined : Number(value);
  };
  const metrics = active?.overview?.data.financial.metrics ?? {};
  const profile = active?.overview?.data.profile ?? {};
  const shareholders = active?.overview?.data.shareholders ?? [];
  const shareholderPeriods = [...new Set(shareholders.map((item) => item.period))].sort().reverse();
  const [holderPeriod, priorHolderPeriod] = shareholderPeriods;
  const priorHolders = new Map(
    shareholders.filter((item) => item.period === priorHolderPeriod).map((item) => [item.name ?? "", item]),
  );
  const latestShareholders = shareholders.filter((item) => item.period === holderPeriod);
  const exitedHolders = [...priorHolders.values()].filter(
    (item) => !latestShareholders.some((holder) => holder.name === item.name),
  );
  const segments = active?.overview?.data.business_segments ?? [];
  const margin = active?.capital?.data.daily_margin ?? [];
  const contractRows = active?.contracts?.data ?? [];
  const peerRows = active?.peers?.data.companies ?? [];
  const exchangeData = active?.exchange?.data ?? {};
  const exchangeLinks = exchangeData.links ?? [];
  const exchangeProfile = exchangeData.profile ?? {};
  const businessData = active?.business?.data ?? {};
  const control = businessData.control ?? {};
  const partners = businessData.partners;
  const filed = businessData.annual_report;
  const filedPartners = filed?.partners;
  const competition = businessData.competition;
  const financialRows = active?.financials?.data.rows ?? [];
  const institutionData = active?.institutions?.data ?? {};
  const flowRows = active?.moneyflow?.data.daily_main_flow ?? [];
  const chipRows = active?.moneyflow?.data.chip_cost ?? [];
  const surveyRows = active?.research?.data.surveys ?? [];
  const reportRows = active?.research?.data.reports ?? [];
  const negativeAnnouncements = active?.sentiment?.data.announcements ?? [];
  const negativeNews = active?.sentiment?.data.news ?? [];
  const sectionMenu = [
    { id: "overview", label: "关键数字", tag: "", response: active?.overview, ready: !!active?.overview },
    {
      id: "business",
      label: "基本情况",
      tag: "①②③",
      response: active?.business,
      ready: !!(businessData.scope || businessData.products || filed || Object.keys(control).length > 0 || partners),
    },
    { id: "shareholders", label: "前十大股东", tag: "④", response: active?.overview, ready: latestShareholders.length > 0 },
    { id: "financials", label: "报告期财务", tag: "⑤", response: active?.financials, ready: financialRows.length > 0 },
    {
      id: "institutions",
      label: "机构持股",
      tag: "⑥",
      response: active?.institutions,
      ready: !!(institutionData.aggregate?.length || institutionData.public_funds?.length || institutionData.free_float_holders?.length),
    },
    {
      id: "funds",
      label: "公募与私募",
      tag: "⑩⑪",
      response: active?.institutions,
      ready: !!(institutionData.public_funds?.length || institutionData.free_float_holders?.length),
    },
    { id: "moneyflow", label: "资金与筹码", tag: "⑦⑧", response: active?.moneyflow, ready: !!active?.moneyflow },
    { id: "research", label: "调研与研报", tag: "⑨", response: active?.research, ready: !!active?.research },
    { id: "sentiment", label: "舆情", tag: "⑫", response: active?.sentiment, ready: !!active?.sentiment },
    { id: "capital", label: "融资融券", tag: "附录", response: active?.capital, ready: margin.length > 0 },
    { id: "sources", label: "来源与提示", tag: "附录", response: undefined, ready: true },
  ].filter((item) => item.ready);
  const isOpen = (id: string) => openSections.includes(id);
  const toggleSection = (id: string) =>
    setOpenSections((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const allWarnings = [
    ...(active?.quote?.warnings ?? []).map((text) => `行情：${text}`),
    ...(active?.overview?.warnings ?? []).map((text) => `总览：${text}`),
    ...(active?.capital?.warnings ?? []).map((text) => `两融：${text}`),
    ...(active?.contracts?.warnings ?? []).map((text) => `合同：${text}`),
    ...(active?.peers?.warnings ?? []).map((text) => `同业：${text}`),
    ...(active?.business?.warnings ?? []).map((text) => `基本情况：${text}`),
    ...(active?.financials?.warnings ?? []).map((text) => `报告期财务：${text}`),
    ...(active?.institutions?.warnings ?? []).map((text) => `机构持股：${text}`),
    ...(active?.moneyflow?.warnings ?? []).map((text) => `资金与筹码：${text}`),
    ...(active?.research?.warnings ?? []).map((text) => `调研与研报：${text}`),
    ...(active?.sentiment?.warnings ?? []).map((text) => `舆情：${text}`),
    ...(active?.exchange?.warnings ?? []).map((text) => `交易所登记：${text}`),
  ];

  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark"><Image src={BRAND_MARK} alt="甲骨文牛字" width={28} height={28} /></span>
          <span><b>A股公司研究台</b></span>
        </Link>
        <nav aria-label="主要导航">
          <Link className="active" href="/" aria-current="page">公司</Link>
          <Link href="/sectors">板块</Link>
          <Link href="/methodology">方法</Link>
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
              <option key={value} value={value}>{option}</option>
            ))}
          </select>
        </label>
      </header>

      <section className="hero" id="top">
        <div>
          <h1>今天准能行。</h1>
        </div>
      </section>

      <section className="search-panel">
        <form className="search-row" onSubmit={submitSearch}>
          <label>
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSuggestions([]);
              }}
              placeholder="公司名称或代码"
              aria-label="公司名称或股票代码"
            />
          </label>
          <label className="search-scope">
            <span>查询范围</span>
            <select
              value={searchScope}
              onChange={(event) => setSearchScope(event.target.value as SearchScope)}
              aria-label="公司查询范围"
            >
              <option value="current">仅当前上市公司</option>
              <option value="extended">包含退市、B股等</option>
            </select>
          </label>
          <button type="submit">{searching ? "查询中…" : "开始研究"}</button>
        </form>
        {query && suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((company) => (
              <button key={company.code} onClick={() => { rememberCompany(company); void loadCompany(company); }}>
                <span className="company-dot" />
                <b>{company.name}</b>
                <small>
                  {company.code} · {company.market}
                  {company.listing_status === "historical_or_other" ? ` · ${company.security_type ?? "历史证券"}` : ""}
                </small>
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

      {comparison && (
        <section className="compare-section">
          <div className="section-heading">
            <div><h2>共同完整年度比较</h2></div>
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
            <CompanyLogo
              key={profile.website ? String(profile.website.value) : "no-company-website"}
              code={active.company.code}
              name={active.company.name}
              website={profile.website ? String(profile.website.value) : undefined}
            />
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

          <nav className="section-toggles" aria-label="报告模块">
            <div className="section-toggles-head">
              <span>点开需要的模块，再点一次收起</span>
              <span className="section-toggles-actions">
                <button type="button" onClick={() => setOpenSections(sectionMenu.map((item) => item.id))}>全部展开</button>
                <button type="button" onClick={() => setOpenSections([])}>全部收起</button>
              </span>
            </div>
            <div className="section-toggle-grid">
              {sectionMenu.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`section-toggle ${isOpen(item.id) ? "open" : ""}`}
                  aria-expanded={isOpen(item.id)}
                  aria-controls={item.id}
                  onClick={() => toggleSection(item.id)}
                >
                  <span className="section-toggle-label">
                    {item.tag && <i>{item.tag}</i>}
                    <b>{item.label}</b>
                  </span>
                  {item.response ? <StatusBadge response={item.response} /> : <span className="status-badge ok">可查</span>}
                </button>
              ))}
            </div>
          </nav>

          {active.quote && Object.keys(active.quote.data).length > 0 && (
            <section className="quote-panel" id="quote">
              <div className="quote-primary">
                <span>最新价</span>
                <strong>{formatNumber(quoteNumber("latest"))}</strong>
                <p className={(quoteNumber("change_percent") ?? 0) >= 0 ? "positive" : "negative"}>
                  {formatNumber(quoteNumber("change"))}　{formatPercent(quoteNumber("change_percent"))}
                </p>
                <small>{String(quote.quote_time?.value ?? active.quote.as_of)}</small>
                <SourceLink sourceId={quote.latest?.source_id} sources={sources} compact />
              </div>
              <dl className="quote-grid">
                {[
                  ["今开", formatNumber(quoteNumber("open"))],
                  ["昨收", formatNumber(quoteNumber("previous_close"))],
                  ["最高", formatNumber(quoteNumber("high"))],
                  ["最低", formatNumber(quoteNumber("low"))],
                  ["成交量", quoteNumber("volume_lots") == null ? "—" : `${formatNumber(quoteNumber("volume_lots"))} 手`],
                  ["成交额", formatMoney(quoteNumber("amount"))],
                  ["换手率", quoteNumber("turnover_rate") == null ? "—" : `${formatNumber(quoteNumber("turnover_rate"))}%`],
                  ["总市值", formatMoney(quoteNumber("market_cap"))],
                  ["流通市值", formatMoney(quoteNumber("float_market_cap"))],
                  ["市盈率", formatNumber(quoteNumber("pe_ratio"))],
                  ["市净率", formatNumber(quoteNumber("pb_ratio"))],
                ].map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </section>
          )}

          {candleBars.length > 0 && (
            <section className="panel chart-panel candle-panel">
              <div className="panel-title">
                <div><h3>日线走势</h3></div>
                <SourceLink sourceId={candleBars[0]?.source_id} sources={sources} />
              </div>
              <CandleChart bars={candleBars} />
            </section>
          )}

          {active.loading && !active.overview && (
            <div className="loading-panel">
              <p>行情、总览、资金、合同与同业正在分别读取；已取得的模块会立即显示。</p>
              <small>实时行情通常数秒返回；单个详细模块最长等待 30–45 秒，不再阻塞其他结果。</small>
            </div>
          )}

          {isOpen("overview") && active.overview && (
            <section className="report-section" id="overview">
              <div className="section-heading">
                <div><h2>关键数字</h2></div>
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
                  <div className="panel-title"><div><h3>主要业务与基本信息</h3></div></div>
                  {profile.main_business && <p className="business-copy">{String(profile.main_business.value)}</p>}
                  <dl className="profile-grid">
                    {([
                      ["公司全称", profile.company_name],
                      ["所属行业", profile.industry],
                      ["法定代表人", profile.legal_representative],
                      ["注册资本", profile.registered_capital],
                      ["上市日期", profile.listing_date],
                      ["办公地址", profile.office_address],
                    ] as [string, Sourced | undefined][]).map(([label, item]) => item && (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{String(item.value)}</dd>
                        <SourceLink sourceId={item.source_id} sources={sources} compact />
                      </div>
                    ))}
                  </dl>
                </article>
              )}

              {segments.length > 0 && (
                <article className="panel">
                  <div className="panel-title">
                    <div><h3>主要产品与业务收入构成</h3></div>
                    <small>{segments[0]?.period}</small>
                  </div>
                  <Fold label="展开分部收入与毛利率" hint={`${segments.length} 项`}>
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
                  </Fold>
                </article>
              )}
            </section>
          )}

          {isOpen("business") && (businessData.scope || businessData.products || filed || Object.keys(control).length > 0 || partners) && (
            <section className="report-section" id="business">
              <div className="section-heading">
                <div><h2>一、基本情况</h2></div>
                <p>核心技术、控制人情况与前五名客户供应商直接取自{filed?.title ?? "定期报告"}原文；经营范围来自巨潮公司概况；产品分类为同花顺二手栏目。原文默认收起，点标题展开。</p>
              </div>

              {(exchangeLinks.length > 0 || Object.keys(exchangeProfile).length > 0) && (
                <article className="panel profile-panel">
                  <div className="panel-title">
                    <div><h3>交易所登记信息与官网入口</h3></div>
                    <small>{exchangeData.publisher}</small>
                  </div>
                  {exchangeLinks.length > 0 && (
                    <p className="exchange-links">
                      {exchangeLinks.map((link) => (
                        <a key={link.url} className="exchange-link" href={link.url} target="_blank" rel="noreferrer">
                          {link.label} ↗
                        </a>
                      ))}
                    </p>
                  )}
                  {Object.keys(exchangeProfile).length > 0 && (
                    <dl className="profile-grid">
                      {([
                        ["公司全称", exchangeProfile.full_name],
                        ["英文名称", exchangeProfile.english_name],
                        ["上市日期", exchangeProfile.listing_date],
                        ["上市状态", exchangeProfile.listing_status],
                        ["板块", exchangeProfile.board],
                        ["证监会行业", exchangeProfile.csrc_industry],
                        ["法定代表人", exchangeProfile.legal_representative],
                        ["董事会秘书", exchangeProfile.secretary],
                        ["注册地址", exchangeProfile.registered_address],
                        ["办公地址", exchangeProfile.office_address],
                        ["所属地区", exchangeProfile.area],
                        ["公司网站", exchangeProfile.website],
                        ["投资者关系电话", exchangeProfile.investor_phone],
                        ["电子邮箱", exchangeProfile.email],
                        ["主办券商", exchangeProfile.sponsor],
                        ["交易方式", exchangeProfile.transfer_mode],
                      ] as Array<[string, Sourced | undefined]>).map(([label, item]) => item && (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{String(item.value)}</dd>
                          <SourceLink sourceId={item.source_id} sources={sources} compact />
                        </div>
                      ))}
                      {([
                        ["总股本", exchangeProfile.total_shares],
                        ["流通股本", exchangeProfile.float_shares],
                      ] as Array<[string, Sourced | undefined]>).map(([label, item]) => item && (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{formatNumber(Number(item.value))} 股</dd>
                          <SourceLink sourceId={item.source_id} sources={sources} compact />
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              )}

              {(businessData.scope || businessData.products) && (
                <article className="panel profile-panel">
                  <div className="panel-title"><div><ItemTitle no={1}>公司是干什么的</ItemTitle></div></div>
                  {businessData.scope?.main_business && (
                    <Answer>{String(businessData.scope.main_business.value)}</Answer>
                  )}
                  {businessData.scope?.business_scope && (
                    <Fold label="工商登记经营范围全文">
                      <p className="business-copy">{String(businessData.scope.business_scope.value)}</p>
                    </Fold>
                  )}
                  <dl className="profile-grid">
                    {([
                      ["产品类型", businessData.products?.product_type],
                      ["产品名称", businessData.products?.product_name],
                      ["所属行业", profile.industry],
                    ] as Array<[string, Sourced | undefined]>).map(([label, item]) => item && (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{String(item.value)}</dd>
                        <SourceLink sourceId={item.source_id} sources={sources} compact />
                      </div>
                    ))}
                  </dl>
                  {filed?.core_competence && (
                    <Fold label="核心技术：年报“核心竞争力分析”原文" hint={filed.title}>
                      <FilingProse text={filed.core_competence} />
                    </Fold>
                  )}
                  {filed?.industry_position && (
                    <Fold label="所处行业情况：年报原文" hint={filed.title}>
                      <FilingProse text={filed.industry_position} />
                    </Fold>
                  )}
                  {businessData.scope?.organization_profile && (
                    <Fold label="公司沿革与机构简介">
                      <FilingProse text={String(businessData.scope.organization_profile.value)} />
                    </Fold>
                  )}
                </article>
              )}

              {(competition || peerRows.length > 0) && (
                <article className="panel profile-panel">
                  <div className="panel-title">
                    <div><h3>国内外类似公司</h3></div>
                    <small>{competition ? `${competition.document} · ${competition.published_at}` : "仅取得 A 股同业"}</small>
                  </div>
                  <Answer>
                    {competition
                      ? <>境外同行由公司自己在发行文件“行业竞争”章节点名，下方为<b>原文</b>；国内同业为同行业板块成份。</>
                      : <span className="muted-note">该公司近十二年无招股说明书或募集说明书，未取得公司自述的境外同行；下方仅列 A 股同行业公司。</span>}
                  </Answer>
                  {competition && (
                    <Fold label="发行文件“行业竞争”章节原文" hint={competition.published_at} open>
                      <FilingProse text={competition.text} />
                      <p className="filing-doc">
                        出处：{competition.document}
                        <SourceLink sourceId={competition.source_id} sources={sources} compact />
                      </p>
                    </Fold>
                  )}
                  {peerRows.length > 0 && (
                    <Fold label="A 股同行业公司" hint={`${peerRows.length} 家`}>
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
                    </Fold>
                  )}
                </article>
              )}

              {(filed?.controlling_shareholder || filed?.actual_controller || Object.keys(control).length > 0) && (
                <article className="panel profile-panel">
                  <div className="panel-title">
                    <div><ItemTitle no={2}>实际控制人是谁</ItemTitle></div>
                    <SourceLink sourceId={filed?.source_id} sources={sources} />
                  </div>
                  <Answer>
                    {control.actual_controller
                      ? <>实际控制人 <b>{control.actual_controller.name}</b>
                          {control.actual_controller.ratio_percent != null && <>，持股 <b>{formatNumber(control.actual_controller.ratio_percent)}%</b></>}
                          {control.controlling_shareholder && <>；控股股东 <b>{control.controlling_shareholder.name}</b></>}。</>
                      : <span className="muted-note">年报原文见下方，结构化栏目未返回控制人摘要。</span>}
                  </Answer>
                  {exchangeLinks.length > 0 && (
                    <p className="exchange-links compact-links">
                      查看全部定期报告原文：
                      {exchangeLinks.filter((l) => l.publisher === "巨潮资讯" || l.label.includes("公司公告")).map((link) => (
                        <a key={link.url} className="exchange-link" href={link.url} target="_blank" rel="noreferrer">
                          {link.label} ↗
                        </a>
                      ))}
                    </p>
                  )}
                  {filed?.actual_controller && (
                    <Fold label="年报“实际控制人情况”原文" hint={filed.title} open>
                      <FilingProse text={filed.actual_controller} />
                    </Fold>
                  )}
                  {filed?.controlling_shareholder && (
                    <Fold label="年报“控股股东情况”原文" hint={filed.title}>
                      <FilingProse text={filed.controlling_shareholder} />
                    </Fold>
                  )}
                  {control.actual_controller?.resume && (
                    <Fold label="实际控制人简历（同时任董监高时披露）">
                      <FilingProse text={control.actual_controller.resume} />
                    </Fold>
                  )}
                </article>
              )}

              {filedPartners && (filedPartners.customers || filedPartners.suppliers) && (
                <article className="panel">
                  <div className="panel-title">
                    <div><ItemTitle no={3}>上下游合作对象</ItemTitle></div>
                    <small>
                      {filedPartners.related_party_share_percent == null
                        ? filed?.title
                        : `关联方占比 ${formatNumber(filedPartners.related_party_share_percent)}%`}
                    </small>
                  </div>
                  <Answer>
                    {filedPartners.suppliers?.share_percent != null && (
                      <>前五名供应商合计占采购总额 <b>{formatNumber(filedPartners.suppliers.share_percent)}%</b>；</>
                    )}
                    {filedPartners.customers?.share_percent != null && (
                      <>前五名客户合计占销售总额 <b>{formatNumber(filedPartners.customers.share_percent)}%</b>。</>
                    )}
                    {(filedPartners.customers?.rows?.length || filedPartners.suppliers?.rows?.length)
                      ? null
                      : <span className="muted-note"> 年报只披露合计数，未逐户列示。</span>}
                  </Answer>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>方向</th><th>对象</th><th>金额</th><th>占比</th><th>来源</th></tr></thead>
                      <tbody>
                        {([
                          ["上游采购", "前五名供应商合计", filedPartners.suppliers],
                          ["下游销售", "前五名客户合计", filedPartners.customers],
                        ] as Array<[string, string, FiledPartnerSide | undefined]>).flatMap(([direction, totalLabel, side]) =>
                          side
                            ? [
                                ...(side.rows ?? []).map((row) => (
                                  <tr key={`${direction}-${row.rank}`}>
                                    <td>{direction}</td>
                                    <td>{row.name}</td>
                                    <td>{formatMoney(row.amount)}</td>
                                    <td>{formatNumber(row.share_percent)}%</td>
                                    <td><SourceLink sourceId={filed?.source_id} sources={sources} compact /></td>
                                  </tr>
                                )),
                                <tr key={`${direction}-total`}>
                                  <td>{direction}</td>
                                  <td><b>{totalLabel}</b></td>
                                  <td>{side.amount == null ? side.amount_text ?? "—" : formatMoney(side.amount)}</td>
                                  <td>{side.share_percent == null ? "—" : `${formatNumber(side.share_percent)}%`}</td>
                                  <td><SourceLink sourceId={filed?.source_id} sources={sources} compact /></td>
                                </tr>,
                              ]
                            : [],
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}

              {Object.keys(control).length > 0 && (
                <article className="panel">
                  <div className="panel-title">
                    <div><h3>控制关系结构化摘要</h3></div>
                    <small>二手栏目，用于与年报原文交叉核对</small>
                  </div>
                  <Fold label="展开控股股东 / 实际控制人 / 最终控制人对照">
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>身份</th><th>名称</th><th>持股比例</th><th>已披露简历</th><th>来源</th></tr></thead>
                      <tbody>{([
                        ["控股股东", control.controlling_shareholder],
                        ["实际控制人", control.actual_controller],
                        ["最终控制人", control.ultimate_controller],
                      ] as Array<[string, ControlItem | undefined]>).map(([label, item]) => item && (
                        <tr key={label}>
                          <td>{label}</td>
                          <td>{item.name}</td>
                          <td>{item.ratio_percent == null ? "—" : `${formatNumber(item.ratio_percent)}%`}</td>
                          <td>{item.resume ?? "未取得（该控制人非已披露董监高，或为企业主体）"}</td>
                          <td><SourceLink sourceId={item.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  </Fold>
                </article>
              )}

              {contractRows.length > 0 && (
                <article className="panel">
                  <div className="panel-title">
                    <div><h3>合同、中标与订单公告</h3></div>
                    <small>近 24 个月 · {contractRows.length} 条</small>
                  </div>
                  <Fold label="展开公告清单与已识别的交易对手" hint={`${contractRows.length} 条`}>
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
                  </Fold>
                </article>
              )}

              {!filedPartners && partners && (partners.customers?.length || partners.suppliers?.length) ? (
                <article className="panel">
                  <div className="panel-title">
                    <div><ItemTitle no={3}>上下游合作对象（同花顺）</ItemTitle></div>
                    <small>{partners.period ?? "报告期未标注"}</small>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>方向</th><th>对象</th><th>金额</th><th>占比</th><th>来源</th></tr></thead>
                      <tbody>
                        {(partners.suppliers ?? []).map((row, index) => (
                          <tr key={`supplier-${index}`}>
                            <td>上游采购</td>
                            <td>{row.name}</td>
                            <td>{row.amount_text ?? "—"}</td>
                            <td>{row.share_text ?? "—"}</td>
                            <td><SourceLink sourceId={partners.source_id} sources={sources} compact /></td>
                          </tr>
                        ))}
                        {(partners.customers ?? []).map((row, index) => (
                          <tr key={`customer-${index}`}>
                            <td>下游销售</td>
                            <td>{row.name}</td>
                            <td>{row.amount_text ?? "—"}</td>
                            <td>{row.share_text ?? "—"}</td>
                            <td><SourceLink sourceId={partners.source_id} sources={sources} compact /></td>
                          </tr>
                        ))}
                        {partners.suppliers_total && (
                          <tr>
                            <td>上游采购</td>
                            <td>前五大供应商合计</td>
                            <td>{partners.suppliers_total.amount_text}</td>
                            <td>{partners.suppliers_total.share_text}<small>占{partners.suppliers_total.denominator}</small></td>
                            <td><SourceLink sourceId={partners.source_id} sources={sources} compact /></td>
                          </tr>
                        )}
                        {partners.customers_total && (
                          <tr>
                            <td>下游销售</td>
                            <td>前五大客户合计</td>
                            <td>{partners.customers_total.amount_text}</td>
                            <td>{partners.customers_total.share_text}<small>占{partners.customers_total.denominator}</small></td>
                            <td><SourceLink sourceId={partners.source_id} sources={sources} compact /></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              ) : null}
            </section>
          )}

          {isOpen("shareholders") && latestShareholders.length > 0 && (
            <section className="report-section" id="shareholders">
              <article className="panel">
                <div className="panel-title">
                  <div><ItemTitle no={4}>前十大股东及与上期比较</ItemTitle></div>
                  <small>{holderPeriod}{priorHolderPeriod ? ` 对比 ${priorHolderPeriod}` : "（未取得上期披露）"}</small>
                </div>
                <Answer>
                  {priorHolderPeriod
                    ? <>本期 <b>{latestShareholders.length}</b> 名，其中 <b>{latestShareholders.filter((h) => !priorHolders.get(h.name ?? "")).length}</b> 名为新进；上期有 <b>{exitedHolders.length}</b> 名退出前十大。</>
                    : <span className="muted-note">仅取得 {holderPeriod} 一期披露，无法比较。</span>}
                </Answer>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>股东</th><th>类型</th>
                        <th>{holderPeriod} 持股数量</th><th>{holderPeriod} 持股比例</th>
                        <th>{priorHolderPeriod ?? "上期"} 持股数量</th><th>{priorHolderPeriod ?? "上期"} 持股比例</th>
                        <th>披露变动</th><th>来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestShareholders.map((holder, index) => {
                        const prior = priorHolders.get(holder.name ?? "");
                        return (
                          <tr key={`${holder.name}-${index}`}>
                            <td>{holder.name ?? "—"}{!prior && priorHolderPeriod && <small>上期不在前十大</small>}</td>
                            <td>{holder.holder_type ?? "—"}</td>
                            <td>{formatNumber(holder.shares)}</td>
                            <td>{holder.ratio_percent == null ? "—" : `${formatNumber(holder.ratio_percent)}%`}</td>
                            <td>{prior ? formatNumber(prior.shares) : "—"}</td>
                            <td>{prior?.ratio_percent == null ? "—" : `${formatNumber(prior.ratio_percent)}%`}</td>
                            <td>{holder.change ?? "—"}</td>
                            <td><SourceLink sourceId={holder.source_id} sources={sources} compact /></td>
                          </tr>
                        );
                      })}
                      {exitedHolders.map((holder, index) => (
                        <tr key={`exited-${holder.name}-${index}`}>
                          <td>{holder.name ?? "—"}<small>本期退出前十大</small></td>
                          <td>{holder.holder_type ?? "—"}</td>
                          <td>—</td>
                          <td>—</td>
                          <td>{formatNumber(holder.shares)}</td>
                          <td>{holder.ratio_percent == null ? "—" : `${formatNumber(holder.ratio_percent)}%`}</td>
                          <td>{holder.change ?? "—"}</td>
                          <td><SourceLink sourceId={holder.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          )}

          {isOpen("financials") && financialRows.length > 0 && (
            <section className="report-section" id="financials">
              <article className="panel">
                <div className="panel-title">
                  <div><ItemTitle no={5}>最近四个报告期财务指标</ItemTitle></div>
                  <small>毛利率与资产利润率按报告期原值计算，未年化</small>
                </div>
                <Answer>
                  最新报告期 <b>{financialRows[0].period}</b>：营业收入 <b>{formatMoney(financialRows[0].revenue)}</b>，归母净利润 <b>{formatMoney(financialRows[0].parent_net_profit)}</b>
                  {financialRows[0].gross_margin_percent != null && <>，毛利率 <b>{formatNumber(financialRows[0].gross_margin_percent)}%</b></>}。
                </Answer>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>指标</th>
                        {financialRows.map((row) => <th key={row.period}>{row.period}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        ["营业收入", (row: FinancialRow) => formatMoney(row.revenue)],
                        ["归母净利润", (row: FinancialRow) => formatMoney(row.parent_net_profit)],
                        ["净利润", (row: FinancialRow) => formatMoney(row.net_profit)],
                        ["毛利率", (row: FinancialRow) => row.gross_margin_percent == null ? "—" : `${formatNumber(row.gross_margin_percent)}%`],
                        ["资产利润率", (row: FinancialRow) => row.return_on_assets_percent == null ? "—" : `${formatNumber(row.return_on_assets_percent)}%`],
                        ["应收账款", (row: FinancialRow) => formatMoney(row.accounts_receivable)],
                        ["合同负债", (row: FinancialRow) => formatMoney(row.contract_liabilities)],
                        ["短期借款", (row: FinancialRow) => formatMoney(row.short_term_loan)],
                        ["长期借款", (row: FinancialRow) => formatMoney(row.long_term_loan)],
                        ["所有者权益合计", (row: FinancialRow) => formatMoney(row.total_equity)],
                      ] as Array<[string, (row: FinancialRow) => string]>).map(([label, render]) => (
                        <tr key={label}>
                          <td>{label}</td>
                          {financialRows.map((row) => <td key={row.period}>{render(row)}</td>)}
                        </tr>
                      ))}
                      <tr>
                        <td>来源</td>
                        {financialRows.map((row) => (
                          <td key={row.period}><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          )}

          {isOpen("institutions") && (institutionData.aggregate?.length ||
            institutionData.public_funds?.length ||
            institutionData.free_float_holders?.length) ? (
            <section className="report-section" id="institutions">
              <div className="section-heading">
                <div><h2>二、补充信息</h2></div>
                <p>机构与基金持股来自东方财富股东研究栏目；私募、社保、QFII 与保险按上游对十大流通股东标注的持有人类型归类，未进入十大流通股东的持仓不在公开逐股披露渠道内。</p>
              </div>

              {institutionData.aggregate?.length ? (
                <article className="panel">
                  <div className="panel-title">
                    <div><ItemTitle no={6}>机构持股家数、数量与占比</ItemTitle></div>
                    <small>最近两个报告期</small>
                  </div>
                  {institutionData.aggregate[0] && (
                    <Answer>
                      {institutionData.aggregate[0].period} 机构合计 <b>{formatNumber(institutionData.aggregate[0].institution_count)}</b> 家，
                      持有 <b>{formatNumber(institutionData.aggregate[0].shares)}</b> 股，
                      占总股本 <b>{formatNumber(institutionData.aggregate[0].total_share_percent)}%</b>。
                    </Answer>
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>报告期</th><th>类别</th><th>机构家数</th><th>持股数量（股）</th><th>占流通股比例</th><th>占总股本比例</th><th>来源</th></tr></thead>
                      <tbody>{institutionData.aggregate.map((row, index) => (
                        <tr key={`${row.period}-${row.org_type}-${index}`}>
                          <td>{row.period}</td>
                          <td>{row.org_type}</td>
                          <td>{formatNumber(row.institution_count)}</td>
                          <td>{formatNumber(row.shares)}</td>
                          <td>{row.float_share_percent == null ? "—" : `${formatNumber(row.float_share_percent)}%`}</td>
                          <td>{row.total_share_percent == null ? "—" : `${formatNumber(row.total_share_percent)}%`}</td>
                          <td><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </article>
              ) : null}

            </section>
          ) : null}

          {isOpen("funds") && (institutionData.public_funds?.length || institutionData.free_float_holders?.length) ? (
            <section className="report-section" id="funds">
              {!institutionData.private_fund_matches?.length && (
                <article className="panel">
                  <div className="panel-title">
                    <div><ItemTitle no={10}>私募基金的买入与增减持</ItemTitle></div>
                    <small>类别由东方财富 HOLDER_TYPE 标注</small>
                  </div>
                  <Answer>
                    最近 {(institutionData.holder_periods ?? []).length} 个报告期的十大流通股东中，
                    <b>没有</b>被标注为私募基金的持有人。
                    <span className="muted-note"> 未进入十大流通股东的私募持仓不在任何公开逐股披露渠道内。</span>
                  </Answer>
                </article>
              )}

              {([
                ["私募基金", 10, institutionData.private_fund_matches],
                ["社保基金", 0, institutionData.social_security],
                ["QFII", 0, institutionData.qfii],
                ["保险产品", 0, institutionData.insurance],
              ] as Array<[string, number, HolderRow[] | undefined]>).map(([label, no, rows]) => rows?.length ? (
                <article className="panel" key={label}>
                  <div className="panel-title">
                    <div>{no ? <ItemTitle no={no}>{label}的买入与增减持</ItemTitle> : <h3>{label}持股（十大流通股东）</h3>}</div>
                    <small>类别由东方财富 HOLDER_TYPE 标注</small>
                  </div>

                  <Answer>
                    最近 {(institutionData.holder_periods ?? []).length} 个报告期的十大流通股东中出现 <b>{rows.length}</b> 条{label}记录。
                  </Answer>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>报告期</th><th>持有人</th><th>类型</th><th>持股数量（股）</th><th>占流通股比例</th><th>披露变动</th><th>来源</th></tr></thead>
                      <tbody>{rows.map((row, index) => (
                        <tr key={`${row.name}-${row.period}-${index}`}>
                          <td>{row.period}</td>
                          <td>{row.name}</td>
                          <td>{row.holder_type ?? "—"}</td>
                          <td>{formatNumber(row.shares)}</td>
                          <td>{row.float_share_percent == null ? "—" : `${formatNumber(row.float_share_percent)}%`}</td>
                          <td>{row.change ?? "—"}</td>
                          <td><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </article>
              ) : null)}

              {institutionData.public_funds?.length ? (
                <article className="panel">
                  <div className="panel-title">
                    <div><ItemTitle no={11}>公募基金与社保的买入、增减持</ItemTitle></div>
                    <small>较上一报告期</small>
                  </div>
                  <Answer>
                    披露 <b>{institutionData.public_funds.length}</b> 只公募基金持股，其中
                    <b> {institutionData.public_funds.filter((f) => (f.share_change ?? 0) > 0).length}</b> 只增持、
                    <b> {institutionData.public_funds.filter((f) => (f.share_change ?? 0) < 0).length}</b> 只减持；
                    社保基金持仓见上方按持有人类型归类的表。
                  </Answer>
                  <Fold label="展开公募基金持股明细" hint={`前 ${Math.min(30, institutionData.public_funds.length)} 只`}>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>报告期</th><th>基金</th><th>代码</th><th>持股数量（股）</th><th>持股市值</th><th>占总股本</th><th>较上期增减（股）</th><th>来源</th></tr></thead>
                      <tbody>{institutionData.public_funds.slice(0, 30).map((row, index) => (
                        <tr key={`${row.fund_code}-${index}`}>
                          <td>{row.period}</td>
                          <td>{row.name ?? "—"}{row.exited && <small>本期未出现在披露名单</small>}</td>
                          <td>{row.fund_code ?? "—"}</td>
                          <td>{formatNumber(row.shares)}</td>
                          <td>{formatMoney(row.market_value)}</td>
                          <td>{row.total_share_percent == null ? "—" : `${formatNumber(row.total_share_percent)}%`}</td>
                          <td className={(row.share_change ?? 0) >= 0 ? "positive" : "negative"}>
                            {row.share_change == null ? "—" : formatNumber(row.share_change)}
                          </td>
                          <td><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  </Fold>
                </article>
              ) : null}

              {institutionData.free_float_holders?.length ? (
                <article className="panel">
                  <div className="panel-title">
                    <div><h3>十大流通股东与类别标注</h3></div>
                    <small>{(institutionData.holder_periods ?? []).join(" · ")}</small>
                  </div>
                  <Fold label="展开三个报告期的十大流通股东" hint={`${institutionData.free_float_holders.length} 行`}>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>报告期</th><th>持有人</th><th>类型</th><th>持股数量（股）</th><th>占流通股比例</th><th>披露变动</th><th>变动比例</th><th>来源</th></tr></thead>
                      <tbody>{institutionData.free_float_holders.map((row, index) => (
                        <tr key={`holder-${row.period}-${index}`}>
                          <td>{row.period}</td>
                          <td>{row.name}</td>
                          <td>{row.holder_type ?? "—"}</td>
                          <td>{formatNumber(row.shares)}</td>
                          <td>{row.float_share_percent == null ? "—" : `${formatNumber(row.float_share_percent)}%`}</td>
                          <td>{row.change ?? "—"}</td>
                          <td>{row.change_percent == null ? "—" : formatPercent(row.change_percent)}</td>
                          <td><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  </Fold>
                </article>
              ) : null}
            </section>
          ) : null}

          {isOpen("moneyflow") && active.moneyflow && (
            <section className="report-section" id="moneyflow">
              {flowRows.length > 0 && (
                <>
                  <article className="panel chart-panel">
                    <div className="panel-title">
                      <div><ItemTitle no={7}>最近一个月每日主力资金增减</ItemTitle></div>
                      <SourceLink sourceId={flowRows[0]?.source_id} sources={sources} />
                    </div>
                    <Answer>
                      {active.moneyflow?.data.caliber ?? "资金流口径以来源为准"}。近 <b>{flowRows.length}</b> 个交易日累计
                      <b> {formatMoney(flowRows.reduce((sum, row) => sum + Number(row.main_net ?? 0), 0))}</b>，
                      其中净流入 <b>{flowRows.filter((row) => (row.main_net ?? 0) > 0).length}</b> 天、净流出 <b>{flowRows.filter((row) => (row.main_net ?? 0) < 0).length}</b> 天。
                    </Answer>
                    <BarChart rows={flowRows} pick={(row) => Number(row.main_net ?? 0)} label="最近一个月每日资金净流入" />
                  </article>
                  <article className="panel">
                    <div className="panel-title"><div><h3>逐日资金流明细</h3></div></div>
                    <Fold label="展开逐日明细" hint={`${flowRows.length} 个交易日`}>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>交易日</th><th>收盘价</th><th>涨跌幅</th><th>净流入</th><th>净占比</th><th>超大单净额</th><th>大单净额</th><th>来源</th></tr></thead>
                        <tbody>{[...flowRows].reverse().map((row) => (
                          <tr key={row.date}>
                            <td>{row.date}</td>
                            <td>{formatNumber(row.close)}</td>
                            <td className={(row.change_percent ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.change_percent)}</td>
                            <td className={(row.main_net ?? 0) >= 0 ? "positive" : "negative"}>{formatMoney(row.main_net)}</td>
                            <td>{row.main_net_percent == null ? "—" : `${formatNumber(row.main_net_percent)}%`}</td>
                            <td>{formatMoney(row.super_large_net)}</td>
                            <td>{row.large_net == null ? "—" : formatMoney(row.large_net)}</td>
                            <td><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    </Fold>
                  </article>
                </>
              )}

              {chipRows.length === 0 && (
                <article className="panel">
                  <div className="panel-title">
                    <div><ItemTitle no={8}>查询日及前两日平均筹码成本</ItemTitle></div>
                    <small>平台推算的估计值，非披露数据</small>
                  </div>
                  <Answer>
                    <span className="muted-note">
                      未取得筹码分布。该数据只有东方财富 push2his 接口提供，当前网络下该接口不可达；本站不用其他数据推算替代。
                    </span>
                  </Answer>
                </article>
              )}

              {chipRows.length > 0 && (
                <article className="panel">
                  <div className="panel-title">
                    <div><ItemTitle no={8}>查询日及前两日平均筹码成本</ItemTitle></div>
                    <small>平台推算的估计值，非披露数据</small>
                  </div>
                  <Answer>
                    {[...chipRows].reverse().map((row, index) => (
                      <span key={row.date}>
                        {index > 0 && "，"}{row.date} <b>{formatNumber(row.average_cost)}</b> 元
                      </span>
                    ))}。
                  </Answer>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>交易日</th><th>平均成本</th><th>获利比例</th><th>90% 成本区间</th><th>90% 集中度</th><th>来源</th></tr></thead>
                      <tbody>{[...chipRows].reverse().map((row) => (
                        <tr key={row.date}>
                          <td>{row.date}</td>
                          <td>{formatNumber(row.average_cost)}</td>
                          <td>{row.profit_ratio_percent == null ? "—" : `${formatNumber(row.profit_ratio_percent)}%`}</td>
                          <td>{row.cost_90_low == null ? "—" : `${formatNumber(row.cost_90_low)} – ${formatNumber(row.cost_90_high)}`}</td>
                          <td>{row.concentration_90_percent == null ? "—" : `${formatNumber(row.concentration_90_percent)}%`}</td>
                          <td><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </article>
              )}
            </section>
          )}

          {isOpen("research") && active.research && (
            <section className="report-section" id="research">
              <article className="panel">
                <div className="panel-title">
                  <div><ItemTitle no={9}>近半年机构调研与研究报告</ItemTitle></div>
                  <small>不对机构观点做摘要或改写</small>
                </div>
                <Answer>
                  近半年接受机构调研 <b>{surveyRows.length}</b> 次，检索到卖方研究报告 <b>{reportRows.length}</b> 篇
                  {reportRows.length > 0 && <>（最新 {reportRows[0].published_at}，{reportRows[0].institution}，评级 {reportRows[0].rating ?? "未标注"}）</>}。
                  <span className="muted-note"> 结论与观点请点开原文核对。</span>
                </Answer>
              </article>

              {surveyRows.length > 0 && (
                <article className="panel">
                  <div className="panel-title"><div><h3>机构调研记录</h3></div></div>
                  <Fold label="展开调研记录" hint={`${surveyRows.length} 次`}>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>调研日期</th><th>公告日期</th><th>接待方式</th><th>接待对象</th><th>接待人员</th><th>参与机构</th><th>来源</th></tr></thead>
                      <tbody>{surveyRows.map((row, index) => (
                        <tr key={`${row.survey_date}-${index}`}>
                          <td>{row.survey_date ?? "—"}</td>
                          <td>{row.announced_at ?? "—"}</td>
                          <td>{row.receive_way ?? "—"}</td>
                          <td>{row.receive_object ?? "—"}</td>
                          <td>{row.receptionist ?? "—"}</td>
                          <td>{row.investigators ?? row.institution_count ?? "—"}</td>
                          <td><SourceLink sourceId={row.source_id} sources={sources} compact /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  </Fold>
                </article>
              )}

              {reportRows.length > 0 && (
                <article className="panel">
                  <div className="panel-title"><div><h3>卖方研究报告</h3></div></div>
                  <Fold label="展开研报清单" hint={`${reportRows.length} 篇`}>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>日期</th><th>报告标题</th><th>机构</th><th>评级</th><th>原文</th></tr></thead>
                      <tbody>{reportRows.map((row, index) => (
                        <tr key={`${row.published_at}-${index}`}>
                          <td>{row.published_at ?? "—"}</td>
                          <td>{row.title ?? "—"}</td>
                          <td>{row.institution ?? "—"}</td>
                          <td>{row.rating ?? "—"}</td>
                          <td>{row.url
                            ? <a className="source-link compact" href={row.url} target="_blank" rel="noreferrer">研报 ↗</a>
                            : "—"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  </Fold>
                </article>
              )}
            </section>
          )}

          {isOpen("sentiment") && active.sentiment && (
            <section className="report-section" id="sentiment">
              <article className="panel">
                <div className="panel-title">
                  <div><ItemTitle no={12}>近一年负面舆情与披露</ItemTitle></div>
                  <small>标题关键词匹配，不判断事实性质</small>
                </div>
                <Answer>
                  近一年命中负面关键词的公告 <b>{negativeAnnouncements.length}</b> 条；
                  另按时间列出最近 <b>{negativeNews.length}</b> 条个股新闻。
                  <span className="muted-note"> 命中关键词不等于负面结论，请点开原文核对。</span>
                </Answer>
                <Fold label="关键词表" hint={`${(active.sentiment.data.keywords ?? []).length} 个`}>
                  <p className="filing-doc">{(active.sentiment.data.keywords ?? []).join("、")}</p>
                </Fold>
                {negativeAnnouncements.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>公告日期</th><th>事件</th><th>命中关键词</th><th>发布方</th><th>原文</th></tr></thead>
                      <tbody>{negativeAnnouncements.map((row, index) => (
                        <tr key={`announcement-${index}`}>
                          <td>{row.published_at ?? "—"}</td>
                          <td>{row.title}</td>
                          <td>{row.matched_keywords.join("、")}</td>
                          <td>巨潮资讯</td>
                          <td><a className="source-link compact" href={row.url} target="_blank" rel="noreferrer">公告 ↗</a></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </article>

              {negativeNews.length > 0 && (
                <article className="panel">
                  <div className="panel-title">
                    <div><h3>最近 {negativeNews.length} 条相关新闻</h3></div>
                    <small>按发布时间倒序，未做关键词筛选</small>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>发布时间</th><th>事件</th><th>媒体</th><th>负面关键词</th><th>链接</th></tr></thead>
                      <tbody>{negativeNews.map((row, index) => (
                        <tr key={`news-${index}`}>
                          <td>{row.published_time ?? row.published_at ?? "—"}</td>
                          <td>{row.event}</td>
                          <td>{row.publisher ?? "—"}</td>
                          <td>{row.matched_keywords.length ? row.matched_keywords.join("、") : "—"}</td>
                          <td><a className="source-link compact" href={row.url} target="_blank" rel="noreferrer">新闻 ↗</a></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </article>
              )}
            </section>
          )}

          {isOpen("capital") && margin.length > 0 && (
            <section className="report-section" id="capital">
              <div className="section-heading">
                <div><h2>附录</h2></div>
                <p>清单之外的补充材料：交易所逐股两融明细，以及全部模块的取数状态与原文来源。</p>
              </div>
              <article className="panel chart-panel">
                <div className="panel-title">
                  <div><h3>融资融券（交易所官方明细）</h3></div>
                  <SourceLink sourceId={margin[0]?.source_id} sources={sources} />
                </div>
                <Fold label="展开融资余额日变化与逐日明细" hint={`${margin.length} 个交易日`}>
                <BarChart rows={margin} pick={(row) => Number(row.financing_balance_change ?? 0)} label="最近20个交易日融资余额日变化" />
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
                </Fold>
              </article>
            </section>
          )}

          {isOpen("sources") && (
          <section className="report-section" id="sources">
            <div className="section-heading">
              <div><h2>取数状态与来源</h2></div>
              <p>每项信息的原文来源与抓取时间；黄色提示说明未取得的内容和原因。取数状态见页面顶部的模块条。</p>
            </div>
            {allWarnings.length > 0 && (
              <article className="panel">
                <div className="panel-title"><div><h3>未取得的内容与口径说明</h3></div><small>{allWarnings.length} 条</small></div>
                <Fold label="展开全部提示" hint={`${allWarnings.length} 条`}>
                  <div className="warnings">
                    {allWarnings.map((warning, index) => <p key={index}>{warning}</p>)}
                  </div>
                </Fold>
              </article>
            )}
            {sources.size > 0 && (
              <article className="panel">
                <div className="panel-title"><div><h3>原文来源清单</h3></div><small>{sources.size} 条</small></div>
                <Fold label="展开来源清单" hint={`${sources.size} 条`}>
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
                </Fold>
              </article>
            )}
          </section>
          )}
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
        <span className="footer-by">
          <a href="https://github.com/sylviachangdou-prayer" target="_blank" rel="noreferrer">SylviaDou</a>
          <a href="mailto:sylvia.chang.dou@gmail.com">sylvia.chang.dou@gmail.com</a>
        </span>
      </footer>
    </main>
  );
}

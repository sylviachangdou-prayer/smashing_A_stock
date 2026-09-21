"use client";

import Image from "next/image";
import { BRAND_MARK } from "../site";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";

type SourceRef = {
  source_id: string;
  publisher: string;
  title: string;
  url: string;
  retrieved_at: string;
};

type ApiResponse<T> = {
  data: T;
  sources: SourceRef[];
  warnings: string[];
  as_of: string;
  status: "ok" | "partial" | "empty" | "error";
};

type SectorKind = "industry" | "concept";

type SectorBoard = {
  name: string;
  code?: string;
  change_percent?: number;
  turnover_amount?: number;
  leader?: string;
  source_id: string;
};

type SectorOverviewData = {
  kind: SectorKind;
  boards: SectorBoard[];
};

type SectorCompany = {
  code: string;
  name: string;
  latest?: number;
  change_percent?: number;
  turnover_rate?: number;
  amount?: number;
  market_cap?: number;
  pe_ratio?: number;
  source_id: string;
};

type SectorMembersData = {
  kind: SectorKind;
  name: string;
  companies: SectorCompany[];
};

type RankingMetric = "change_percent" | "amount" | "turnover_rate" | "market_cap" | "pe_ratio";

type MarketBriefData = {
  headlines: Array<{
    title: string;
    summary?: string;
    published_at?: string;
    url: string;
    source_id: string;
  }>;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8010";
const SECTOR_FILTERS = {
  all: { label: "全部板块", keywords: [] },
  technology: { label: "科技相关", keywords: ["半导体", "软件", "互联网", "通信", "电子", "计算机", "人工智能", "机器人", "数据"] },
  finance: { label: "金融相关", keywords: ["银行", "证券", "保险", "金融", "信托"] },
  consumption: { label: "消费相关", keywords: ["食品", "饮料", "家电", "零售", "旅游", "酒店", "汽车", "消费"] },
  healthcare: { label: "医药相关", keywords: ["医药", "医疗", "生物", "中药", "疫苗"] },
  energy: { label: "能源相关", keywords: ["新能源", "光伏", "风电", "电池", "煤炭", "石油", "电力", "能源"] },
} as const;

function formatNumber(value?: number) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
}

function formatPercent(value?: number) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatMoney(value?: number) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  if (Math.abs(number) >= 1e8) return `${(number / 1e8).toFixed(2)} 亿元`;
  if (Math.abs(number) >= 1e4) return `${(number / 1e4).toFixed(2)} 万元`;
  return `${formatNumber(number)} 元`;
}

const RANKING_METRICS: Array<{ key: RankingMetric; label: string; ascending?: boolean }> = [
  { key: "change_percent", label: "今日涨幅" },
  { key: "amount", label: "成交额" },
  { key: "turnover_rate", label: "换手率" },
  { key: "market_cap", label: "总市值" },
  { key: "pe_ratio", label: "低市盈率", ascending: true },
];

function rankMetric(companies: SectorCompany[], metric: RankingMetric) {
  const option = RANKING_METRICS.find((item) => item.key === metric)!;
  return companies
    .filter((company) => {
      const value = Number(company[metric]);
      return Number.isFinite(value) && (metric !== "pe_ratio" || value > 0);
    })
    .sort((left, right) => {
      const difference = Number(left[metric]) - Number(right[metric]);
      return option.ascending ? difference : -difference;
    })
    .slice(0, 10);
}

function formatRankingValue(metric: RankingMetric, value?: number) {
  if (metric === "change_percent") return formatPercent(value);
  if (metric === "turnover_rate") return value == null ? "—" : `${formatNumber(value)}%`;
  if (metric === "amount" || metric === "market_cap") return formatMoney(value);
  return formatNumber(value);
}

function SourceLink({ sourceId, sources }: { sourceId?: string; sources: Map<string, SourceRef> }) {
  const item = sourceId ? sources.get(sourceId) : undefined;
  if (!item) return null;
  return (
    <a className="source-link compact" href={item.url} target="_blank" rel="noreferrer" title={item.title}>
      {item.publisher} ↗
    </a>
  );
}

export default function SectorsPage() {
  const [sectorKind, setSectorKind] = useState<SectorKind>("industry");
  const [sectorFilter, setSectorFilter] = useState<keyof typeof SECTOR_FILTERS>("all");
  const [sectorName, setSectorName] = useState("");
  const [sectorOverview, setSectorOverview] = useState<ApiResponse<SectorOverviewData> | null>(null);
  const [sectorMembers, setSectorMembers] = useState<ApiResponse<SectorMembersData> | null>(null);
  const [marketBrief, setMarketBrief] = useState<ApiResponse<MarketBriefData> | null>(null);
  const [headlineLoading, setHeadlineLoading] = useState(false);
  const [rankingMetrics, setRankingMetrics] = useState<RankingMetric[]>(["change_percent"]);

  async function loadHeadlines(refresh = false) {
    setHeadlineLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/market-brief${refresh ? "?refresh=true" : ""}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMarketBrief(await response.json() as ApiResponse<MarketBriefData>);
    } catch {
      setMarketBrief({
        data: { headlines: [] },
        sources: [],
        warnings: ["当前无法取得财经头条。"],
        as_of: new Date().toISOString(),
        status: "error",
      });
    } finally {
      setHeadlineLoading(false);
    }
  }

  useEffect(() => {
    void loadHeadlines();
    const timer = window.setInterval(() => void loadHeadlines(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/sectors?kind=${sectorKind}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ApiResponse<SectorOverviewData>>;
      })
      .then(setSectorOverview)
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setSectorOverview({
            data: { kind: sectorKind, boards: [] },
            sources: [],
            warnings: ["无法取得最新板块行情。"],
            as_of: new Date().toISOString(),
            status: "error",
          });
        }
      });
    return () => controller.abort();
  }, [sectorKind]);

  useEffect(() => {
    if (!sectorName) return;
    const controller = new AbortController();
    const boardCode = sectorOverview?.data.boards.find((board) => board.name === sectorName)?.code;
    const codeParam = boardCode ? `?board_code=${encodeURIComponent(boardCode)}` : "";
    fetch(`${API_BASE}/api/sectors/${sectorKind}/${encodeURIComponent(sectorName)}${codeParam}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ApiResponse<SectorMembersData>>;
      })
      .then(setSectorMembers)
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setSectorMembers({
            data: { kind: sectorKind, name: sectorName, companies: [] },
            sources: [],
            warnings: [`无法取得${sectorName}成份行情。`],
            as_of: new Date().toISOString(),
            status: "error",
          });
        }
      });
    return () => controller.abort();
  }, [sectorKind, sectorName, sectorOverview]);

  function changeSectorKind(kind: SectorKind) {
    setSectorKind(kind);
    setSectorOverview(null);
    setSectorMembers(null);
    setSectorName("");
  }

  function selectSector(name: string) {
    setSectorMembers(null);
    setSectorName(name);
  }

  function toggleRankingMetric(metric: RankingMetric) {
    setRankingMetrics((current) => (
      current.includes(metric)
        ? current.length === 1 ? current : current.filter((item) => item !== metric)
        : [...current, metric]
    ));
  }

  const filteredBoards = useMemo(() => {
    const boards = sectorOverview?.data.boards ?? [];
    const keywords = SECTOR_FILTERS[sectorFilter].keywords;
    return keywords.length === 0
      ? boards
      : boards.filter((board) => keywords.some((keyword) => board.name.includes(keyword)));
  }, [sectorFilter, sectorOverview]);
  const risers = [...filteredBoards]
    .filter((board) => Number.isFinite(Number(board.change_percent)))
    .sort((a, b) => Number(b.change_percent) - Number(a.change_percent))
    .slice(0, 5);
  const fallers = [...filteredBoards]
    .filter((board) => Number.isFinite(Number(board.change_percent)))
    .sort((a, b) => Number(a.change_percent) - Number(b.change_percent))
    .slice(0, 5);
  const active = [...filteredBoards]
    .filter((board) => Number.isFinite(Number(board.turnover_amount)))
    .sort((a, b) => Number(b.turnover_amount) - Number(a.turnover_amount))
    .slice(0, 5);
  const rankingSets = useMemo(
    () => rankingMetrics.map((metric) => ({
      metric,
      label: RANKING_METRICS.find((item) => item.key === metric)!.label,
      rows: rankMetric(sectorMembers?.data.companies ?? [], metric),
    })),
    [rankingMetrics, sectorMembers],
  );
  const sources = useMemo(
    () => new Map(
      [...(sectorOverview?.sources ?? []), ...(sectorMembers?.sources ?? [])]
        .concat(marketBrief?.sources ?? [])
        .map((item) => [item.source_id, item]),
    ),
    [marketBrief, sectorMembers, sectorOverview],
  );

  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark"><Image src={BRAND_MARK} alt="甲骨文牛字" width={28} height={28} /></span>
          <span><b>A股公司研究台</b></span>
        </Link>
        <nav aria-label="主要导航">
          <Link href="/">公司</Link>
          <Link className="active" href="/sectors" aria-current="page">板块</Link>
          <Link href="/methodology">方法</Link>
        </nav>
      </header>

      <section className="sector-watch sector-page">
        <div className="methodology-intro">
          <h1>板块行情</h1>
        </div>
        <div className="section-heading sector-page-heading">
          <div><h2>最新动向</h2></div>
          <p>展示新浪财经或东方财富的行业与概念板块最新行情；便捷筛选只按板块名称关键词归类。</p>
        </div>
        <div className="sector-controls">
          <div className="sector-tabs" aria-label="板块类型">
            <button className={sectorKind === "industry" ? "active" : ""} onClick={() => changeSectorKind("industry")}>行业板块</button>
            <button className={sectorKind === "concept" ? "active" : ""} onClick={() => changeSectorKind("concept")}>概念板块</button>
          </div>
          <label>
            便捷筛选
            <select
              value={sectorFilter}
              onChange={(event) => {
                setSectorFilter(event.target.value as keyof typeof SECTOR_FILTERS);
                setSectorMembers(null);
                setSectorName("");
              }}
            >
              {Object.entries(SECTOR_FILTERS).map(([value, item]) => (
                <option key={value} value={value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            选择板块
            <select value={sectorName} onChange={(event) => selectSector(event.target.value)}>
              <option value="">请选择</option>
              {filteredBoards.map((board) => <option key={board.name} value={board.name}>{board.name}</option>)}
            </select>
          </label>
        </div>

        {!sectorOverview && <div className="sector-message">正在读取最新板块行情…</div>}
        {sectorOverview?.status === "error" && (
          <div className="sector-message">
            {sectorOverview.warnings[0] ?? "当前无法取得板块行情。"} 请确认已用 npm run local 启动本地数据服务。
          </div>
        )}
        {(sectorOverview?.data.boards.length ?? 0) > 0 && filteredBoards.length === 0 && (
          <div className="sector-message">当前筛选下没有匹配的板块。</div>
        )}
        {filteredBoards.length > 0 && (
          <>
            <div className="sector-glance">
              {[
                { title: "领涨板块", rows: risers, metric: "change" },
                { title: "领跌板块", rows: fallers, metric: "change" },
                { title: "成交活跃", rows: active, metric: "turnover" },
              ].map((group) => (
                <article key={group.title}>
                  <h3>{group.title}</h3>
                  {group.rows.map((board) => (
                    <button key={board.name} onClick={() => selectSector(board.name)}>
                      <span><b>{board.name}</b><small>{board.leader ? `领涨：${board.leader}` : "查看成份股"}</small></span>
                      <strong className={group.metric === "change" && Number(board.change_percent) < 0 ? "negative" : "positive"}>
                        {group.metric === "change" ? formatPercent(board.change_percent) : formatMoney(board.turnover_amount)}
                      </strong>
                    </button>
                  ))}
                </article>
              ))}
            </div>
            <div className="sector-source">
              更新于 {new Date(sectorOverview!.as_of).toLocaleString("zh-CN")}
              <SourceLink sourceId={filteredBoards[0]?.source_id} sources={sources} />
            </div>
          </>
        )}

        {sectorName && !sectorMembers && <div className="sector-message">正在读取 {sectorName} 成份股…</div>}
        {sectorMembers?.status === "error" && (
          <div className="sector-message">{sectorMembers.warnings[0] ?? "当前无法取得成份股行情。"}</div>
        )}

        <section className="ranking-section">
          <div className="section-heading">
            <div><h2>今日排位</h2></div>
            <p>在当前所选板块内分别计算各指标前 10；不同指标使用独立排序与比例尺，不混合单位。</p>
          </div>
          {!sectorName && <div className="sector-message ranking-empty">请先在上方选择一个板块。</div>}
          {(sectorMembers?.data.companies.length ?? 0) > 0 && (
            <>
              <div className="ranking-controls" aria-label="今日排位指标">
                <span>比较指标</span>
                {RANKING_METRICS.map((option) => (
                  <label key={option.key}>
                    <input
                      type="checkbox"
                      checked={rankingMetrics.includes(option.key)}
                      onChange={() => toggleRankingMetric(option.key)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>

              <div
                className="ranking-visual-grid"
                style={{ gridTemplateColumns: `repeat(${Math.min(rankingSets.length, 3)}, minmax(260px, 1fr))` }}
              >
                {rankingSets.map((set) => {
                  const maximum = Math.max(...set.rows.map((company) => Math.abs(Number(company[set.metric]))), 1);
                  return (
                    <article className="ranking-chart ranking-column" key={set.metric}>
                      <div className="ranking-chart-title">
                        <h3>{set.label}</h3>
                        <small>前 10</small>
                      </div>
                      <div role="img" aria-label={`${sectorMembers!.data.name}${set.label}前十名横向条形图`}>
                        {set.rows.map((company, index) => {
                          const value = Number(company[set.metric]);
                          return (
                            <div className="ranking-bar-row" key={company.code}>
                              <b>{index + 1}</b>
                              <span title={`${company.name} ${company.code}`}>{company.name}</span>
                              <i><em
                                className={value < 0 ? "negative-bar" : ""}
                                style={{ width: `${Math.max(6, Math.abs(value) / maximum * 100)}%` }}
                              /></i>
                              <strong>{formatRankingValue(set.metric, value)}</strong>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="table-wrap panel ranking-table">
                <table>
                  <thead>
                    <tr>
                      <th>排名</th>
                      {rankingSets.map((set) => (
                        <Fragment key={set.metric}>
                          <th className="ranking-column">{set.label}公司</th>
                          <th className="ranking-column">{set.label}数值</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 10 }, (_, index) => (
                      <tr key={index}>
                        <td><b>{index + 1}</b></td>
                        {rankingSets.map((set) => {
                          const company = set.rows[index];
                          return (
                            <Fragment key={set.metric}>
                              <td className="ranking-column">{company ? <>{company.name}<small>{company.code}</small></> : "—"}</td>
                              <td className="ranking-column">{company ? formatRankingValue(set.metric, company[set.metric]) : "—"}</td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sector-source">
                排名基于当前板块行情快照
                <SourceLink sourceId={sectorMembers!.data.companies[0]?.source_id} sources={sources} />
              </div>
            </>
          )}
        </section>

        {(sectorMembers?.data.companies.length ?? 0) > 0 && (
          <article className="panel sector-members">
            <div className="panel-title">
              <div><h3>{sectorMembers!.data.name}</h3></div>
              <small>最新成份股行情</small>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>公司</th><th>代码</th><th>最新价</th><th>涨跌幅</th><th>成交额</th><th>换手率</th><th>总市值</th><th>动态市盈率</th><th>来源</th></tr></thead>
                <tbody>{sectorMembers!.data.companies.slice(0, 50).map((company) => (
                  <tr key={company.code}>
                    <td>{company.name}</td>
                    <td>{company.code}</td>
                    <td>{formatNumber(company.latest)}</td>
                    <td className={Number(company.change_percent) >= 0 ? "positive" : "negative"}>{formatPercent(company.change_percent)}</td>
                    <td>{formatMoney(company.amount)}</td>
                    <td>{company.turnover_rate == null ? "—" : `${formatNumber(company.turnover_rate)}%`}</td>
                    <td>{formatMoney(company.market_cap)}</td>
                    <td>{formatNumber(company.pe_ratio)}</td>
                    <td><SourceLink sourceId={company.source_id} sources={sources} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </article>
        )}

        <section className="sector-news">
          <div className="section-heading">
            <div><h2>今日全球财经头条</h2></div>
            <div className="market-heading-actions">
              <p>每 6 小时自动检查更新；新闻只作市场信息入口，不参与公司研究结论。</p>
              <button disabled={headlineLoading} onClick={() => void loadHeadlines(true)}>
                {headlineLoading ? "刷新中…" : "立即刷新"}
              </button>
            </div>
          </div>
          {headlineLoading && !marketBrief && <div className="sector-message">正在读取财经头条…</div>}
          {marketBrief?.status === "error" && (
            <div className="sector-message">{marketBrief.warnings[0]}</div>
          )}
          {(marketBrief?.data.headlines.length ?? 0) > 0 && (
            <>
              <div className="headline-grid">
                {marketBrief!.data.headlines.map((headline) => (
                  <a key={headline.source_id} href={headline.url} target="_blank" rel="noreferrer">
                    <small>{headline.published_at?.slice(5, 16) ?? "最新"} · 东方财富</small>
                    <h3>{headline.title}</h3>
                    {headline.summary && <p>{headline.summary}</p>}
                  </a>
                ))}
              </div>
              <div className="sector-source">
                更新于 {new Date(marketBrief!.as_of).toLocaleString("zh-CN")}
                <SourceLink sourceId={marketBrief!.data.headlines[0]?.source_id} sources={sources} />
              </div>
            </>
          )}
        </section>
      </section>

      <footer>
        <p>
          板块行情按行业和概念整理最新市场快照，并保留数据提供方与抓取时间。科技、金融、消费、医药和能源等入口
          仅是板块名称关键词筛选，不构成官方行业分类或投资建议。
        </p>
        <span className="footer-by">
          <a href="https://github.com/sylviachangdou-prayer" target="_blank" rel="noreferrer">SylviaDou</a>
          <a href="mailto:sylvia.chang.dou@gmail.com">sylvia.chang.dou@gmail.com</a>
        </span>
      </footer>
    </main>
  );
}

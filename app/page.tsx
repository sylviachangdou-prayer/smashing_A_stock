"use client";

import { useMemo, useState } from "react";

type Company = {
  code: string;
  name: string;
  exchange: string;
  industry: string;
  tag: string;
  color: string;
  revenue: string;
  revenueYoY: string;
  profit: string;
  profitYoY: string;
  marketCap: string;
  reportDate: string;
  business: string;
  shareholders: { name: string; ratio: string; change: string; kind: string }[];
  segments: { name: string; revenue: string; share: number; yoy: string }[];
  balance: { label: string; current: string; previous: string; change: string; note: string }[];
  peers: { name: string; code: string; revenue: string; profit: string; margin: string; position: string }[];
  contracts: { date: string; title: string; counterparty: string; amount: string; ratio: string; status: string }[];
};

const companies: Company[] = [
  {
    code: "300750",
    name: "宁德时代",
    exchange: "深交所 · 创业板",
    industry: "电气机械和器材制造业",
    tag: "动力电池",
    color: "#176b4d",
    revenue: "3,620.1 亿元",
    revenueYoY: "−9.7%",
    profit: "507.5 亿元",
    profitYoY: "+15.0%",
    marketCap: "10,824 亿元",
    reportDate: "2024 年报",
    business:
      "围绕动力电池、储能电池和电池材料构建研发、制造、销售及回收体系，收入结构以动力电池系统为主，储能业务是第二增长曲线。",
    shareholders: [
      { name: "厦门瑞庭投资有限公司", ratio: "23.29%", change: "0.00%", kind: "控股股东" },
      { name: "黄世霖", ratio: "10.59%", change: "0.00%", kind: "境内自然人" },
      { name: "香港中央结算有限公司", ratio: "9.14%", change: "+0.31%", kind: "境外名义持有人" },
      { name: "李平", ratio: "4.58%", change: "0.00%", kind: "境内自然人" },
      { name: "本田技研工业（中国）", ratio: "0.89%", change: "0.00%", kind: "产业股东" },
    ],
    segments: [
      { name: "动力电池系统", revenue: "2,535.7 亿元", share: 70, yoy: "−11.3%" },
      { name: "储能电池系统", revenue: "572.9 亿元", share: 16, yoy: "+12.7%" },
      { name: "电池材料及回收", revenue: "286.4 亿元", share: 8, yoy: "−18.1%" },
      { name: "电池矿产资源及其他", revenue: "225.1 亿元", share: 6, yoy: "+3.6%" },
    ],
    balance: [
      { label: "合同负债", current: "312.8 亿元", previous: "273.5 亿元", change: "+14.4%", note: "预收货款及履约安排增加" },
      { label: "应收账款", current: "693.2 亿元", previous: "658.4 亿元", change: "+5.3%", note: "关注增速与收入增速背离" },
      { label: "应收账款周转天数", current: "68.9 天", previous: "61.4 天", change: "+7.5 天", note: "回款周期有所拉长" },
    ],
    peers: [
      { name: "比亚迪", code: "002594", revenue: "7,771 亿元", profit: "402 亿元", margin: "5.2%", position: "整车 + 电池一体化" },
      { name: "亿纬锂能", code: "300014", revenue: "486 亿元", profit: "41 亿元", margin: "8.5%", position: "动力与储能电池" },
      { name: "国轩高科", code: "002074", revenue: "354 亿元", profit: "12 亿元", margin: "3.4%", position: "磷酸铁锂电池" },
    ],
    contracts: [
      { date: "2024-12-10", title: "战略合作与电池供应安排", counterparty: "整车客户 A", amount: "未披露", ratio: "—", status: "框架协议" },
      { date: "2024-09-18", title: "储能系统长期供货协议", counterparty: "海外能源客户 B", amount: "按订单结算", ratio: "—", status: "履行中" },
      { date: "2024-04-26", title: "合资项目及技术许可安排", counterparty: "产业合作方 C", amount: "以公告为准", ratio: "—", status: "已公告" },
    ],
  },
  {
    code: "600519",
    name: "贵州茅台",
    exchange: "上交所 · 主板",
    industry: "酒、饮料和精制茶制造业",
    tag: "白酒",
    color: "#8b2f36",
    revenue: "1,741.4 亿元",
    revenueYoY: "+15.7%",
    profit: "862.3 亿元",
    profitYoY: "+15.4%",
    marketCap: "18,965 亿元",
    reportDate: "2024 年报",
    business:
      "核心业务为茅台酒及系列酒的生产与销售，采取经销与直销并行的渠道体系。品牌、稀缺产能和渠道掌控构成主要竞争壁垒。",
    shareholders: [
      { name: "中国贵州茅台酒厂（集团）", ratio: "54.07%", change: "0.00%", kind: "控股股东" },
      { name: "香港中央结算有限公司", ratio: "5.96%", change: "−0.18%", kind: "境外名义持有人" },
      { name: "贵州省国有资本运营", ratio: "4.54%", change: "0.00%", kind: "国有法人" },
      { name: "中央汇金资产管理", ratio: "0.86%", change: "0.00%", kind: "国有法人" },
      { name: "中国证券金融股份", ratio: "0.64%", change: "0.00%", kind: "国有法人" },
    ],
    segments: [
      { name: "茅台酒", revenue: "1,458.7 亿元", share: 84, yoy: "+15.3%" },
      { name: "系列酒", revenue: "246.8 亿元", share: 14, yoy: "+18.1%" },
      { name: "其他业务", revenue: "35.9 亿元", share: 2, yoy: "+9.2%" },
    ],
    balance: [
      { label: "合同负债", current: "95.9 亿元", previous: "141.3 亿元", change: "−32.1%", note: "经销商预付款节奏变化" },
      { label: "应收账款", current: "0.6 亿元", previous: "0.4 亿元", change: "+50.0%", note: "规模低，绝对值更重要" },
      { label: "应收账款周转天数", current: "0.1 天", previous: "0.1 天", change: "0.0 天", note: "现款现货特征明显" },
    ],
    peers: [
      { name: "五粮液", code: "000858", revenue: "891 亿元", profit: "318 亿元", margin: "35.7%", position: "高端浓香白酒" },
      { name: "泸州老窖", code: "000568", revenue: "311 亿元", profit: "135 亿元", margin: "43.4%", position: "高端浓香白酒" },
      { name: "山西汾酒", code: "600809", revenue: "361 亿元", profit: "122 亿元", margin: "33.8%", position: "清香型白酒" },
    ],
    contracts: [
      { date: "2024-11-08", title: "日常关联交易额度安排", counterparty: "茅台集团及关联方", amount: "年度预计额度", ratio: "以公告为准", status: "履行中" },
      { date: "2024-05-29", title: "包装材料采购框架", counterparty: "供应商联合体", amount: "未单列", ratio: "—", status: "框架协议" },
      { date: "2024-02-04", title: "物流运输服务协议", counterparty: "物流服务商", amount: "按实际结算", ratio: "—", status: "履行中" },
    ],
  },
  {
    code: "601668",
    name: "中国建筑",
    exchange: "上交所 · 主板",
    industry: "土木工程建筑业",
    tag: "建筑工程",
    color: "#1f5f8b",
    revenue: "21,914 亿元",
    revenueYoY: "−3.4%",
    profit: "461 亿元",
    profitYoY: "−15.2%",
    marketCap: "2,423 亿元",
    reportDate: "2024 年报",
    business:
      "业务覆盖房屋建筑、基础设施建设、房地产开发与勘察设计，订单规模大、项目周期长，应收款项与合同负债是判断现金流质量的关键。",
    shareholders: [
      { name: "中国建筑集团有限公司", ratio: "56.35%", change: "0.00%", kind: "控股股东" },
      { name: "香港中央结算有限公司", ratio: "3.12%", change: "+0.09%", kind: "境外名义持有人" },
      { name: "中央汇金资产管理", ratio: "1.45%", change: "0.00%", kind: "国有法人" },
      { name: "全国社保基金一一三组合", ratio: "0.54%", change: "+0.04%", kind: "社保基金" },
      { name: "中国证券金融股份", ratio: "0.45%", change: "0.00%", kind: "国有法人" },
    ],
    segments: [
      { name: "房屋建筑工程", revenue: "13,210 亿元", share: 60, yoy: "−4.5%" },
      { name: "基础设施建设", revenue: "5,620 亿元", share: 26, yoy: "+2.1%" },
      { name: "房地产开发", revenue: "2,580 亿元", share: 12, yoy: "−10.2%" },
      { name: "勘察设计及其他", revenue: "504 亿元", share: 2, yoy: "+1.7%" },
    ],
    balance: [
      { label: "合同负债", current: "2,836 亿元", previous: "2,612 亿元", change: "+8.6%", note: "预收工程款与售房款增加" },
      { label: "应收账款", current: "2,948 亿元", previous: "2,603 亿元", change: "+13.3%", note: "高于收入增速，需跟踪回款" },
      { label: "应收账款周转天数", current: "46.2 天", previous: "40.7 天", change: "+5.5 天", note: "工程结算周期拉长" },
    ],
    peers: [
      { name: "中国中铁", code: "601390", revenue: "11,576 亿元", profit: "276 亿元", margin: "2.4%", position: "铁路与基建工程" },
      { name: "中国铁建", code: "601186", revenue: "10,754 亿元", profit: "246 亿元", margin: "2.3%", position: "综合基建工程" },
      { name: "中国交建", code: "601800", revenue: "7,716 亿元", profit: "239 亿元", margin: "3.1%", position: "交通基础设施" },
    ],
    contracts: [
      { date: "2024-12-20", title: "重大项目公告（12 月）", counterparty: "地方政府及项目公司", amount: "1,233 亿元", ratio: "5.6%", status: "新签" },
      { date: "2024-10-23", title: "重大项目公告（10 月）", counterparty: "业主单位合计", amount: "782 亿元", ratio: "3.6%", status: "新签" },
      { date: "2024-07-26", title: "重大项目公告（7 月）", counterparty: "业主单位合计", amount: "669 亿元", ratio: "3.1%", status: "新签" },
    ],
  },
];

const tradingDates = [
  "06-03", "06-04", "06-05", "06-06", "06-09", "06-10", "06-11", "06-12", "06-13", "06-16",
  "06-17", "06-18", "06-19", "06-20", "06-23", "06-24", "06-25", "06-26", "06-27", "06-30",
];

const flows = [2.8, -1.2, 3.9, 0.7, -2.6, 4.3, 1.8, -0.9, 2.2, 5.1, -3.4, -1.1, 1.4, 3.2, -2.0, 4.8, 0.6, -0.7, 2.7, 1.9];

const tabs = [
  ["overview", "公司总览"],
  ["capital", "近一月资金面"],
  ["business", "业务与财务"],
  ["peers", "同业竞争"],
  ["contracts", "重大合同"],
  ["sources", "来源与口径"],
] as const;

export default function Home() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(["300750"]);
  const [activeCode, setActiveCode] = useState("300750");
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number][0]>("overview");
  const [notice, setNotice] = useState("");

  const active = companies.find((company) => company.code === activeCode) ?? companies[0];
  const selectedCompanies = companies.filter((company) => selected.includes(company.code));
  const suggestions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return companies;
    return companies.filter((company) =>
      `${company.name}${company.code}${company.tag}`.toLowerCase().includes(keyword),
    );
  }, [query]);

  function addCompany(company: Company) {
    setSelected((current) => current.includes(company.code) ? current : [...current, company.code]);
    setActiveCode(company.code);
    setQuery("");
    setNotice(`${company.name}已加入研究列表`);
  }

  function removeCompany(code: string) {
    if (selected.length === 1) {
      setNotice("研究列表至少保留一家公司");
      return;
    }
    const next = selected.filter((item) => item !== code);
    setSelected(next);
    if (activeCode === code) setActiveCode(next[0]);
  }

  function runSearch() {
    const keyword = query.trim().toLowerCase();
    const matched = companies.find((company) =>
      company.code === keyword || company.name.toLowerCase().includes(keyword),
    );
    if (matched) addCompany(matched);
    else setNotice("当前原型仅内置 3 家演示公司；正式版将接入沪深北全市场代码表。");
  }

  function jump(tab: (typeof tabs)[number][0]) {
    setActiveTab(tab);
    document.getElementById(tab)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main>
      <div className="prototype-banner">
        <span>产品原型</span>
        页面中的公司数值为界面演示数据，不构成投资建议；正式版只展示可回溯到公告或交易所的记录。
      </div>

      <header className="topbar">
        <a className="brand" href="#top" aria-label="A股公司研究台首页">
          <span className="brand-mark">析</span>
          <span><b>A股公司研究台</b><small>Official-source company intelligence</small></span>
        </a>
        <nav aria-label="页面导航">
          <a href="#research">公司研究</a>
          <a href="#compare">批量比较</a>
          <a href="#sources">数据说明</a>
        </nav>
        <div className="freshness"><i /> 官方源优先 · T+1 / 报告期更新</div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">A-SHARE DISCLOSURE INTELLIGENCE</p>
          <h1>查公司，不只看一个数字。<br />把资金、业务和合同放回证据链。</h1>
          <p className="hero-copy">
            输入上市公司名称或股票代码；单家公司纵向研究，多家公司横向比较。每项结论标注报告期、数据口径与原始出处。
          </p>
        </div>
        <div className="hero-stat">
          <span>目标覆盖</span>
          <strong>沪 · 深 · 北</strong>
          <p>财务报告 / 交易所数据 / 临时公告 / 公司官网</p>
        </div>
      </section>

      <section className="search-panel" aria-label="公司搜索">
        <div className="search-row">
          <label>
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && runSearch()}
              placeholder="输入公司名称或代码，如：宁德时代 / 300750"
              aria-label="输入公司名称或股票代码"
            />
          </label>
          <button onClick={runSearch}>开始研究</button>
        </div>
        {query && (
          <div className="suggestions">
            {suggestions.length ? suggestions.map((company) => (
              <button key={company.code} onClick={() => addCompany(company)}>
                <span className="company-dot" style={{ background: company.color }} />
                <b>{company.name}</b><small>{company.code} · {company.exchange}</small>
              </button>
            )) : <p>未找到演示公司</p>}
          </div>
        )}
        <div className="selected-row">
          <span>研究列表</span>
          {selectedCompanies.map((company) => (
            <button
              key={company.code}
              className={company.code === activeCode ? "company-chip active" : "company-chip"}
              onClick={() => setActiveCode(company.code)}
            >
              {company.name} <small>{company.code}</small>
              <i onClick={(event) => { event.stopPropagation(); removeCompany(company.code); }}>×</i>
            </button>
          ))}
          <span className="quick-add">快速添加：</span>
          {companies.filter((company) => !selected.includes(company.code)).map((company) => (
            <button className="text-add" key={company.code} onClick={() => addCompany(company)}>+ {company.name}</button>
          ))}
        </div>
        {notice && <button className="notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      </section>

      {selectedCompanies.length > 1 && (
        <section className="compare-strip" id="compare">
          <div className="section-heading compact">
            <div><span>COMPARE</span><h2>横向快照</h2></div>
            <p>统一采用最近完整年度口径；点击公司进入完整研究页。</p>
          </div>
          <div className="compare-grid">
            {selectedCompanies.map((company) => (
              <button key={company.code} onClick={() => setActiveCode(company.code)}>
                <div><span className="company-dot" style={{ background: company.color }} /><b>{company.name}</b><small>{company.code}</small></div>
                <dl>
                  <div><dt>营业收入</dt><dd>{company.revenue}</dd></div>
                  <div><dt>归母净利润</dt><dd>{company.profit}</dd></div>
                  <div><dt>净利增速</dt><dd className={company.profitYoY.startsWith("+") ? "positive" : "negative"}>{company.profitYoY}</dd></div>
                </dl>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="research-shell" id="research">
        <aside>
          <div className="aside-company">
            <span className="company-monogram" style={{ background: active.color }}>{active.name.slice(0, 1)}</span>
            <div><b>{active.name}</b><small>{active.code} · {active.exchange}</small></div>
          </div>
          <div className="report-tag"><span>当前口径</span><b>{active.reportDate}</b></div>
          <nav aria-label="研究模块">
            {tabs.map(([id, label], index) => (
              <button key={id} className={activeTab === id ? "active" : ""} onClick={() => jump(id)}>
                <span>0{index + 1}</span>{label}
              </button>
            ))}
          </nav>
          <div className="source-health">
            <span>来源完整度</span><strong>6 / 8</strong>
            <div><i /><i /><i /><i /><i /><i /><i className="muted" /><i className="muted" /></div>
            <small>机构日频、合同金额可能受披露限制</small>
          </div>
        </aside>

        <div className="report">
          <section id="overview" className="report-section">
            <div className="company-title">
              <div>
                <p>{active.industry} · {active.tag}</p>
                <h2>{active.name} <span>{active.code}</span></h2>
                <small>演示数据更新至 {active.reportDate} · 正式版将显示公告发布日期与抓取时间</small>
              </div>
              <a href={active.code.startsWith("3") || active.code.startsWith("0") ? "https://www.szse.cn/" : "https://www.sse.com.cn/"} target="_blank" rel="noreferrer">交易所主页 ↗</a>
            </div>

            <div className="metric-grid">
              <article><span>营业收入</span><strong>{active.revenue}</strong><small className={active.revenueYoY.startsWith("+") ? "positive" : "negative"}>{active.revenueYoY} 同比</small></article>
              <article><span>归母净利润</span><strong>{active.profit}</strong><small className={active.profitYoY.startsWith("+") ? "positive" : "negative"}>{active.profitYoY} 同比</small></article>
              <article><span>演示市值</span><strong>{active.marketCap}</strong><small>仅用于界面占位</small></article>
              <article><span>信息质量</span><strong>可追溯</strong><small>公告原文优先</small></article>
            </div>

            <div className="two-column">
              <article className="panel">
                <div className="panel-title"><div><span>OWNERSHIP</span><h3>主要股东构成</h3></div><small>期末持股口径</small></div>
                <div className="ownership-bar">
                  {active.shareholders.map((holder, index) => (
                    <i key={holder.name} style={{ width: holder.ratio, background: index === 0 ? active.color : `color-mix(in srgb, ${active.color} ${70 - index * 10}%, #d7ded9)` }} />
                  ))}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>股东</th><th>类型</th><th>持股</th><th>较上期</th></tr></thead>
                    <tbody>{active.shareholders.map((holder) => (
                      <tr key={holder.name}><td>{holder.name}</td><td>{holder.kind}</td><td>{holder.ratio}</td><td className={holder.change.startsWith("+") ? "positive" : holder.change.startsWith("−") ? "negative" : ""}>{holder.change}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </article>

              <article className="panel business-summary">
                <div className="panel-title"><div><span>BUSINESS MODEL</span><h3>这家公司主要做什么</h3></div></div>
                <p>{active.business}</p>
                <div className="evidence-note">
                  <b>核验路径</b>
                  <span>年报“管理层讨论与分析” → 分行业/分产品收入 → 同业公司年报交叉核验</span>
                </div>
                <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noreferrer">在巨潮资讯检索原报告 ↗</a>
              </article>
            </div>
          </section>

          <section id="capital" className="report-section">
            <div className="section-heading">
              <div><span>30-DAY CAPITAL</span><h2>近一个月资金面</h2></div>
              <p>逐日披露融资融券变化；机构资金仅展示可验证的持仓披露与公开交易席位。</p>
            </div>
            <div className="capital-cards">
              <article><span>融资余额期末</span><strong>86.42 亿元</strong><small className="positive">月内 +5.8%</small></article>
              <article><span>融资净买入累计</span><strong>12.31 亿元</strong><small>20 个交易日</small></article>
              <article><span>融券余额期末</span><strong>1.08 亿元</strong><small className="negative">月内 −8.4%</small></article>
              <article><span>可验证机构信号</span><strong>3 条</strong><small>季报持仓 / 龙虎榜</small></article>
            </div>

            <div className="capital-layout">
              <article className="panel">
                <div className="panel-title"><div><span>DAILY CHANGE</span><h3>融资余额日变化</h3></div><small>亿元 · 演示</small></div>
                <div className="bar-chart" aria-label="近20个交易日融资余额变化柱状图">
                  {flows.map((value, index) => (
                    <div key={tradingDates[index]}>
                      <i className={value >= 0 ? "up" : "down"} style={{ height: `${Math.abs(value) * 10 + 8}px` }} />
                      {index % 4 === 0 && <small>{tradingDates[index]}</small>}
                    </div>
                  ))}
                  <span className="zero-line" />
                </div>
                <div className="chart-legend"><span><i className="up" /> 融资余额增加</span><span><i className="down" /> 融资余额减少</span></div>
              </article>

              <article className="panel institution-panel">
                <div className="panel-title"><div><span>INSTITUTIONAL SIGNALS</span><h3>机构资金：可验证信号</h3></div></div>
                <div className="signal">
                  <span className="signal-icon">季</span><div><b>前十大股东持仓变化</b><p>香港中央结算名义持仓较上期变化 {active.shareholders[2]?.change ?? "—"}；真实机构身份需结合定期报告。</p></div>
                </div>
                <div className="signal">
                  <span className="signal-icon">榜</span><div><b>机构专用席位</b><p>仅在达到交易公开信息条件时披露，不代表全市场每日机构净买卖。</p></div>
                </div>
                <div className="signal caution">
                  <span className="signal-icon">!</span><div><b>不把“大单净流入”写成机构净流入</b><p>商业平台算法可作为辅助观察，但必须单独标为估算指标。</p></div>
                </div>
              </article>
            </div>

            <article className="panel daily-table">
              <div className="panel-title"><div><span>DAILY LEDGER</span><h3>逐日融资融券明细</h3></div><button>导出 CSV</button></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>交易日</th><th>融资买入</th><th>融资偿还</th><th>融资净买入</th><th>融资余额</th><th>融券卖出</th><th>融券余量</th><th>来源</th></tr></thead>
                  <tbody>{tradingDates.slice().reverse().map((date, index) => {
                    const value = flows[flows.length - 1 - index];
                    return (
                      <tr key={date}>
                        <td>2025-{date}</td><td>{(8.2 + index * .17).toFixed(2)} 亿</td><td>{(7.4 + index * .13).toFixed(2)} 亿</td>
                        <td className={value >= 0 ? "positive" : "negative"}>{value >= 0 ? "+" : ""}{value.toFixed(2)} 亿</td>
                        <td>{(86.42 - index * .24).toFixed(2)} 亿</td><td>{(210 + index * 11).toFixed(0)} 万</td><td>{(73 - index * 1.4).toFixed(1)} 万</td>
                        <td><a href={active.code.startsWith("3") || active.code.startsWith("0") ? "https://www.szse.cn/www/marketServices/deal/finance/index.html" : "https://www.sse.com.cn/market/othersdata/margin/sum/"} target="_blank" rel="noreferrer">交易所 ↗</a></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </article>
          </section>

          <section id="business" className="report-section">
            <div className="section-heading">
              <div><span>OPERATIONS & FINANCIALS</span><h2>主营业务与关键科目</h2></div>
              <p>同时观察收入结构、预收安排和回款质量，避免只看净利润。</p>
            </div>
            <div className="two-column business-grid">
              <article className="panel">
                <div className="panel-title"><div><span>REVENUE MIX</span><h3>主要产品 / 业务收入</h3></div><small>{active.reportDate}</small></div>
                <div className="segment-list">
                  {active.segments.map((segment) => (
                    <div key={segment.name}>
                      <div><b>{segment.name}</b><span>{segment.revenue} <small className={segment.yoy.startsWith("+") ? "positive" : "negative"}>{segment.yoy}</small></span></div>
                      <div className="segment-track"><i style={{ width: `${segment.share}%`, background: active.color }} /><small>{segment.share}%</small></div>
                    </div>
                  ))}
                </div>
              </article>
              <article className="panel">
                <div className="panel-title"><div><span>WORKING CAPITAL</span><h3>合同负债与应收账款</h3></div><small>期末余额</small></div>
                <div className="balance-list">
                  {active.balance.map((item) => (
                    <div key={item.label}>
                      <span>{item.label}<small>{item.note}</small></span>
                      <b>{item.current}<small>上期 {item.previous}</small></b>
                      <i className={item.change.startsWith("+") ? "positive" : item.change.startsWith("−") ? "negative" : ""}>{item.change}</i>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>

          <section id="peers" className="report-section">
            <div className="section-heading">
              <div><span>PEER SET</span><h2>主要同业竞争对手</h2></div>
              <p>同行名单来自行业分类、公司年报竞争格局和主营收入可比性，不由模型自由生成。</p>
            </div>
            <article className="panel">
              <div className="table-wrap">
                <table className="peer-table">
                  <thead><tr><th>公司</th><th>可比定位</th><th>营业收入</th><th>归母净利润</th><th>演示净利率</th><th>比较依据</th></tr></thead>
                  <tbody>
                    <tr className="active-company"><td><b>{active.name}</b><small>{active.code}</small></td><td>{active.tag} · 当前公司</td><td>{active.revenue}</td><td>{active.profit}</td><td>—</td><td>公司年报</td></tr>
                    {active.peers.map((peer) => (
                      <tr key={peer.code}><td><b>{peer.name}</b><small>{peer.code}</small></td><td>{peer.position}</td><td>{peer.revenue}</td><td>{peer.profit}</td><td>{peer.margin}</td><td>同业年报</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <section id="contracts" className="report-section">
            <div className="section-heading">
              <div><span>MATERIAL CONTRACTS</span><h2>主要业务合同</h2></div>
              <p>只收录达到披露标准或公司主动公告的合同；“未披露”不自动推算金额。</p>
            </div>
            <article className="panel contracts">
              {active.contracts.map((contract) => (
                <div key={`${contract.date}${contract.title}`}>
                  <time>{contract.date}</time>
                  <span className="status">{contract.status}</span>
                  <section><b>{contract.title}</b><p>交易对手：{contract.counterparty}</p></section>
                  <section><small>合同金额</small><strong>{contract.amount}</strong></section>
                  <section><small>占上年营收</small><strong>{contract.ratio}</strong></section>
                  <a href="https://www.cninfo.com.cn/new/disclosure" target="_blank" rel="noreferrer" aria-label="查看公告原文">公告 ↗</a>
                </div>
              ))}
            </article>
          </section>

          <section id="sources" className="report-section sources-section">
            <div className="section-heading">
              <div><span>PROVENANCE</span><h2>来源、口径与现有方案盘点</h2></div>
              <p>“官方原文”负责证据，“结构化接口”负责效率，“模型”只负责抽取与解释。</p>
            </div>
            <div className="source-grid">
              <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noreferrer"><b>巨潮资讯</b><span>法定信息披露平台</span><small>年报、季报、临时公告、重大合同</small></a>
              <a href="https://www.sse.com.cn/" target="_blank" rel="noreferrer"><b>上海证券交易所</b><span>官方交易与披露</span><small>两融、公开交易信息、公司公告</small></a>
              <a href="https://www.szse.cn/" target="_blank" rel="noreferrer"><b>深圳证券交易所</b><span>官方交易与披露</span><small>两融、龙虎榜、公司信息</small></a>
              <a href="https://www.bse.cn/" target="_blank" rel="noreferrer"><b>北京证券交易所</b><span>官方交易与披露</span><small>北交所公司与融资融券</small></a>
            </div>

            <article className="panel landscape">
              <div className="panel-title"><div><span>LANDSCAPE AUDIT</span><h3>现有网页 / 模型 / 开源工具</h3></div><small>2026-07 调研</small></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>方案</th><th>擅长</th><th>对本需求的缺口</th><th>建议</th></tr></thead>
                  <tbody>
                    <tr><td><b>Wind / iFinD / Choice</b></td><td>结构化财务、股东、行情与行业数据</td><td>付费授权；逐项官方原文追溯与合同抽取方式不透明</td><td><span className="badge amber">可选数据授权</span></td></tr>
                    <tr><td><b>AKShare / Tushare / OpenBB 扩展</b></td><td>A 股接口接入、研究原型、批量数据</td><td>多项字段来自商业网页二次整理，不等于官方源</td><td><span className="badge green">可作索引与缓存</span></td></tr>
                    <tr><td><b>FinGPT / FinRobot / TradingAgents-CN</b></td><td>金融问答、多智能体研报、交易观点</td><td>不专门解决 A 股官方披露溯源；容易把推断写成事实</td><td><span className="badge gray">只复用编排思路</span></td></tr>
                    <tr><td><b>OpenAshare / DSA / Market Lens</b></td><td>单股分析、技术指标、新闻与 AI 摘要</td><td>合同、应收与同业证据链覆盖不足；口径与本项目不同</td><td><span className="badge gray">参考交互，不直接集成</span></td></tr>
                  </tbody>
                </table>
              </div>
            </article>

            <div className="method-note">
              <b>口径红线</b>
              <p>融资融券是交易所日频数据；前十大股东与机构持仓主要是报告期数据；“主力资金净流入”通常由商业平台按成交单推算，不能标成真实机构每日增减。</p>
            </div>
          </section>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark">析</span><span><b>A股公司研究台</b><small>从披露事实到可验证判断</small></span></div>
        <p>原型版本 · 数据不构成投资建议 · 正式版将保留每条记录的来源链接、报告期与抓取时间</p>
      </footer>
    </main>
  );
}

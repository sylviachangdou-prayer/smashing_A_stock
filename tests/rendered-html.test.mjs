import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const sectorsPageUrl = new URL("../app/sectors/page.tsx", import.meta.url);
const methodologyPageUrl = new URL("../app/methodology/page.tsx", import.meta.url);
const backendUrl = new URL("../backend/main.py", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);
const siteUrl = new URL("../app/site.ts", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const methodologyEvidenceUrl = new URL("../docs/methodology_evidence.md", import.meta.url);

test("removes hard-coded demonstration companies and values", async () => {
  const [page, sectors] = await Promise.all([readFile(pageUrl, "utf8"), readFile(sectorsPageUrl, "utf8")]);
  assert.doesNotMatch(page, /const companies|const flows|整车客户 A|演示市值|86\.42 亿元/);
  assert.doesNotMatch(page, /尚未选择公司|从名称或代码开始查询/);
  assert.doesNotMatch(page, /今日全球财经头条/);
  assert.match(sectors, /今日全球财经头条/);
});

test("renders numerical modules through source-linked response fields", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /type Sourced/);
  assert.match(page, /source_id: string/);
  assert.match(page, /SourceLink/);
  assert.match(page, /common.*annual|共同完整年度/is);
});

test("submitting a company search performs a fresh API lookup", async () => {
  const page = await readFile(pageUrl, "utf8");
  const submitSearch = page.slice(
    page.indexOf("async function submitSearch"),
    page.indexOf("function removeCompany"),
  );
  assert.match(submitSearch, /searchCompanies\(keyword, searchScope\)/);
  assert.doesNotMatch(submitSearch, /if \(suggestions\[0\]\)/);
  assert.equal(page.match(/searchCompanies\(/g)?.length, 2);
});

test("source mode selector changes backend collection rules", async () => {
  const [page, backend] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(backendUrl, "utf8"),
  ]);
  for (const mode of ["official", "strict", "structured"]) {
    assert.match(page, new RegExp(`${mode}:`));
  }
  assert.match(page, /mode=\$\{mode\}/);
  assert.match(backend, /SourceMode = Literal\["official", "strict", "structured"\]/);
  assert.match(backend, /mode: SourceMode = "official"/);
});

test("keeps configurable company search history in browser storage", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /历史搜索/);
  assert.match(page, /HISTORY_LIMITS = \[5, 10, 20, 50\]/);
  assert.match(page, /localStorage/);
  assert.match(page, /sessionStorage/);
  assert.match(page, /REPORT_SESSION_STORAGE_KEY/);
});

test("keeps the header concise and exposes a separate evidence-backed methodology page", async () => {
  const [page, methodology, layout, evidence] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(methodologyPageUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(methodologyEvidenceUrl, "utf8"),
  ]);
  assert.doesNotMatch(
    page,
    /A-SHARE DISCLOSURE|LOCAL DISCLOSURE|LIVE MARKET BRIEF|OVERVIEW|METHODS ABSTRACT|沪 · 深 · 北/,
  );
  assert.doesNotMatch(page, /href="#capital"|href="#sources"/);
  assert.match(page, /href="\/"[^>]*>公司/);
  assert.match(page, /href="\/sectors"[^>]*>板块/);
  assert.match(page, /href="\/methodology"[^>]*>方法/);
  assert.doesNotMatch(page, /methodology-section/);
  assert.doesNotMatch(page, /官方披露优先：官方原文为核验锚点/);
  // 首页只留标题和搜索，覆盖范围改在方法页说明，不再占据首屏。
  assert.doesNotMatch(page, /当前范围|hero-stat|hero-copy/);
  for (const exchange of ["上海证券交易所", "深圳证券交易所", "北京证券交易所"]) {
    assert.match(methodology, new RegExp(exchange));
  }
  assert.match(methodology, /href="\/"[^>]*>公司/);
  assert.match(methodology, /href="\/methodology"/);
  assert.match(methodology, /<h3>数据范围<\/h3>/);
  assert.doesNotMatch(methodology, /数据范围与纪律|本工具用于整理上市公司公开披露/);
  assert.match(methodology, /<h3>局限<\/h3>/);
  assert.match(methodology, /<h3>公开来源<\/h3>/);
  assert.match(methodology, /https:\/\/github\.com\/sylviachangdou-prayer/);
  // 站点图标经 app/site.ts 统一补上 basePath，GitHub Pages 的子路径才不会 404。
  assert.match(layout, /BRAND_MARK/g);
  assert.match(await readFile(siteUrl, "utf8"), /niu-oracle\.svg/g);
  assert.match(evidence, /Coverage audit recorded/);
});

test("backend exposes the required independent endpoints and response envelope", async () => {
  const backend = await readFile(backendUrl, "utf8");
  for (const route of [
    "/api/search",
    "/api/market-brief",
    "/api/sectors",
    "/api/sectors/{kind}/{board_name}",
    "/api/company/{raw_code}/overview",
    "/api/company/{raw_code}/quote",
    "/api/company/{raw_code}/capital",
    "/api/company/{raw_code}/contracts",
    "/api/company/{raw_code}/peers",
    "/api/company/{raw_code}/business",
    "/api/company/{raw_code}/financials",
    "/api/company/{raw_code}/institutions",
    "/api/company/{raw_code}/moneyflow",
    "/api/company/{raw_code}/research",
    "/api/company/{raw_code}/sentiment",
    "/api/company/{raw_code}/exchange",
    "/api/health",
  ]) {
    assert.match(backend, new RegExp(route.replace(/[{}]/g, "\\$&")));
  }
  for (const key of ["data", "sources", "warnings", "as_of", "status"]) {
    assert.match(backend, new RegExp(`"${key}"`));
  }
});

test("uses official-site company icons, puts capital first, and exposes sector views", async () => {
  const [page, sectors, styles] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(sectorsPageUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  assert.match(page, /function CompanyLogo/);
  assert.match(page, /\/api\/company\/\$\{code\}\/logo/);
  assert.match(page, /favicon\.ico/);
  assert.doesNotMatch(page, /active\.company\.name\.slice\(0,\s*1\)/);
  assert.match(styles, /\.section-toggles\s*\{\s*order:\s*1/);
  assert.match(styles, /#quote\s*\{\s*order:\s*2/);
  assert.match(styles, /#overview\s*\{\s*order:\s*4/);
  assert.match(styles, /#business\s*\{\s*order:\s*5/);
  assert.doesNotMatch(page, /各板块最新动向|\/api\/sectors/);
  assert.match(sectors, /板块行情/);
  assert.match(sectors, /科技相关/);
  assert.match(sectors, /\/api\/sectors/);
  assert.match(sectors, /href="\/sectors"/);
  assert.match(page, /取数状态与来源/);
  assert.doesNotMatch(page, /来源、状态与缺失项/);
  assert.match(page, /仅当前上市公司/);
  assert.match(page, /包含退市、B股等/);
  const logoFallback = page.slice(page.indexOf("company-logo company-logo-fallback"), page.indexOf("company-logo company-logo-fallback") + 260);
  assert.doesNotMatch(logoFallback, /niu-oracle/);
  assert.doesNotMatch(sectors, /查看具体板块/);
  assert.match(sectors, /选择板块/);
  assert.match(sectors, /6 \* 60 \* 60 \* 1000/);
  assert.match(sectors, /立即刷新/);
  assert.match(sectors, /今日排位/);
  for (const metric of ["今日涨幅", "成交额", "换手率", "总市值", "低市盈率"]) {
    assert.match(sectors, new RegExp(metric));
  }
  assert.match(sectors, /rankMetric/);
  assert.match(sectors, /ranking-column/);
  assert.match(styles, /th\s*\{[\s\S]*font-size:\s*15px/);
  assert.match(styles, /td\s*\{[^}]*font-size:\s*17px/);
  assert.match(styles, /\.item-answer\s*\{[^}]*font-size:\s*18px/);
  assert.match(styles, /\.section-heading h2\s*\{[^}]*font-size:\s*31px/);
  assert.match(styles, /\.panel-title h3\s*\{[^}]*font-size:\s*23px/);
  assert.match(page, /实时行情通常数秒返回/);
  assert.match(page, /quoteTask[\s\S]*then\(\(quote\) => update\(\{ quote \}\)\)/);
});

test("adds the company research modules as independently requested sections", async () => {
  const [page, styles] = await Promise.all([readFile(pageUrl, "utf8"), readFile(stylesUrl, "utf8")]);
  for (const name of ["business", "financials", "institutions", "moneyflow", "research", "sentiment"]) {
    assert.match(page, new RegExp(`/api/company/\\$\\{company.code\\}/${name}`));
    assert.match(page, new RegExp(`id="${name}"`));
    assert.match(styles, new RegExp(`#${name}\\s*\\{\\s*order:`));
  }
  assert.match(page, /businessTask, financialsTask, institutionsTask, moneyflowTask, researchTask, sentimentTask/);
});

test("keeps four reporting periods, both shareholder periods, and derived-ratio disclosure", async () => {
  const [page, backend] = await Promise.all([readFile(pageUrl, "utf8"), readFile(backendUrl, "utf8")]);
  assert.match(backend, /wanted = dates\[:4\]/);
  for (const key of ["SHORT_LOAN", "LONG_LOAN", "TOTAL_EQUITY", "TOTAL_ASSETS", "CONTRACT_LIAB", "ACCOUNTS_RECE"]) {
    assert.match(backend, new RegExp(key));
  }
  assert.match(backend, /毛利率按（营业总收入−营业成本）÷营业总收入计算/);
  assert.match(page, /前十大股东及与上期比较/);
  assert.match(page, /本期退出前十大/);
  assert.match(page, /最近四个报告期财务指标/);
});

test("opens the report one module at a time from a status bar at the top", async () => {
  const [page, styles] = await Promise.all([readFile(pageUrl, "utf8"), readFile(stylesUrl, "utf8")]);
  assert.match(page, /const \[openSections, setOpenSections\] = useState<string\[\]>\(\[\]\)/);
  assert.match(page, /const toggleSection =/);
  assert.match(page, /const isOpen = \(id: string\)/);
  assert.match(page, /className="section-toggles"/);
  assert.match(page, /aria-expanded=\{isOpen\(item\.id\)\}/);
  assert.match(page, /aria-controls=\{item\.id\}/);
  assert.match(page, /全部展开/);
  assert.match(page, /全部收起/);
  for (const id of ["overview", "business", "shareholders", "financials", "institutions", "funds", "moneyflow", "research", "sentiment", "capital", "sources"]) {
    assert.match(page, new RegExp(`isOpen\\("${id}"\\)`));
  }
  // the status grid moved out of the sources section into the top bar
  assert.doesNotMatch(page, /className="module-status"/);
  assert.match(page, /openSections/);
  assert.match(styles, /\.section-toggle\.open\s*\{/);
  assert.match(styles, /\.section-toggle-grid\s*\{/);
});

test("presents each requested item as a numbered answer with the evidence folded behind it", async () => {
  const [page, styles] = await Promise.all([readFile(pageUrl, "utf8"), readFile(stylesUrl, "utf8")]);
  assert.match(page, /function Fold\(/);
  assert.match(page, /function FilingProse\(/);
  assert.match(page, /function ItemTitle\(/);
  assert.match(page, /function Answer\(/);
  assert.match(page, /<details className="fold"/);
  for (const no of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12]) {
    assert.match(page, new RegExp(`ItemTitle no=\\{${no}\\}`));
  }
  assert.match(page, /ItemTitle no=\{10\}/);
  assert.match(page, /的买入与增减持/);
  assert.match(page, /没有<\/b>被标注为私募基金的持有人/);
  assert.match(page, /未取得筹码分布/);
  assert.match(page, /<h2>一、基本情况<\/h2>/);
  assert.match(page, /<h2>二、补充信息<\/h2>/);
  assert.match(page, /<h2>附录<\/h2>/);
  assert.match(styles, /\.item-no\s*\{/);
  assert.match(styles, /\.item-answer\s*\{/);
  assert.match(styles, /\.fold > summary\s*\{/);
  assert.match(styles, /\.filing-prose p\s*\{/);
  assert.match(styles, /font-variant-numeric: tabular-nums/);
});

test("labels keyword filters and provider calibers instead of asserting conclusions", async () => {
  const [page, backend, methodology] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(backendUrl, "utf8"),
    readFile(methodologyPageUrl, "utf8"),
  ]);
  assert.match(backend, /NEGATIVE_WORDS = \(/);
  assert.match(backend, /本模块只做标题关键词匹配，不判断事实性质与影响/);
  assert.match(backend, /EASTMONEY_FLOW_CALIBER|SINA_FLOW_CALIBER/);
  assert.match(page, /命中关键词/);
  assert.match(page, /最近 \{negativeNews\.length\} 条相关新闻/);
  assert.match(page, /news_limit=5/);
  assert.match(page, /按发布时间倒序，未做关键词筛选/);
  assert.match(page, /caliber/);
  assert.match(methodology, /关键词/);
});

test("derives holder categories from the upstream label rather than name guessing", async () => {
  const [page, backend] = await Promise.all([readFile(pageUrl, "utf8"), readFile(backendUrl, "utf8")]);
  assert.match(backend, /HOLDER_TYPE_CATEGORIES = \{/);
  assert.match(backend, /"私募基金": "private_fund"/);
  assert.match(backend, /"全国社保基金": "social_security"/);
  assert.match(backend, /def holder_category/);
  assert.match(page, /HOLDER_TYPE/);
  assert.match(page, /free_float_holders/);
});

test("links to each exchange's own company page and shows its registration record", async () => {
  const [page, backend, styles, readme] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(backendUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(backend, /\/api\/company\/\{raw_code\}\/exchange/);
  assert.match(backend, /sse\.com\.cn\/assortment\/stock\/list\/info\/company/);
  assert.match(backend, /szse\.cn\/certificate\/individual/);
  assert.match(backend, /bse\.cn\/products\/neeq_listed_companies\/general_information/);
  assert.match(backend, /cninfo\.com\.cn\/new\/disclosure\/stock/);
  assert.match(backend, /def sse_company_record/);
  assert.match(backend, /def szse_company_record/);
  assert.match(backend, /def bse_company_record/);
  assert.match(backend, /EXCHANGE_FIELD_MAP = \{/);
  assert.match(page, /交易所登记信息与官网入口/);
  assert.match(page, /exchangeLinks\.map/);
  assert.match(page, /查看全部定期报告原文/);
  assert.match(styles, /\.exchange-link\s*\{/);
  assert.match(readme, /\/exchange/);
});

test("reads mandatory filing sections from the original CNINFO documents", async () => {
  const [page, backend, methodology] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(backendUrl, "utf8"),
    readFile(methodologyPageUrl, "utf8"),
  ]);
  assert.match(backend, /static\.cninfo\.com\.cn\/finalpage/);
  assert.match(backend, /def annual_report_facts/);
  assert.match(backend, /def competition_disclosure/);
  assert.match(backend, /核心竞争力分析/);
  assert.match(backend, /实际控制人及其一致行动人/);
  assert.match(backend, /AMOUNT_UNITS = \{"元": 1/);
  assert.doesNotMatch(backend, /境外可比公司没有可核验的结构化披露来源/);
  assert.match(page, /核心技术：年报“核心竞争力分析”原文/);
  assert.match(page, /发行文件“行业竞争”章节原文/);
  assert.match(page, /年报“实际控制人情况”原文/);
  assert.match(methodology, /年度报告/);
});

import Image from "next/image";
import { BRAND_MARK } from "../site";
import Link from "next/link";

export default function MethodologyPage() {
  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark"><Image src={BRAND_MARK} alt="甲骨文牛字" width={28} height={28} /></span>
          <span><b>A股公司研究台</b></span>
        </Link>
        <nav aria-label="主要导航">
          <Link href="/">公司</Link>
          <Link href="/sectors">板块</Link>
          <Link className="active" href="/methodology" aria-current="page">方法</Link>
        </nav>
      </header>

      <section className="methodology-section methodology-page">
        <div className="methodology-intro">
          <h1>方法</h1>
        </div>

        <ol className="methodology-flow">
          <li><b>识别公司</b><span>将名称或六位代码匹配到上海、深圳和北京市场代码表。</span></li>
          <li><b>分模块采集</b><span>公司总览、两融、合同公告和同业资料分别请求，单一来源失败不会生成替代值。</span></li>
          <li><b>确定性处理</b><span>通过字段映射、金额格式化、期间对齐和明确的文本规则整理结果，不使用生成式补全。</span></li>
          <li><b>保留证据链</b><span>每个显示字段关联来源 ID、发布机构、原文链接、报告期、发布日期和抓取时间。</span></li>
        </ol>

        <div className="methodology-grid">
          <article>
            <h3>数据范围</h3>
            <ul className="method-list">
              <li><b>代码表</b>三家交易所官方列表，外加两套标注清楚的备用全市场表。同一代码<em className="method-key">以交易所记录为准</em>；某家官方接口不可用时由备用表补齐，并在覆盖检查里披露本轮未完成核验。</li>
              <li><b>交易所登记</b>上交所 <code>query.sse.com.cn</code>、深交所 <code>szse.cn/api</code>、北交所 <code>bse.cn</code>，附公司概况页与公告页直达链接。</li>
              <li><b>年报原文</b>核心技术、所处行业、控股股东与实际控制人、前五名客户与供应商，取自巨潮最新年度报告的强制披露章节，<em className="method-key">按原文呈现，不摘要不改写</em>。</li>
              <li><b>同行业公司</b>取自最近一份招股说明书或募集说明书的行业竞争章节原文。</li>
              <li><b>公告索引</b>巨潮优先；被拒时依次回退东方财富、公司所属交易所。正文仍取同一份文件的原始 PDF，来源栏显示实际提供方。</li>
              <li><b>二手结构化</b>同花顺提供产品分类与客户供应商集中度；东方财富提供股东、机构持股、调研研报与逐日资金流。这些<em className="method-key">不标记为官方披露</em>。</li>
              <li><b>行情</b>个股取腾讯证券，缓存三十秒；板块取东方财富或新浪，缓存五分钟；财经头条缓存六小时。均为二手数据。</li>
              <li><b>合同金额与交易对手</b>只在公告文本出现明确标签时提取，否则留空。</li>
              <li><b>扩展检索</b>默认只查当前沪深北 A 股；选扩展范围才读巨潮历史公司与 B 股表，不拖慢默认搜索。</li>
            </ul>
          </article>
          <article>
            <h3>比较与缺失处理</h3>
            <p className="method-lead">每个模块取各自的时间窗口：</p>
            <dl className="window-grid">
              <div><dt>财务报表</dt><dd>最近 4 个报告期</dd></div>
              <div><dt>股东</dt><dd>最近 2 个季度</dd></div>
              <div><dt>主营构成</dt><dd>最近一次年报或半年报</dd></div>
              <div><dt>两融</dt><dd>最近 20 个交易日</dd></div>
              <div><dt>资金流</dt><dd>最近 1 个月</dd></div>
              <div><dt>筹码成本</dt><dd>查询日及前 2 日</dd></div>
              <div><dt>调研与研报</dt><dd>最近 6 个月</dd></div>
              <div><dt>负面检索</dt><dd>最近 12 个月</dd></div>
              <div><dt>合同公告</dt><dd>最近 24 个月</dd></div>
            </dl>
            <ul className="method-list">
              <li>股东逐一对照上期持股数量与比例。</li>
              <li>多公司比较<em className="method-key">只用各家共同具备的最近完整年度</em>。</li>
              <li>无匹配公司、非两融标的、来源缺失，都保留为有效的无结果状态，不填替代值。</li>
              <li>各模块独立请求，完成一个显示一个；单个慢模块设三十到四十五秒上限，<em className="method-key">不让一个上游拖住整份报告</em>。</li>
            </ul>
          </article>
        </div>

        <div className="methodology-grid methodology-text-sections">
          <article>
            <h3>派生指标</h3>
            <ul className="method-list">
              <li><b>毛利率</b><code>（营业总收入 − 营业成本）÷ 营业总收入</code>，用报告期原值，<em className="method-key">不年化</em>；缺营业成本的报告期留空。</li>
              <li><b>资产利润率</b><code>报告期净利润 ÷ 期末总资产</code>，同样不年化。</li>
              <li><b>金额单位</b>年报以万元或百万元披露的客户与供应商金额换算为元，同时保留原文金额与单位。</li>
              <li><b>主营构成</b>上游以小数返回收入占比与毛利率，本站统一乘一百按百分数显示。</li>
              <li><b>筹码成本</b>本站按东方财富公开的三角形筹码衰减模型自日 K 线推算，与其页面同算法；东财历史行情不可用时改用腾讯日 K，此时换手率按当前流通股本折算，页面会标注该差异。</li>
              <li><b>主力资金</b>交易平台按成交分布推算的统计口径，不是监管口径；东财不可用时改用新浪全单净流入，页面标注实际口径。</li>
            </ul>
          </article>
          <article>
            <h3>分类与关键词</h3>
            <ul className="method-list">
              <li><b>机构持股</b>只展示上游明确标注的「机构合计」与「基金」两类，其余未标注的类别代码<em className="method-key">不展示也不猜测</em>。</li>
              <li><b>持有人类型</b>私募、社保、QFII 与保险按东方财富对十大流通股东标注的类型归类，不依赖名称猜测。未进入十大流通股东的持仓，不在任何公开逐股披露渠道内。</li>
              <li><b>负面舆情</b>公告列表按关键词表匹配标题，关键词表在页面中完整列出；新闻列表不筛选，按时间倒序取最近五条，逐条给出事件与原文链接。</li>
              <li><em className="method-key">两者都只做标题匹配，命中不代表事实认定。</em></li>
            </ul>
          </article>
        </div>

        <div className="table-wrap methodology-table">
          <table>
            <thead><tr><th>来源模式</th><th>采集规则</th><th>适用边界</th></tr></thead>
            <tbody>
              <tr><td>官方披露优先</td><td>以官方原文作为核验锚点，允许二手接口提供结构化字段。</td><td>默认模式；兼顾可核验性与字段完整度。</td></tr>
              <tr><td>仅官方来源</td><td>排除只有二手来源的结构化数值。</td><td>字段会明显减少，不用推断补齐。</td></tr>
              <tr><td>结构化数据优先</td><td>减少定期报告回链和公告 PDF 字段抽取。</td><td>减少部分上游请求，但不保证总读取时间；二手字段仍需回看原始披露。</td></tr>
            </tbody>
          </table>
        </div>

        <div className="methodology-grid methodology-text-sections">
          <article>
            <h3>局限</h3>
            <ul className="method-list">
              <li>上游接口可能延迟、限流，或因服务器所在网络位置不可达。</li>
              <li>二手结构化字段可能与报告原文存在口径差异。</li>
              <li>规则抽取无法理解含混的合同条款。</li>
              <li><em className="method-key">本工具不计算投资评级、收益预测、风险概率或置信度。</em>结论应以交易所及上市公司原始披露为准。</li>
            </ul>
          </article>
          <article>
            <h3>公开来源</h3>
            <ul className="method-list source-list">
              <li><b>官方披露</b>
                <a href="https://www.sse.com.cn/assortment/stock/list/share/" target="_blank" rel="noreferrer">上海证券交易所</a>、
                <a href="https://www.szse.cn/market/product/stock/list/index.html" target="_blank" rel="noreferrer">深圳证券交易所</a>、
                <a href="https://www.bse.cn/nq/listedcompany.html" target="_blank" rel="noreferrer">北京证券交易所</a>、
                <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noreferrer">巨潮资讯</a>
              </li>
              <li><b>二手结构化</b>
                <a href="https://quote.eastmoney.com/center/boardlist.html" target="_blank" rel="noreferrer">东方财富</a>、
                <a href="https://finance.sina.com.cn/stock/sl/" target="_blank" rel="noreferrer">新浪财经</a>、
                <a href="https://gu.qq.com/" target="_blank" rel="noreferrer">腾讯证券</a>
              </li>
            </ul>
          </article>
        </div>
      </section>

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

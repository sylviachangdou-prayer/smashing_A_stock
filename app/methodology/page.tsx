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
            <p>
              检索代码表合并三家证券交易所和两套明确标注的备用全市场表；同一代码以交易所记录为准。某一交易所接口
              不可用时，该市场由两套备用表与最近完整缓存共同补齐，并在覆盖检查中披露本轮未完成的官方核验。财务、
              股东和主营构成可使用二手结构化接口，但不会被标记为官方披露。合同金额和交易对手只有在公告文本中出现
              明确标签时才提取，否则保持空白。板块动向使用东方财富或新浪财经实时行情，缓存五分钟，并始终标记为
              二手市场数据。公司登记信息直接取自所属交易所的公开接口——上交所 query.sse.com.cn 的上市公司概况、深交所 szse.cn 的
              公司概况接口、北交所 bse.cn 的挂牌公司信息接口，并在页面上给出该公司在交易所官网的公司概况页、公司公告页，以及
              证监会指定披露平台巨潮资讯的公司披露主页直达链接。核心技术、所处行业、控股股东与实际控制人情况、前五名客户与供应商，直接取自巨潮最新年度报告
              原文的强制披露章节；境内外同行业公司取自最近一份招股说明书或募集说明书的行业竞争章节原文。两类文本按章节标题
              定位、按原文呈现，不做摘要或改写，页面标注文件名称与公告日期以显示时效。巨潮的公告检索接口拒绝服务时，
              公告索引依次改用东方财富公告库与公司所属交易所的公告接口，正文仍取同一份定期报告或发行文件的原始 PDF，
              页面来源栏显示实际使用的提供方。经营范围与机构简介来自巨潮公司概况；
              产品分类与客户供应商集中度栏目来自同花顺；机构持股、基金持股与十大流通股东来自东方财富股东研究栏目；机构调研、
              卖方研报与逐日资金流来自东方财富数据中心，后四类标记为二手结构化来源。
              公司检索默认限于当前沪深北 A 股；选择扩展范围时，才按需读取巨潮历史公司与 B 股代码表，
              因此不会增加默认搜索的等待时间。单股最新价、涨跌、成交与估值字段来自腾讯证券行情接口，缓存三十秒；
              全球财经头条缓存六小时，并允许用户主动刷新。两类信息均标记为二手来源。“今日排位”只对用户当前选择
              板块的成份股行情作确定性排序，每个指标独立计算前十，不合成评分或选股建议。
            </p>
          </article>
          <article>
            <h3>比较与缺失处理</h3>
            <p>
              收入和净利润采用最新报告期及上年同期，报告期财务表采用最近四个已披露报告期，股东采用最近两个已披露季度并
              逐一对照上期持股数量与比例，主营构成采用最近一次年报或半年报，两融采用最近二十个交易日，逐日资金流采用最近
              一个月，筹码成本采用查询日及前两个交易日，机构调研与研报采用最近六个月，负面关键词检索采用最近十二个月，
              合同公告采用最近二十四个月。多公司比较只使用各公司共同具备的最近完整年度。无匹配公司、非两融标的和来源缺失
              均保留为有效的无结果状态。实时行情与各研究模块分别请求，已完成模块立即显示；前端对单个慢速模块设置三十至
              四十五秒等待上限，避免一个上游接口阻塞整份报告。
            </p>
          </article>
          <article>
            <h3>派生指标与关键词筛选</h3>
            <p>
              毛利率按（营业总收入减营业成本）除以营业总收入计算，资产利润率按报告期净利润除以期末总资产计算，两者均使用
              报告期原值且不做年化，缺少营业成本的报告期留空。年报以万元或百万元披露的客户与供应商金额按披露单位换算为元，
              同时保留原文金额与单位。主营构成的收入占比与毛利率由上游以小数返回，本站统一乘以一百后按百分数显示。机构持股
              只展示上游明确标注的“机构合计”与“基金”两类，其余未标注名称的类别代码不展示也不猜测。私募基金、社保基金、
              QFII 与保险产品按东方财富对十大流通股东标注的持有人类型归类，不再依赖名称猜测；未进入十大流通股东的持仓不在
              任何公开逐股披露渠道内。负面舆情分两部分：公告列表按关键词表匹配标题，关键词表在页面中完整列出；新闻列表不做筛选，按发布时间倒序取最近五条，逐条给出事件与原文链接，命中关键词的条目另行标出。两者都只做标题匹配，命中不代表事实认定。主力资金与筹码
              成本是交易平台按成交分布推算的统计口径，页面标注实际使用的提供方口径；东方财富资金流不可用时改用新浪财经的
              全单净流入口径并显式说明差异。筹码成本由本站按东方财富公开的三角形筹码衰减模型自日 K 线推算，
              东方财富历史行情不可用时改用腾讯证券日 K 线，此时换手率按当前流通股本折算，页面会标注这一差异。
            </p>
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
            <p>
              上游接口可能延迟、限流或因网络位置不可达；二手结构化字段可能与报告原文存在口径差异；规则抽取无法理解
              含混合同条款。本工具不计算投资评级、收益预测、风险概率或置信度，结论应以交易所及上市公司原始披露为准。
            </p>
          </article>
          <article>
            <h3>公开来源</h3>
            <p>
              主要公开来源包括
              <a href="https://www.sse.com.cn/assortment/stock/list/share/" target="_blank" rel="noreferrer">上海证券交易所</a>、
              <a href="https://www.szse.cn/market/product/stock/list/index.html" target="_blank" rel="noreferrer">深圳证券交易所</a>、
              <a href="https://www.bse.cn/nq/listedcompany.html" target="_blank" rel="noreferrer">北京证券交易所</a>和
              <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noreferrer">巨潮资讯</a>；实时板块行情来自
              <a href="https://quote.eastmoney.com/center/boardlist.html" target="_blank" rel="noreferrer">东方财富</a>或
              <a href="https://finance.sina.com.cn/stock/sl/" target="_blank" rel="noreferrer">新浪财经</a>；单股实时行情来自
              <a href="https://gu.qq.com/" target="_blank" rel="noreferrer">腾讯证券</a>。
            </p>
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
        <a href="https://github.com/sylviachangdou-prayer" target="_blank" rel="noreferrer">SylviaDou</a>
      </footer>
    </main>
  );
}

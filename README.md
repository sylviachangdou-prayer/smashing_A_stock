# A股公司研究台（本地试用版）

按公司名称或六位代码查询沪深北 A 股公开信息。前端只渲染实际取得且带 `source_id` 的数据；上游缺失或超时会按模块单独显示，不生成替代值。

## 本地启动

需要 Node.js 22+、Python 3.12 和 [`uv`](https://docs.astral.sh/uv/)。

```bash
npm install
npm run local
```

- 页面：<http://localhost:3000>
- 数据服务：<http://127.0.0.1:8010>
- 健康检查：<http://127.0.0.1:8010/api/health>
- 股票范围检查：<http://127.0.0.1:8010/api/coverage>

首次运行会由 `uv` 按 `uv.lock` 安装 Python 依赖。缓存最多保留 5 家公司（`COMPANY_CACHE_LIMIT`）与每个交易所最近 24 个交易日的两融快照（`MARGIN_CACHE_DAYS`），写入时自动淘汰。接口默认限流每个来源每分钟 60 次（`RATE_LIMIT_PER_MINUTE`），跨域来源由 `ALLOWED_ORIGINS` 控制。代码表、财务、股东、两融和公告会写入 `.cache/stock_tool/`，页面中的“绕过缓存刷新”可重新抓取公司模块。

## 接口

- `GET /api/search?q=`
- `GET /api/sectors?kind=industry|concept`
- `GET /api/sectors/{kind}/{board_name}?board_code=`
- `GET /api/company/{code}/overview`
- `GET /api/company/{code}/quote`
- `GET /api/company/{code}/capital?days=20`
- `GET /api/company/{code}/contracts?months=24`
- `GET /api/company/{code}/peers`
- `GET /api/company/{code}/business` — 年报原文的核心技术、控股股东与实际控制人、前五名客户与供应商，发行文件原文的境内外同行业公司，以及经营范围与产品分类
- `GET /api/company/{code}/financials?periods=4` — 最近四个报告期收入、净利润、毛利率、资产利润率、应收账款、合同负债、短期与长期借款、所有者权益
- `GET /api/company/{code}/institutions` — 最近两个报告期机构持股、公募基金增减，以及按上游持有人类型归类的私募、社保、QFII 与保险
- `GET /api/company/{code}/moneyflow?days=22` — 逐日资金净流入与查询日及前两日平均筹码成本
- `GET /api/company/{code}/research?months=6` — 机构调研记录与卖方研报
- `GET /api/company/{code}/exchange` — 交易所官网公司概况登记字段，以及上交所/深交所/北交所公司主页、公告检索与巨潮公司披露主页的直达链接
- `GET /api/company/{code}/sentiment?months=12&news_limit=5` — 负面关键词命中的公告，以及按发布时间倒序的最近若干条个股新闻（事件与链接）
- `GET /api/coverage?refresh=false`
- `GET /api/health`

所有接口统一返回：

```json
{
  "data": {},
  "sources": [],
  "warnings": [],
  "as_of": "ISO-8601",
  "status": "ok | partial | empty | error"
}
```

## 发布与更新

部署方式、服务器选址的注意事项与版本更新流程见 [DEPLOY.md](DEPLOY.md)。

## 验证

```bash
npm run lint
npm test
npm run test:api
```

## 口径说明

- 交易所登记字段直接取自公司所属交易所的公开接口（上交所 `query.sse.com.cn`、深交所 `szse.cn/api`、北交所 `bse.cn/nqxxController`），标记为官方来源；年报等定期报告原文以证监会指定披露平台巨潮资讯为准。

- 核心技术、控股股东与实际控制人情况、前五名客户与供应商，来自巨潮最新年报原文的强制披露章节；境内外同行业公司来自最近一份招股说明书或募集说明书的行业竞争章节。两者按原文呈现并标注文件名称与公告日期。
- 毛利率、资产利润率由报告期原值确定性计算，未年化；缺少营业成本的报告期留空。年报以万元或百万元披露的金额按披露单位换算为元，并保留原文金额。
- 私募、社保、QFII 与保险按东方财富对十大流通股东标注的 `HOLDER_TYPE` 归类；未进入十大流通股东的持仓不在公开逐股披露渠道内。
- 负面舆情的公告列表按关键词匹配标题，关键词表随响应返回；新闻列表不筛选，按发布时间倒序取最近 `news_limit` 条并给出事件与链接。命中不代表事实认定。
- 主力资金与筹码成本是交易平台的推算口径；东方财富不可用时改用新浪财经全单净流入口径，响应中的 `caliber` 标明实际口径。

本项目不使用 OpenAI API，不包含商业数据授权，也不构成投资建议。

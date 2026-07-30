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

首次运行会由 `uv` 按 `uv.lock` 安装 Python 依赖。代码表、财务、股东、两融和公告会写入 `.cache/stock_tool/`，页面中的“绕过缓存刷新”可重新抓取公司模块。

## 接口

- `GET /api/search?q=`
- `GET /api/company/{code}/overview`
- `GET /api/company/{code}/capital?days=20`
- `GET /api/company/{code}/contracts?months=24`
- `GET /api/company/{code}/peers`
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

## 验证

```bash
npm run lint
npm test
npm run test:api
```

本项目不使用 OpenAI API，不包含商业数据授权，也不构成投资建议。

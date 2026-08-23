# 发布与版本更新

## 先弄清楚这个项目是什么

它是**两个进程**，不是一个静态网页：

| | 技术栈 | 能不能上 Serverless |
|---|---|---|
| 前端 `app/` | Next.js（vinext 构建成 Cloudflare Worker + 静态资源） | 可以 |
| 后端 `backend/` | Python FastAPI + akshare + pandas + pypdf | **不行** |

前端只是壳。`app/page.tsx` 里所有数据都来自 `NEXT_PUBLIC_API_BASE`，默认 `http://127.0.0.1:8010`。
**只把前端发出去，页面能打开，但每个模块都会报连接失败。**

后端上不了 Cloudflare Workers / Vercel Functions，原因是硬性的：

- **依赖**：pandas、numpy、akshare、pypdf，不是纯 Python，Workers 跑不了。
- **耗时**：年报 PDF 下载加解析约 2 秒，巨潮公告索引首次抓取 4–10 秒，单请求上限设的是 30–45 秒。多数 Serverless 网关 10–30 秒就掐断。
- **磁盘**：`.cache/stock_tool/` 是全部缓存。容器每次冷启动都清空的话，每个访客都会触发一次完整重爬。
- **出网**：要访问约 15 个境内站点（巨潮、沪深北交易所、东财、同花顺、新浪、腾讯）。

## 最关键的一条：服务器的网络位置

数据源全是境内站点，且已知有这些坑：

- `push2his.eastmoney.com`（筹码分布、东财资金流）在境外网络下经常直接断连。
- 深交所的 XLSX 接口必须把 TLS 固定在 1.2 才能连上（`TLS12Adapter`）。
- 巨潮公告接口有速率限制，并发爬会返回非 JSON。

**放在境外机器上，多个模块会静默降级或失败。**要公网访问，优先选香港或境内的机器。

## 方案一（推荐）：源码上 GitHub，程序跑在本地

个人研究工具最合适的形态。零成本、不触发限流、网络在你自己这边。

```bash
git clone https://github.com/sylviachangdou-prayer/smashing_A_stock.git
cd smashing_A_stock
npm install
npm run local
```

换台电脑照样跑，GitHub 只承担版本管理。

## 方案二：整套上一台小机器

要一个能分享的网址时用。**一台 VPS 同时跑两个进程**，不要拆成 Serverless。

配置底线：1 vCPU / 1GB 内存 / 10GB 磁盘，Docker 版本随意。

`docker-compose.yml`（放仓库根目录）：

```yaml
services:
  api:
    build: { context: ., dockerfile: Dockerfile.api }
    ports: ["8010:8010"]
    volumes: ["./.cache:/app/.cache"]   # 缓存必须落盘，否则每次重启全部重爬
    restart: unless-stopped
  web:
    build: { context: ., dockerfile: Dockerfile.web }
    environment:
      NEXT_PUBLIC_API_BASE: "https://api.your-domain.com"
    ports: ["3000:3000"]
    depends_on: [api]
    restart: unless-stopped
```

`Dockerfile.api`：

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev
COPY backend ./backend
EXPOSE 8010
CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8010"]
```

`Dockerfile.web`：

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
```

上线前必须做的三件事：

1. **收窄 CORS**。`backend/main.py` 现在只允许 `localhost:3000`，改成你的正式域名。
2. **加访问控制**。哪怕只是 Nginx basic auth。公开的爬虫前端会很快让服务器 IP 被上游封禁。
3. **前端要在 `NEXT_PUBLIC_API_BASE` 指向正式后端之后重新 `npm run build`**——这个变量是构建时注入的，改环境变量不重启构建不生效。

## 关于合规

交易所和巨潮的数据是法定公开披露，转述没问题。东方财富、同花顺、新浪、腾讯是商业平台，其服务条款一般禁止转发数据。自用和公开发布是两种风险。页面已声明不构成投资建议，公开部署前建议把二手来源的模块关掉，或者只对自己开放。

## 后期更新版本

日常改动：

```bash
npm run lint && npm test && npm run test:api   # 三项都过再提交
git add -A
git commit -m "描述这次改了什么"
git push
```

如果是方案二，服务器上：

```bash
git pull && docker compose up -d --build
```

### 版本号与发布记录

发一个版本时打标签，GitHub 上会生成 Release 页面：

```bash
npm version minor -m "v%s：说明"
git push --follow-tags
```

`npm version` 会改 `package.json` 的 version 并自动建一个 tag。`patch` 修 bug、`minor` 加功能、`major` 破坏兼容。

### 依赖更新

Python 依赖锁在 `uv.lock`。akshare 的上游接口变动频繁，升级后一定跑 `npm run test:api`：

```bash
uv lock --upgrade-package akshare
npm run test:api
```

### 上游接口挂了怎么办

后端所有模块是独立降级的，单个上游失败只会让那个模块显示警告，不会拖垮整页。真正需要改代码的信号是 `npm run test:api` 里解析类用例失败——说明上游改了字段名或页面结构，去对应的 `*_record` / `parse_*` 函数改字段映射。

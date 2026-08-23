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

## 实际资源占用（本机实测）

| 项 | 实测 |
|---|---|
| 后端进程内存 | 导入依赖后 116 MB，跑几个请求后 138 MB |
| 依赖导入耗时 | 0.5 秒 |
| 缓存目录 | 有硬上限，稳定在 35 MB 上下（见下方“缓存上限”） |
| 单个年报 PDF 缓存 | 0.5–1 MB（解析后的纯文本） |

所以后端最低配是 **512 MB 内存**，1 GB 舒服；磁盘留 5–10 GB 给缓存。

## 方案一：源码上 GitHub，程序跑在本地

```bash
git clone https://github.com/sylviachangdou-prayer/smashing_A_stock.git
cd smashing_A_stock
npm install
npm run local
```

零成本，网络在你自己这边，所有模块都能通。缺点是只有你自己能用。

## 方案二（推荐）：后端留在本机，用隧道给出公网地址

想让朋友也能打开，但又不想为"网络位置"这个坑付钱时，这是最省事的做法：
**后端继续跑在你电脑上**（那里本来就连得通所有数据源），用隧道工具把 `127.0.0.1:8010` 映射成一个公网 HTTPS 地址，前端部署到 Cloudflare 免费额度，指向那个地址。

两个常用工具，目前都有够用的免费额度（用之前确认一下当前政策）：

- **Cloudflare Tunnel**：`cloudflared tunnel --url http://localhost:8010` 直接给一个临时 `*.trycloudflare.com` 地址，重启会变。想要固定地址需要一个挂在 Cloudflare 上的域名（域名本身约 ¥70/年），隧道本身免费。
- **Tailscale Funnel**：给一个固定的 `*.ts.net` 地址，免费，不用买域名。

```bash
# 1) 本机照常起服务
npm run local

# 2) 另开一个终端，把后端暴露出去
cloudflared tunnel --url http://localhost:8010
# 记下它打印的 https://xxxx.trycloudflare.com

# 3) 用这个地址重新构建前端并部署
NEXT_PUBLIC_API_BASE=https://xxxx.trycloudflare.com npm run build
npx wrangler deploy
```

代价：**你的电脑关机或断网，网站就没数据了**。朋友几个人偶尔看看的场景，这个代价通常可以接受。

## 方案三：整套上一台小机器

要 7×24 在线时用。VPS（Virtual Private Server）就是租来的一台 Linux 虚拟机，"1 核 1G"指 1 个 vCPU、1 GB 内存。
**同一台机器上同时跑两个进程**——Python 后端占 8010 端口，Node 前端占 3000 端口——而不是把它们拆到两个平台上。

选址按这个顺序：**香港/新加坡 > 境内 > 欧美**。境内机器网络最好，但绑域名对外提供服务需要 ICP 备案，个人办下来要几周。欧美机器最便宜，但前面说的那些接口会掉。

价格区间（会变，下单前自己核）：香港/新加坡 1 核 1G 大约 ¥30–60/月，欧美同配置能到 ¥15–25/月。

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

## 后端能不能白嫖

能找到免费额度，但对这个后端都不太合适，原因是同一个：

- **免费额度基本都在欧美**。前面说的网络位置问题在这里最致命。
- **休眠**。免费方案通常闲置几十分钟后停机，朋友下次打开要等冷启动。
- **磁盘是临时的**。重启就清空 `.cache/`，等于每个访客都触发一次完整重爬——巨潮索引 4–10 秒、年报 PDF 2 秒，而且很快会被上游限流。
- **内存**。512 MB 的免费档跑 pandas + akshare 是紧的（实测 138 MB 是稳态，加上 Node 前端就悬）。

结论：**对这个后端，免费方案里唯一真正好用的是"方案二"的隧道**——因为它不租别人的服务器，只是把你本机的服务开一个口。

需要区分清楚：以上四条里，真正卡死的是**网络位置**这一条，它是这个项目特有的（数据源全在境内）。如果一个后端不依赖境内网络，那么 **Hugging Face Spaces 的免费 Docker 档（2 vCPU / 16 GB 内存 / 50 GB 磁盘）是很够用的**，连几 GB 的模型权重都放得下，只是同样会休眠。判断标准就一条：你的后端要请求的服务，在欧美机器上连不连得通。

## 关于 GitHub Pages

`用户名.github.io/项目名` 这类地址是 GitHub Pages：免费、能绑自定义域名、但**只放静态文件，跑不了任何服务端程序**。

对这个项目：前端理论上能放上去（要先把 `app/layout.tsx` 里的 `headers()` 换成固定 URL，那是唯一用到服务端 API 的地方），但**后端永远放不进去**——没有 Python 运行时，也不能对外发请求。所以 Pages 只能解决"页面能打开"，解决不了"页面里有数据"。

既然 Cloudflare Workers 同样免费、这个项目本来就构建成 Worker、而且不用改代码，没必要绕 Pages 这一圈。

## 上线前必须做的事

1. **设 `ALLOWED_ORIGINS`**。默认只允许 `localhost:3000`。部署时改成正式前端域名（逗号分隔可以多个），否则别的站点能直接调用你的接口。
2. **确认限流**。默认每个来源 IP 每分钟 60 次，超出返回 429。`RATE_LIMIT_PER_MINUTE` 可调，设 0 关闭。这道是防止爬虫顺着你的接口去压上游披露站点，导致你的 IP 被封。
3. **要"只有我和朋友能看"再加一层身份验证**。上面两条挡的是滥用，不是身份。最简单的是 **Cloudflare Zero Trust → Access**（免费额度 50 人），给域名加邮箱验证码登录，不用改代码。
4. **前端必须在 `NEXT_PUBLIC_API_BASE` 指向正式后端之后重新 `npm run build`**——这个变量是构建时注入的，改环境变量不重新构建不生效。

## 缓存上限

`.cache/stock_tool/` 有两条硬上限，写入时自动清理，不会再无限增长：

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `COMPANY_CACHE_LIMIT` | 5 | 磁盘上最多保留 5 家公司的全部缓存；查第 6 家时，按最近使用时间淘汰最旧的那家 |
| `MARGIN_CACHE_DAYS` | 24 | 两融日快照是全市场文件（每份约 500 KB，所有公司共用），每个交易所只留最近 24 个交易日 |

之前没有上限，累积到 17 家公司 + 108 份两融快照就到了 62 MB；加上限后清到 34 MB，之后稳定在这个量级。

## 关于数据来源

交易所和巨潮是法定公开披露，转述没有问题。东方财富、同花顺、新浪、腾讯是商业平台，条款一般禁止把它们的数据作为服务再对外提供。自己和朋友查阅属于正常使用；只要不做成对公众开放的数据服务、不提供批量导出，就不涉及"转发数据"。加访问控制既是为了防爬虫，也是把这条边界划清楚。

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

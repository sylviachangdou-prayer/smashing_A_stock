# 发布与版本更新

## 先弄清楚这个项目是什么

它是**两个进程**，不是一个静态网页：

| | 技术栈 | 能不能上 Serverless |
|---|---|---|
| 前端 `app/` | Next.js，`next build` 导出为纯静态站 | 可以 |
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

## 选定方案：后端 Hugging Face Space + 前端 GitHub Pages

两边都免费、网址固定、不依赖你的电脑开着。前端是纯静态导出，数据全部由浏览器
直接调后端。已知代价写在最后。

---

### 第 0 步：确认本机是好的

部署前先在本机跑一遍，确认代码本身没问题：

```bash
cd ~/stock_tool
npm run local
```

打开 <http://localhost:3000> 随便查一家公司，页面顶部的模块条应该大部分显示「完整」或「部分」。确认无误后 `Ctrl+C` 停掉。

---

### 第 1 步：把代码推到 GitHub

Space 要从你的仓库拉代码，先确保 GitHub 上是最新的：

```bash
cd ~/stock_tool
git add -A
git commit -m "Add Hugging Face Space container"
git push
```

---

### 第 2 步：注册 Hugging Face

1. 打开 <https://huggingface.co/join>，用邮箱或 Google 注册。
2. 去邮箱点验证链接。不验证不能建 Space。

---

### 第 3 步：建一个 Space

1. 打开 <https://huggingface.co/new-space>
2. 按这个填：

   | 字段 | 填什么 |
   | --- | --- |
   | Owner | 你的用户名 |
   | Space name | `smashing-a-stock-api` |
   | License | 随意，`mit` 就行 |
   | Select the Space SDK | **Docker** → **Blank**（不要选 Streamlit/Gradio） |
   | Space hardware | **CPU basic · Free** |
   | Visibility | **Public** |

3. 点 **Create Space**。它会给你一个空仓库和一个地址：
   `https://huggingface.co/spaces/你的用户名/smashing-a-stock-api`

> **Visibility 为什么必须选 Public**：Private Space 的 API 需要带 token 才能访问，而前端是public
> 网页，token 藏不住。用 Public Space + 后端限流 + CORS 白名单来控制滥用。

---

### 第 4 步：把后端推到 Space

Space 是**另一个 git 仓库**，和 GitHub 那个不是一回事。先加远端：

```bash
cd ~/stock_tool
git remote add space https://huggingface.co/spaces/你的用户名/smashing-a-stock-api
```

然后用脚本推：

```bash
bash scripts/push-space.sh
```

**不要用 `git push space main`。** 直接推整个仓库会被 HF 拒绝：

```
Your push was rejected because it contains binary files.
Offending files:
  - public/og.png
```

HF 要求二进制文件走 Xet/LFS。但 Space 只跑后端，压根用不到 `public/`——
`Dockerfile` 只 COPY 了 `pyproject.toml`、`uv.lock` 和 `backend/`。
所以脚本只打包这几个路径推上去（约 244 KB，无二进制），顺带让前端改动不再触发
Space 重新构建。

推的时候会要账号密码：

- 用户名填你的 HF 用户名
- **密码不是登录密码，是 Access Token**。去 <https://huggingface.co/settings/tokens> →
  **Create new token** → 类型选 **Write** → 复制那串 `hf_...` 粘进去

推完回 Space 页面，会看到 **Building**。第一次要装 akshare 全套依赖，约 5–10 分钟，
点 **Logs** 看进度。变成 **Running** 就成了。

> **如果页面显示的是一个静态网页、没有 Building**：说明 Space 建成了 static 类型。
> 检查仓库根目录 `README.md` 顶部的配置头里是不是 `sdk: docker`，改好重推一次。

### 第 5 步：确认后端活着

浏览器打开：

```
https://你的用户名-smashing-a-stock-api.hf.space/api/health
```

注意这个地址的形式——用户名和 Space 名之间是**短横线**，不是斜杠。看到一段 JSON
（含 `"status": "ok"` 或 `"partial"`）就说明后端起来了。这个地址就是下一步要用的后端地址。

---

### 第 6 步：打开 GitHub Pages

仓库 → **Settings** → **Pages** → **Build and deployment** → Source 选 **GitHub Actions**。

只需要点这一次。仓库必须是公开的，否则免费版用不了 Pages。

---

### 第 7 步：告诉前端后端在哪

仓库 → **Settings** → **Secrets and variables** → **Actions** → **Variables** 标签 → **New variable**：

| Name | Value | 必需 |
| --- | --- | --- |
| `API_BASE` | `https://你的用户名-smashing-a-stock-api.hf.space` | 否，不设就用工作流里的默认值 |
| `GA_ID` | Google Analytics 的 `G-` 开头衡量 ID | 否，不设就完全不加载统计 |

---

### 第 8 步：触发一次发布

推任何改动到 `main` 就会自动发布。想立刻跑一次：

仓库 → **Actions** → **Publish site to Pages** → **Run workflow**。

约一分半钟，完成后网址是：

```
https://你的用户名.github.io/仓库名/
```

**跨域不用配。** Hugging Face 的网关会对任意来源回显 `Access-Control-Allow-Origin`，
所以后端的 `ALLOWED_ORIGINS` 在这套部署里不起作用，也不需要设。

---

### 第 9 步：验收

打开网址，查一家公司，重点看页面顶部的模块条：

| 模块 | 预期 |
| --- | --- |
| 实时行情、日线走势、公司总览、基本情况、报告期财务 | 完整 / 部分 |
| 机构持股、公募与私募、调研与研报、舆情、交易所登记 | 完整 / 部分 |
| 资金与筹码 | 完整 / 部分——东财不可用时会降级到新浪与腾讯口径，页面会标注 |

模块条就是诊断工具。哪个显示「失败」，点开对应区块，底部「取数状态与来源」里有具体原因。

---

## 让 Space 不休眠（不用买 CPU Upgrade）

HF 文档：cpu-basic 的 Space 闲置 **48 小时**后休眠，而「任何访问都会自动重启它」。
所以定时 ping 就能重置计时，不必买 $0.03/小时（约 **$22/月/个**）的 CPU Upgrade。

仓库里的 `.github/workflows/keep-warm.yml` 就是干这个的，**出厂是关的**——
定时任务第一步检查仓库变量 `KEEP_WARM`，不是 `on` 就秒退。

在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 设两个：

| 变量 | 值 |
| --- | --- |
| `SPACE_URL` | `https://你的用户名-smashing-a-stock-api.hf.space` |
| `KEEP_WARM` | `on` 保持唤醒，`off`（或删掉）让它休眠 |

日常：

- **要分享链接了** → `KEEP_WARM` 设成 `on`，一次网页编辑，不用提交
- **不用了** → 设成 `off`，workflow 留着空转
- **现在就想叫醒** → Actions → *Keep Space warm* → **Run workflow**。手动触发无视
  `KEEP_WARM`，关着也能用，适合发链接前一分钟点一下

ping 频率不影响成本：只要成功阻止休眠，容器就是 24/7 常驻，6 小时和 40 小时一个样。
间隔短只是留安全余量——GitHub 的定时任务是尽力而为，高负载时会延迟甚至跳过，
而且公开仓库超过约 60 天没有活动，定时任务会被自动停用。

## 这套方案已知的代价

**筹码成本拿不到。** `push2his.eastmoney.com` 从境外机器连不上，而它是筹码分布的唯一来源。
页面会明确显示「未取得」并说明原因，不会拿别的数据凑。

**东财资金流降级。** 同一个域名的问题。会自动切到新浪财经的全单净流入口径，
表头会标注实际用的是哪个口径——两者不是一回事，不要混着看。

**休眠。** 48 小时没人访问就休眠，下一个访客的请求会唤醒它。这个后端没有模型要加载，
冷启动就是容器启动的时间，几十秒。要避免可以照 stylometry 那套做定时 ping，但对这个项目
通常不值得。

**缓存会清空。** 免费 Space 磁盘不持久，休眠或重启后 `/home/user/cache` 清空。
影响是每家公司第一次查会慢（年报 PDF 要重下、巨潮索引要重爬）。缓存上限本来就只有
5 家公司 / 34 MB，重建代价可控。

**GitHub 和 Space 是两个仓库。** 以后改了代码要推两次：`git push` 给 GitHub，
`git push space main` 给 Space。只推 GitHub 的话线上不会变。

---

## 方案对照（当时怎么选的）

| | 临时隧道 | Tailscale Funnel | **HF Space** | VPS |
| --- | --- | --- | --- | --- |
| 费用 | 免费 | 免费 | **免费** | ¥30–60/月 |
| 网址固定 | ❌ | ✅ | **✅** | ✅ |
| 要你电脑开着 | 要 | 要 | **不要** | 不要 |
| 筹码模块 | ✅ | ✅ | **❌** | 看选址 |
| 缓存持久 | ✅ | ✅ | **❌** | ✅ |

选 HF 是因为「随时可访问」这一条压倒了其他考虑。

前端最初发到 Cloudflare Workers，但该账号被 Cloudflare 风控禁止注册 workers.dev
子域名（面板提示 `You cannot register a workers.dev subdomain`），Worker 部署得上去
却拿不到网址。改成纯静态导出发 GitHub Pages 之后，整套 Cloudflare 工具链
（vinext、vite、wrangler 等七个依赖）都不再需要，已从仓库移除。

---

## 备选：源码上 GitHub，只在本地跑

```bash
git clone https://github.com/sylviachangdou-prayer/smashing_A_stock.git
cd smashing_A_stock
npm install
npm run local
```

零成本、所有模块都通、缓存持久，缺点是只有你自己能用。

## 为什么前端能放进 GitHub Pages

Pages 只放静态文件，跑不了服务端程序。这个项目正好合适：两个主页面都是
`"use client"`，唯一的服务端依赖是 `app/layout.tsx` 里用 `headers()` 拼 OG 图地址，
换成构建期变量后整站可以静态导出，数据全部由浏览器直接调 HF 后端。

后端放不进 Pages——没有 Python 运行时，也不能对外发请求——所以它留在 HF Space。

## 环境变量一览

后端全部通过环境变量配置，本机不设也能跑（用的是默认值）。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | 允许跨域的前端地址，逗号分隔。**部署后必须设成正式网址** |
| `RATE_LIMIT_PER_MINUTE` | `60` | 每个来源 IP 每分钟请求上限，超出返回 429。设 `0` 关闭 |
| `COMPANY_CACHE_LIMIT` | `5` | 磁盘上最多保留几家公司的缓存 |
| `MARGIN_CACHE_DAYS` | `24` | 每个交易所保留多少个交易日的两融快照 |
| `STOCK_TOOL_CACHE_DIR` | 仓库内 `.cache/stock_tool` | 缓存目录。容器里指向家目录 |

前端只有一个，且是**构建时**注入：

| 变量 | 作用 |
| --- | --- |
| `NEXT_PUBLIC_API_BASE` | 后端地址，构建期烤进前端。线上由工作流从仓库变量 `API_BASE` 注入 |
| `NEXT_PUBLIC_BASE_PATH` | Pages 的仓库子路径，例如 `/smashing_A_stock`。本地开发留空 |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 衡量 ID，不设就不加载统计 |

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

代码改完后，**两个仓库都要推**——GitHub 是源码，Space 是线上：

```bash
npm run lint && npm test && npm run test:api   # 三项都过再提交
git add -A
git commit -m "描述这次改了什么"
git push          # GitHub
bash scripts/push-space.sh   # Hugging Face Space，推完自动重新构建
```

前端不用单独发布——推到 `main` 之后 Pages 工作流会自动重新导出并上线。
只改了后端（`backend/` 下的文件）时，Pages 不会重跑，只需要推 Space。


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

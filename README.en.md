[中文](README.md) · **English**

# A-Share Company Research Desk

Look up any company listed on the Shanghai, Shenzhen, or Beijing stock exchange by name or six-digit code. The page renders only values that were actually retrieved and carry a `source_id`. When an upstream is missing or times out, that module says so on its own — no substitute value is ever generated.

- Site: <https://sylviachangdou-prayer.github.io/smashing_A_stock/>
- Data service: <https://sylviachangdou-prayer-smashing-a-stock-api.hf.space>

## Running it locally

Requires Node.js 22+, Python 3.12 and [`uv`](https://docs.astral.sh/uv/).

```bash
npm install
npm run local
```

- Page: <http://localhost:3000>
- Data service: <http://127.0.0.1:8010>
- Health check: <http://127.0.0.1:8010/api/health>
- Coverage check: <http://127.0.0.1:8010/api/coverage>

The first run installs Python dependencies from `uv.lock`. The cache keeps at most 5 companies (`COMPANY_CACHE_LIMIT`) and the last 24 trading days of margin snapshots per exchange (`MARGIN_CACHE_DAYS`), evicting on write. Endpoints are rate-limited to 60 requests per source per minute (`RATE_LIMIT_PER_MINUTE`); cross-origin callers are controlled by `ALLOWED_ORIGINS`. The code table, financials, shareholders, margin data and filings are written to `.cache/stock_tool/`; the page's "bypass cache" control refetches a company's modules.

## Endpoints

- `GET /api/search?q=`
- `GET /api/market-brief` — global market headlines, cached for six hours
- `GET /api/sectors?kind=industry|concept`
- `GET /api/sectors/{kind}/{board_name}?board_code=`
- `GET /api/company/{code}/overview`
- `GET /api/company/{code}/quote`
- `GET /api/company/{code}/logo` — redirects to the favicon of the company's own website
- `GET /api/company/{code}/capital?days=20`
- `GET /api/company/{code}/contracts?months=24`
- `GET /api/company/{code}/peers`
- `GET /api/company/{code}/business` — core technology, controlling shareholder and beneficial owner, and top five customers and suppliers as written in the annual report; domestic and overseas peers as named in the offering document; business scope and product breakdown
- `GET /api/company/{code}/financials?periods=4` — revenue, net profit, gross margin, return on assets, receivables, contract liabilities, short- and long-term borrowings and owners' equity for the last four reporting periods
- `GET /api/company/{code}/institutions` — institutional holdings over the last two reporting periods, mutual fund position changes, and private funds, the national social security fund, QFII and insurance products classified by the upstream holder type
- `GET /api/company/{code}/moneyflow?days=22` — daily net capital inflow, plus the average cost basis for the query date and the two preceding trading days
- `GET /api/company/{code}/research?months=6` — institutional site visits and sell-side research notes
- `GET /api/company/{code}/exchange` — registration fields from the listing exchange, plus direct links to the company's page and filing search on the SSE/SZSE/BSE sites and its CNINFO disclosure page
- `GET /api/company/{code}/sentiment?months=12&news_limit=5` — filings matching negative keywords, and the most recent news items in reverse chronological order (event and link)
- `GET /api/coverage?refresh=false`
- `GET /api/health`

Every endpoint returns the same envelope:

```json
{
  "data": {},
  "sources": [],
  "warnings": [],
  "as_of": "ISO-8601",
  "status": "ok | partial | empty | error"
}
```

## Deployment

The frontend is a static export published to GitHub Pages; the backend runs as a Docker Space on Hugging Face. Deployment steps and the release process are in [DEPLOY.md](DEPLOY.md).

## Checks

```bash
npm run lint
npm test
npm run test:api
```

## How the numbers are derived

- Exchange registration fields come straight from the listing exchange's own public endpoints (SSE `query.sse.com.cn`, SZSE `szse.cn/api`, BSE `bse.cn/nqxxController`) and are labelled official. Annual and interim reports are taken from CNINFO, the disclosure platform designated by the CSRC.
- Core technology, the controlling shareholder and beneficial owner, and the top five customers and suppliers come from the mandatory disclosure sections of the latest annual report on CNINFO. Domestic and overseas peers come from the industry-competition section of the most recent prospectus or offering circular. Both are shown verbatim, labelled with the document name and filing date.
- The filing index uses CNINFO first. When CNINFO refuses the request, it falls back to Eastmoney's filing library and then to the listing exchange's own endpoint (SZSE `szse.cn/api/disc`, SSE `query.sse.com.cn`); the text still comes from the original PDF of the same document, and `publisher` in `sources` names the provider actually used. The SSE filing PDF host is behind a JavaScript challenge, so the SSE fallback supplies titles and links only, not extracted text.
- Gross margin and return on assets are computed deterministically from the reported figures and are not annualised; periods without a cost-of-sales figure are left blank. Amounts disclosed in units of ten thousand or one million yuan are converted to yuan, with the original figure preserved.
- Private funds, the social security fund, QFII and insurance are classified by the `HOLDER_TYPE` that Eastmoney attaches to the top ten tradable shareholders. Positions outside that group are not disclosed per-stock through any public channel.
- The negative-sentiment filing list matches keywords against titles, and the keyword list is returned with the response. The news list is not filtered: it takes the most recent `news_limit` items in reverse chronological order and gives an event and a link for each. A keyword match is not a finding of fact.
- Main-force capital flow and cost basis are trading-platform estimates. When Eastmoney is unavailable the flow falls back to Sina Finance's all-orders net inflow, and `caliber` in the response names the measure actually used. Requests to Eastmoney's historical quote endpoint are retried across mirror hosts.
- The cost basis is computed here from daily bars using the triangular chip-decay model Eastmoney publishes, the same algorithm its own page uses. When Eastmoney's historical quotes are unavailable, Tencent Securities daily bars are used instead and turnover is derived from the current tradable share count; the response carries a warning about that difference.

This project uses no OpenAI API, includes no licensed commercial data, and is not investment advice.

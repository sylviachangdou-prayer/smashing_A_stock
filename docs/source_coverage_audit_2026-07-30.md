# Source coverage and latency audit

Audit time: 2026-07-30 in Chicago / 2026-07-31 in China. The user's U.S. VPN remained enabled. Timings are single observed wall-clock measurements, not service-level guarantees.

## Current-company coverage

| Exchange | Live official records | Search-cache records | Missing from search | Extra in search | Observed source time |
|---|---:|---:|---:|---:|---:|
| Shanghai Stock Exchange | 2,310 | 2,310 | 0 | 0 | Main board 12.541 s; STAR Market 5.400 s |
| Shenzhen Stock Exchange | 2,893 | 2,893 | 0 | 0 | 6.335 s with TLS 1.2 |
| Beijing Stock Exchange | 331 | 331 | 0 | 0 | 35.836 s |
| Total | 5,534 | 5,534 | 0 | 0 | Full parallel refresh 36.182 s |

Integrity checks found zero duplicate codes and zero malformed six-digit codes. Cached searches for `600519`, `300750`, and `平安银行` completed in 3.4–4.5 ms.

The Shenzhen endpoint reset the connection under default TLS negotiation. The same official XLSX endpoint returned all 2,893 records when the client fixed TLS at version 1.2; turning off the VPN was not required. The local service now uses that connection mode.

“Zero missing” is defined against the three current official listed-company tables. It does not include B shares, funds, bonds, pending IPOs, delisted companies, or non-BSE NEEQ companies. The CNINFO cross-market JSON returned 6,146 A-share-labelled records in 4.928 s, but it includes historical delisted records such as `000003` and `600001`; it is therefore unsuitable as the current-listed-company denominator.

Official list pages:

- SSE: https://www.sse.com.cn/assortment/stock/list/share/
- SZSE: https://www.szse.cn/market/product/stock/list/index.html
- BSE: https://www.bse.cn/nq/listedcompany.html

## Sector-movement channels

| Channel | Data obtained | Rows | Observed time | Result under VPN | Qualification |
|---|---|---:|---:|---|---|
| Sina Finance | Industry snapshot | 49 | 2.661 s | Success | Change, turnover amount, leading stock and constituent label; no official exchange taxonomy |
| Sina Finance | Concept snapshot | 175 | 1.230 s | Success | Same snapshot structure; concepts are provider-defined |
| Sina Finance | One industry’s constituents | 19 | 2.253 s | Success | Includes price, change, turnover, market value and P/E |
| Eastmoney | Industry snapshot | 0 | 10.127 s | Connection closed | Richer schema when reachable, but unreliable from the current VPN route |
| Eastmoney | Concept snapshot | 0 | 30.577 s | HTTP 502 | Not suitable as the primary source in this environment |
| Tonghuashun | Industry summary | 90 | 5.133 s | Success | Includes change, turnover, net flow, rise/fall counts and leader |
| Tonghuashun | Concept event summary | 50 | 7.784 s | Success | Event/driver table, not a price-movement snapshot comparable with Sina concepts |

Current implementation uses Sina first for board snapshots and Sina constituents when a Sina board label is available. Eastmoney remains a fallback and all returned rows are marked secondary. The overview cache lasts five minutes.

Sina is the fastest viable primary channel in the tested VPN environment. Tonghuashun is a useful independent industry cross-check but cannot replace the concept snapshot without mixing different objects: its concept endpoint reports dated drivers and leaders rather than a full contemporaneous movement table. Exchange statistics are authoritative but generally monthly, index-specific, or exchange-specific; they do not provide one unified real-time industry/concept board universe.

“Latest” means the most recent snapshot returned by the provider at the recorded retrieval time. It does not imply exchange-certified real-time delivery, and the keyword controls such as “technology-related” are disclosed convenience filters rather than an official classification.

Sector pages:

- Sina Finance: https://finance.sina.com.cn/stock/sl/
- Eastmoney: https://quote.eastmoney.com/center/boardlist.html
- Tonghuashun: https://q.10jqka.com.cn/thshy/

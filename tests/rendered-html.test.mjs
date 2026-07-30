import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const backendUrl = new URL("../backend/main.py", import.meta.url);

test("removes hard-coded demonstration companies and values", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.doesNotMatch(page, /const companies|const flows|整车客户 A|演示市值|86\.42 亿元/);
  assert.doesNotMatch(page, /尚未选择公司|从名称或代码开始查询/);
  assert.match(page, /今日全球财经头条/);
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
  assert.match(submitSearch, /searchCompanies\(keyword\)/);
  assert.doesNotMatch(submitSearch, /if \(suggestions\[0\]\)/);
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
  assert.match(page, /预计仍需约/);
});

test("backend exposes the required independent endpoints and response envelope", async () => {
  const backend = await readFile(backendUrl, "utf8");
  for (const route of [
    "/api/search",
    "/api/market-brief",
    "/api/company/{raw_code}/overview",
    "/api/company/{raw_code}/capital",
    "/api/company/{raw_code}/contracts",
    "/api/company/{raw_code}/peers",
    "/api/health",
  ]) {
    assert.match(backend, new RegExp(route.replace(/[{}]/g, "\\$&")));
  }
  for (const key of ["data", "sources", "warnings", "as_of", "status"]) {
    assert.match(backend, new RegExp(`"${key}"`));
  }
});

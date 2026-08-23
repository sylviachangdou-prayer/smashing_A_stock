from backend import main
from backend.main import field, normalize_code, response


def test_normalize_code():
    assert normalize_code("SH600519") == "600519"


def test_field_requires_a_source():
    item = field(100, "source-1", "2025-12-31")
    assert item == {"value": 100, "source_id": "source-1", "period": "2025-12-31"}
    assert field(100, "") is None


def test_response_shape():
    payload = response({"ok": True}, [], [])
    assert set(payload) == {"data", "sources", "warnings", "as_of", "status"}
    assert payload["status"] == "ok"


def test_overview_keeps_other_modules_when_one_source_times_out(monkeypatch):
    monkeypatch.setattr(
        main,
        "lookup_company",
        lambda code: {
            "code": code,
            "name": "测试公司",
            "exchange": "SSE",
            "market": "上交所",
            "source_id": "sse-stock-list",
        },
    )
    monkeypatch.setattr(main, "profile_data", lambda *_: (_ for _ in ()).throw(TimeoutError()))
    financial_source = main.source(
        "financial-source",
        "测试发布机构",
        "测试财报",
        "https://example.com/report",
        tier="secondary",
    )
    monkeypatch.setattr(
        main,
        "financial_data",
        lambda *_: (
            {
                "period": "2025-12-31",
                "metrics": {
                    "revenue": {
                        "value": 100,
                        "source_id": "financial-source",
                        "period": "2025-12-31",
                    }
                },
                "annual_metrics": [],
            },
            [financial_source],
            [],
        ),
    )
    monkeypatch.setattr(main, "business_segments", lambda *_: ([], None))
    monkeypatch.setattr(main, "shareholder_data", lambda *_: ([], [], []))

    payload = main.overview("600519")

    assert payload["status"] == "partial"
    assert payload["data"]["financial"]["metrics"]["revenue"]["value"] == 100
    assert any("公司概况获取失败" in warning for warning in payload["warnings"])
    source_ids = {item["source_id"] for item in payload["sources"]}
    assert payload["data"]["identity"]["code"]["source_id"] in source_ids
    assert payload["data"]["financial"]["metrics"]["revenue"]["source_id"] in source_ids


def test_contract_missing_fields_are_not_invented(monkeypatch):
    monkeypatch.setattr(
        main,
        "lookup_company",
        lambda code: {
            "code": code,
            "name": "测试公司",
            "exchange": "SSE",
            "market": "上交所",
            "source_id": "sse-stock-list",
        },
    )
    monkeypatch.setattr(
        main,
        "cached",
        lambda *_args, **_kwargs: [
            {
                "公告标题": "关于签订框架合同的公告",
                "公告时间": "2026-01-10",
                "公告链接": "https://example.com/disclosure",
            }
        ],
    )

    payload = main.contracts("600519", months=24)
    row = payload["data"][0]

    assert payload["status"] == "ok"
    assert "counterparty" not in row
    assert "amount_text" not in row


def test_strict_mode_excludes_secondary_overview_modules(monkeypatch):
    monkeypatch.setattr(
        main,
        "lookup_company",
        lambda code: {
            "code": code,
            "name": "测试公司",
            "exchange": "SSE",
            "market": "上交所",
            "source_id": "sse-stock-list",
        },
    )
    official_source = main.source("official-profile", "巨潮资讯", "公司概况", "https://example.com/profile")
    monkeypatch.setattr(
        main,
        "profile_data",
        lambda *_: ({"industry": main.field("测试行业", "official-profile")}, official_source),
    )
    monkeypatch.setattr(
        main,
        "financial_data",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("strict mode must skip secondary finance")),
    )

    payload = main.overview("600519", mode="strict")

    assert payload["data"]["financial"] == {}
    assert payload["data"]["shareholders"] == []
    assert payload["data"]["business_segments"] == []
    assert {item["tier"] for item in payload["sources"]} == {"official"}


def test_structured_contract_mode_skips_pdf_extraction(monkeypatch):
    monkeypatch.setattr(
        main,
        "lookup_company",
        lambda code: {
            "code": code,
            "name": "测试公司",
            "exchange": "SSE",
            "market": "上交所",
            "source_id": "sse-stock-list",
        },
    )
    monkeypatch.setattr(
        main,
        "cached",
        lambda *_args, **_kwargs: [
            {
                "公告标题": "关于签订重大合同的公告",
                "公告时间": "2026-01-10",
                "公告链接": "https://example.com/disclosure.pdf",
            }
        ],
    )
    monkeypatch.setattr(
        main,
        "extract_contract_fields",
        lambda *_: (_ for _ in ()).throw(AssertionError("structured mode must skip PDF extraction")),
    )

    payload = main.contracts("600519", months=24, mode="structured")

    assert payload["status"] == "ok"
    assert "counterparty" not in payload["data"][0]


def test_market_brief_keeps_source_links(monkeypatch):
    monkeypatch.setattr(
        main,
        "cached",
        lambda *_args, **_kwargs: [
            {
                "标题": "测试财经头条",
                "摘要": "测试摘要",
                "发布时间": "2026-07-30 12:00:00",
                "链接": "https://example.com/news",
            }
        ],
    )

    payload = main.market_brief()

    assert payload["status"] == "ok"
    assert payload["data"]["headlines"][0]["title"] == "测试财经头条"
    assert payload["data"]["headlines"][0]["source_id"] == payload["sources"][0]["source_id"]


def test_stock_master_unions_both_fallbacks_and_prefers_official():
    batches = [
        ([{"证券代码": "600001", "证券简称": "官方名称"}], "sse-stock-list"),
        (
            [
                {"代码": "600001", "名称": "备用名称"},
                {"代码": "000001", "名称": "深市公司一"},
            ],
            "eastmoney-stock-list",
        ),
        ([{"代码": "000002", "名称": "深市公司二"}], "sina-stock-list"),
    ]
    stale = [
        {
            "code": "000003",
            "name": "深市缓存公司",
            "exchange": "SZSE",
            "market": "深交所",
            "source_id": "sina-stock-list",
        },
        {
            "code": "600099",
            "name": "上交所旧缓存",
            "exchange": "SSE",
            "market": "上交所",
            "source_id": "sina-stock-list",
        },
    ]

    items = main.merge_stock_master_batches(batches, {"sse-stock-list"}, stale)
    by_code = {item["code"]: item for item in items}

    assert set(by_code) == {"000001", "000002", "000003", "600001"}
    assert by_code["600001"]["name"] == "官方名称"
    assert by_code["600001"]["source_id"] == "sse-stock-list"


def test_stock_master_audit_detects_complete_three_market_table():
    items = [
        {"code": "600001", "exchange": "SSE", "source_id": "sse-stock-list"},
        {"code": "000001", "exchange": "SZSE", "source_id": "szse-stock-list"},
        {"code": "920001", "exchange": "BSE", "source_id": "bse-stock-list"},
    ]

    audit = main.stock_master_audit(items)

    assert audit["exchange_counts"] == {"SSE": 1, "SZSE": 1, "BSE": 1}
    assert audit["duplicate_count"] == 0
    assert audit["invalid_codes"] == []
    assert audit["integrity_ok"] is True


def test_cninfo_extended_scope_keeps_historical_and_b_shares():
    payload = {
        "stockList": [
            {"code": "600519", "zwjc": "贵州茅台", "category": "A股"},
            {"code": "000003", "zwjc": "PT金田A", "category": "A股"},
            {"code": "200002", "zwjc": "万科B", "category": "B股"},
            {"code": "510300", "zwjc": "沪深300ETF", "category": "基金"},
        ]
    }

    items = main.normalize_cninfo_companies(payload, {"600519"})
    by_code = {item["code"]: item for item in items}

    assert set(by_code) == {"600519", "000003", "200002"}
    assert by_code["600519"]["listing_status"] == "current"
    assert by_code["000003"]["listing_status"] == "historical_or_other"
    assert by_code["200002"]["security_type"] == "B股"


def test_company_icon_is_discovered_from_official_homepage(monkeypatch):
    class Homepage:
        url = "https://example.com/company/"
        text = '<html><link rel="shortcut icon" href="/assets/company.ico"></html>'

        @staticmethod
        def raise_for_status():
            return None

    monkeypatch.setattr(main.requests, "get", lambda *_args, **_kwargs: Homepage())

    assert main.discover_company_icon("example.com") == "https://example.com/assets/company.ico"


def test_tencent_quote_parser_keeps_price_and_market_fields(monkeypatch):
    values = [""] * 50
    values[1] = "贵州茅台"
    values[2] = "600519"
    values[3] = "1350.60"
    values[4] = "1361.76"
    values[5] = "1330.03"
    values[30] = "20260731161450"
    values[31] = "-11.16"
    values[32] = "-0.82"
    values[33] = "1355.72"
    values[34] = "1325.77"
    values[36] = "55128"
    values[37] = "737346.2605"
    values[38] = "0.44"
    values[39] = "20.41"
    values[44] = "16883.60"
    values[45] = "16883.60"
    values[46] = "7.25"

    class QuoteResponse:
        text = f'v_sh600519="{"~".join(values)}";'
        encoding = ""

        @staticmethod
        def raise_for_status():
            return None

    monkeypatch.setattr(main.requests, "get", lambda *_args, **_kwargs: QuoteResponse())

    quote = main.tencent_quote("600519")

    assert quote["latest"] == 1350.6
    assert quote["change_percent"] == -0.82
    assert quote["amount"] == 7_373_462_605
    assert round(quote["market_cap"]) == 1_688_360_000_000
    assert quote["quote_time"] == "2026-07-31 16:14:50"


def test_sector_overview_keeps_latest_values_and_source(monkeypatch):
    monkeypatch.setattr(
        main,
        "cached",
        lambda *_args, **_kwargs: [
            {
                "板块名称": "半导体",
                "板块代码": "BK1036",
                "涨跌幅": 2.5,
                "换手率": 3.2,
                "上涨家数": 80,
                "下跌家数": 12,
                "领涨股票": "测试科技",
            }
        ],
    )

    payload = main.sectors("industry")
    board = payload["data"]["boards"][0]

    assert payload["status"] == "ok"
    assert board["name"] == "半导体"
    assert board["change_percent"] == 2.5
    assert board["source_id"] == payload["sources"][0]["source_id"]


def test_sector_members_keep_company_level_source(monkeypatch):
    monkeypatch.setattr(
        main,
        "cached",
        lambda *_args, **_kwargs: [
            {"代码": "688001", "名称": "测试芯片", "最新价": 100, "涨跌幅": 1.2, "成交额": 500000000}
        ],
    )

    payload = main.sector_members("industry", "半导体")
    company = payload["data"]["companies"][0]

    assert company["code"] == "688001"
    assert company["amount"] == 500000000
    assert company["source_id"] == payload["sources"][0]["source_id"]


THS_PARTNER_HTML = """
<div id="provider">
<div class="m_tab"><ul>
<li class="cur"><a href="javascript:void(0);" class="operateTab" tag="0">2025-12-31</a></li>
<li><a href="javascript:void(0);" class="operateTab" tag="1">2024-12-31</a></li>
</ul></div>
<div class="m_charts_tit">前5大客户：共销售了<i>13.45亿</i>元,占营业收入的<i>14.94%</i></div>
<table><thead><tr><th>客户名称</th><th>销售额（元）</th><th>占比</th></tr></thead>
<tbody><tr><td class="tc"> <div class="clientname">客户1</div></td><td class="tc">3.31亿</td><td class="tc">3.67%</td></tr></tbody>
</table>
<div class="m_charts_tit">前5大供应商：共采购了<i>10.06亿</i>元,占总采购额的<i>26.86%</i></div>
<table><thead><tr><th>供应商名称</th><th>采购额（元）</th><th>占比</th></tr></thead>
<tbody><tr><td class="tc"> <div class="clientname">潮州某材料公司</div></td><td class="tc">2.52亿</td><td class="tc">6.74%</td></tr></tbody>
</table>
</div>
"""

THS_CONTROL_HTML = """
<td><div class="tipbox_wrap"><strong class="hltip fl">控股股东：</strong>
<span>某某投资有限公司 <span class="gray">(持有测试公司股份比例：32.46%）</span></span></div></td>
<td><div class="tipbox_wrap"><strong class="hltip fl">实际控制人：</strong>
<span>张三 <span class="gray">(持有测试公司股份比例：21.92%）</span></span></div></td>
<table class="m_table ggintro"><thead><tr><td rowspan="2" class="title"><h3> 张三 </h3></td></tr></thead>
<tbody><tr><td colspan="4" class="mainintro"><div><p>张三先生，1949年12月出生，中国国籍，曾任测试公司董事长。</p></div></td></tr></tbody></table>
"""


def test_ths_partners_reads_only_the_latest_period_block():
    partners = main.ths_partners(THS_PARTNER_HTML)

    assert partners["period"] == "2025-12-31"
    assert partners["customers"] == [{"name": "客户1", "amount_text": "3.31亿", "share_text": "3.67%"}]
    assert partners["suppliers"][0]["name"] == "潮州某材料公司"
    assert partners["customers_total"] == {
        "amount_text": "13.45亿",
        "denominator": "营业收入",
        "share_text": "14.94%",
    }
    assert partners["suppliers_total"]["share_text"] == "26.86%"


def test_ths_partners_returns_nothing_without_the_section():
    assert main.ths_partners("<div>no provider block</div>") == {}


def test_ths_control_chain_attaches_a_resume_only_on_a_name_match():
    chain = main.ths_control_chain(THS_CONTROL_HTML)

    assert chain["controlling_shareholder"] == {"name": "某某投资有限公司", "ratio_percent": 32.46}
    assert chain["actual_controller"]["name"] == "张三"
    assert chain["actual_controller"]["ratio_percent"] == 21.92
    assert "曾任测试公司董事长" in chain["actual_controller"]["resume"]
    assert "resume" not in chain["controlling_shareholder"]


def test_negative_keyword_matching_reports_the_matched_words():
    assert main.matched_words("关于公司股票交易将被实施退市风险警示的公告") == ["退市风险", "风险警示"]
    assert main.matched_words("2025年年度报告") == []


def test_ratio_returns_none_instead_of_dividing_by_zero():
    assert main.ratio(50, 200) == 25
    assert main.ratio(50, 0) is None
    assert main.ratio(None, 200) is None


def test_financials_computes_ratios_from_disclosed_line_items(monkeypatch):
    monkeypatch.setattr(main, "lookup_company", lambda code: {"code": code})
    monkeypatch.setattr(
        main,
        "financial_frames",
        lambda *_args, **_kwargs: (
            [{"REPORT_DATE": "2026-03-31", "TOTAL_OPERATE_INCOME": 1000, "OPERATE_COST": 600, "NETPROFIT": 100,
              "PARENT_NETPROFIT": 90}],
            [{"REPORT_DATE": "2026-03-31", "TOTAL_ASSETS": 5000, "SHORT_LOAN": 200, "LONG_LOAN": 300,
              "TOTAL_EQUITY": 4000, "ACCOUNTS_RECE": 150, "CONTRACT_LIAB": 50}],
        ),
    )
    monkeypatch.setattr(main, "latest_report_source", lambda *_args, **_kwargs: None)

    row = main.financials("300408", periods=4)["data"]["rows"][0]

    assert row["gross_margin_percent"] == 40
    assert row["return_on_assets_percent"] == 2
    assert row["short_term_loan"] == 200
    assert row["total_equity"] == 4000
    assert row["source_id"].endswith("2026-03-31")


def test_moneyflow_falls_back_to_sina_and_names_the_caliber(monkeypatch):
    monkeypatch.setattr(main, "lookup_company", lambda code: {"code": code})
    monkeypatch.setattr(
        main,
        "sina_money_flow",
        lambda code, days, source_id, refresh: [
            {"date": "2026-08-14", "main_net": -283750523.88, "source_id": source_id}
        ],
    )

    def failing_cache(key, ttl, loader, refresh=False):
        if key.startswith("moneyflow_"):
            raise ConnectionError("upstream unavailable")
        return []

    monkeypatch.setattr(main, "cached", failing_cache)
    payload = main.moneyflow("300408", days=22)

    assert payload["data"]["caliber"] == main.SINA_FLOW_CALIBER
    assert payload["data"]["daily_main_flow"][0]["source_id"] == "sina-moneyflow-300408"
    assert any("新浪财经" in warning for warning in payload["warnings"])


SZSE_PARTNER_SECTION = (
    "公司主要销售客户情况 前五名客户合计销售金额（元） 1,345,346,279.81 "
    "前五名客户合计销售金额占年度销售总额比例 14.94% "
    "前五名客户销售额中关联方销售额占年度销售总额比例 0.00% "
    "公司前 5大客户资料 序号 客户名称 销售额（元） 占年度销售总额比例 "
    "1 客户 1 330,717,999.78 3.67% 2 客户 2 327,956,360.84 3.64% "
    "合计 -- 1,345,346,279.81 14.94% "
    "公司主要供应商情况 前五名供应商合计采购金额（元） 1,005,824,993.02 "
    "前五名供应商合计采购金额占年度采购总额比例 26.86%"
)
SSE_PARTNER_SECTION = (
    "主要销售客户及主要供应商情况 前五名客户销售额1,704,578.78万元，占年度销售总额10.10%；"
    "其中前五名客户销售额中关联方销售额635,829.28万元，占年度销售总额3.77%。"
    "前五名供应商采购额348,825.84万元，占年度采购总额38.12%。"
)


def test_partner_section_reads_the_shenzhen_table_form():
    parsed = main.parse_partner_section(SZSE_PARTNER_SECTION)

    assert parsed["customers"]["amount"] == 1345346279.81
    assert parsed["customers"]["share_percent"] == 14.94
    assert [row["name"] for row in parsed["customers"]["rows"]] == ["客户1", "客户2"]
    assert parsed["customers"]["rows"][0]["amount"] == 330717999.78
    assert parsed["suppliers"]["amount"] == 1005824993.02
    assert parsed["suppliers"]["share_percent"] == 26.86


def test_partner_section_converts_shanghai_narrative_units():
    parsed = main.parse_partner_section(SSE_PARTNER_SECTION)

    assert parsed["customers"]["amount_text"] == "1,704,578.78万元"
    assert parsed["customers"]["amount"] == 17045787800
    assert parsed["customers"]["share_percent"] == 10.10
    assert parsed["customers"]["rows"] == []
    assert parsed["suppliers"]["share_percent"] == 38.12


def test_report_section_prefers_the_occurrence_carrying_the_signal():
    text = "行业竞争情况 （一）所处行业的基本情况 概述 三、公司主营业务 X 行业竞争情况 全球市场主要参与者包括村田、京瓷。 三、公司主营业务"
    picked = main.report_section(
        text, ("行业竞争情况",), ("三、公司主营业务",), 200, signal=r"主要参与者"
    )

    assert "村田" in picked
    assert "所处行业的基本情况" not in picked


def test_holder_category_uses_the_upstream_label_first():
    assert main.holder_category("某某产品", "私募基金") == "private_fund"
    assert main.holder_category("全国社保基金一一三组合", "全国社保基金") == "social_security"
    assert main.holder_category("某投资-某私募证券投资基金", "其它") == "private_fund"
    assert main.holder_category("香港中央结算有限公司", "其它") is None


def test_latest_filing_skips_summaries_and_builds_the_pdf_url():
    records = [
        {"公告标题": "2025年年度报告摘要", "公告时间": "2026-03-28", "公告链接": "x?announcementId=1"},
        {"公告标题": "2025年年度报告", "公告时间": "2026-03-28", "公告链接": "x?announcementId=2"},
        {"公告标题": "2024年年度报告", "公告时间": "2025-03-20", "公告链接": "x?announcementId=3"},
    ]
    filing = main.latest_filing(records, r"\d{4}年年度报告", r"摘要")

    assert filing["title"] == "2025年年度报告"
    assert filing["pdf_url"] == "http://static.cninfo.com.cn/finalpage/2026-03-28/2.PDF"


def test_company_cache_keeps_only_the_most_recent_companies(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(main, "COMPANY_CACHE_LIMIT", 2)
    import time as _time

    for index, code in enumerate(["600519", "300408", "000010"]):
        for key in (f"profile_{code}", f"filings_{code}", f"em_sdltgd_{code}_20260331"):
            path = tmp_path / f"{key}.json"
            path.write_text("{}", encoding="utf-8")
            _time.sleep(0.01)

    evicted = main.prune_company_cache()

    assert evicted == ["600519"]
    remaining = set(main.cached_company_codes())
    assert remaining == {"300408", "000010"}
    assert not (tmp_path / "profile_600519.json").exists()


def test_company_cache_ignores_shared_market_files(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "CACHE_DIR", tmp_path)
    for key in ("stock_master", "margin_SSE_20260821", "sector_boards_industry", "market_headlines"):
        (tmp_path / f"{key}.json").write_text("{}", encoding="utf-8")

    assert main.cached_company_codes() == {}


def test_margin_cache_is_capped_per_exchange(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(main, "MARGIN_CACHE_DAYS", 3)
    for day in range(20260801, 20260806):
        for exchange in ("SSE", "SZSE"):
            (tmp_path / f"margin_{exchange}_{day}.json").write_text("[]", encoding="utf-8")

    assert main.prune_margin_cache() == 4
    kept = sorted(path.stem for path in tmp_path.glob("margin_SSE_*.json"))
    assert kept == ["margin_SSE_20260803", "margin_SSE_20260804", "margin_SSE_20260805"]


def test_rate_limit_allows_then_blocks(monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT_PER_MINUTE", 3)
    monkeypatch.setattr(main, "RATE_LIMIT_HITS", {})

    assert [main.rate_limit_exceeded("1.2.3.4") for _ in range(4)] == [False, False, False, True]
    assert main.rate_limit_exceeded("5.6.7.8") is False


def test_rate_limit_can_be_disabled(monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT_PER_MINUTE", 0)
    monkeypatch.setattr(main, "RATE_LIMIT_HITS", {})

    assert all(main.rate_limit_exceeded("1.2.3.4") is False for _ in range(50))

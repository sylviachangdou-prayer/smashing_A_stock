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

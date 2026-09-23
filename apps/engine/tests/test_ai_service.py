"""The engine's AI Change Analyst endpoint, POST /v1/ai/analyze.

The promises under test: it is behind the shared secret like every /v1 route;
it refuses anything that is not a tool's comparison result; it answers without
AI when AI is off; it never runs the same analysis twice at once and stops at
its daily ceiling; nothing from the documents reaches the logs; and the
comparison endpoints return exactly the same results whether AI is on or off.
"""

from __future__ import annotations

import json
import logging
import threading

import pytest

from diffnexa_engine.ai.config import AIConfig
from diffnexa_engine.ai.errors import AI_MESSAGES, AIErrorCode
from diffnexa_engine.golden.ai_cases import ScriptedProvider, crafted_result

from .helpers.ai_results import REPO, published_result

pytest.importorskip("fastapi", reason="the service extras are not installed")
from fastapi.testclient import TestClient  # noqa: E402

from diffnexa_engine.service import build_app  # noqa: E402

SECRET = "ai-test-shared-secret"
CONFIG = AIConfig(provider="scripted", model="scripted", base_url=None)
PRIVATE = "Confidential clause about the settlement amount"


def analyze(client, tool="pdf", result=None, headers=None, raw=None):
    body = raw if raw is not None else json.dumps({"tool": tool, "result": result})
    return client.post(
        "/v1/ai/analyze",
        content=body,
        headers={"content-type": "application/json", **(headers or {})},
    )


@pytest.fixture
def echo_client():
    return TestClient(build_app(ai_provider=ScriptedProvider(echo=True), ai_config=CONFIG))


def private_result():
    result = published_result("pdf", "vacancy-number-change")
    result["changes"][0]["evidence"][0]["excerpt"] = f"{PRIVATE}: 627"
    result["changes"][0]["evidence"][1]["excerpt"] = f"{PRIVATE}: 654"
    return result


# ---------------------------------------------------------------- availability


def test_ai_is_reported_unavailable_and_refused_when_not_configured():
    client = TestClient(build_app())
    assert client.get("/healthz").json()["ai"] == {"available": False}
    response = analyze(client, result=published_result("pdf", "vacancy-number-change"))
    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "ai_unavailable",
        "message": AI_MESSAGES[AIErrorCode.UNAVAILABLE],
        "side": None,
    }


def test_ai_is_reported_available_when_a_provider_is_configured(echo_client):
    assert echo_client.get("/healthz").json()["ai"] == {"available": True}


def test_the_health_check_says_nothing_about_the_provider_or_key(monkeypatch):
    monkeypatch.setenv("DIFFNEXA_AI_PROVIDER", "gemini")
    monkeypatch.setenv("DIFFNEXA_AI_API_KEY", "sk-health-secret")
    body = TestClient(build_app()).get("/healthz").text
    assert "sk-health-secret" not in body and "gemini" not in body


# ---------------------------------------------------------------- authentication


def test_the_endpoint_needs_the_shared_secret(monkeypatch):
    monkeypatch.setenv("ENGINE_SHARED_SECRET", SECRET)
    provider = ScriptedProvider(echo=True)
    client = TestClient(build_app(ai_provider=provider, ai_config=CONFIG))
    result = published_result("pdf", "vacancy-number-change")
    assert analyze(client, result=result).status_code == 401
    assert analyze(client, result=result, headers={"Authorization": "Bearer wrong"}).status_code == 403
    assert provider.requests == []
    ok = analyze(client, result=result, headers={"Authorization": f"Bearer {SECRET}"})
    assert ok.status_code == 200 and SECRET not in ok.text


# ---------------------------------------------------------------- what is accepted


def test_a_comparison_result_is_explained(echo_client):
    response = analyze(echo_client, result=published_result("pdf", "vacancy-number-change"))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete" and body["tool"] == "pdf"
    assert [item["changeId"] for item in body["changes"]] == ["c0"]
    assert body["provider"] == {"name": "scripted", "model": "scripted"}


@pytest.mark.parametrize(
    "raw, status, code",
    [
        ("", 400, "ai_bad_request"),
        ("not json", 400, "ai_bad_request"),
        ('["a", "list"]', 400, "ai_bad_request"),
        ('{"tool": "pdf"}', 400, "ai_bad_request"),
        (
            '{"tool": "pdf", "result": {"changes": [{"id": "c0", "kind": "modified", "evidence": []}]}}',
            400,
            "ai_bad_request",
        ),
        ('{"tool": "chat", "result": {"changes": []}}', 400, "ai_unsupported"),
        ('{"tool": "pdf", "result": {"changes": "' + "x" * 100 + '"}}', 400, "ai_bad_request"),
    ],
)
def test_anything_but_a_comparison_result_is_refused(echo_client, raw, status, code):
    response = analyze(echo_client, raw=raw)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_an_oversized_payload_is_refused_before_it_is_read(echo_client):
    response = analyze(
        echo_client,
        raw='{"tool": "web", "result": {"changes": [], "pad": "' + "x" * (4 * 1024 * 1024) + '"}}',
    )
    assert response.status_code == 413 and response.json()["error"]["code"] == "ai_too_large"


def test_a_result_with_an_invented_change_id_in_the_reply_is_refused():
    reply = json.dumps(
        {
            "summary": [],
            "changes": [
                {
                    "change_id": "c77",
                    "significance": "important",
                    "explanation": "x",
                    "why_it_may_matter": "y",
                    "evidence_refs": ["c77.e1"],
                }
            ],
        }
    )
    client = TestClient(build_app(ai_provider=ScriptedProvider([reply]), ai_config=CONFIG))
    response = analyze(client, result=published_result("pdf", "vacancy-number-change"))
    assert response.status_code == 502
    assert response.json()["error"] == {
        "code": "ai_invalid",
        "message": "AI analysis could not be validated against the comparison evidence.",
        "side": None,
    }


@pytest.mark.parametrize(
    "error, status, code",
    [("timeout", 504, "ai_timeout"), ("failure", 502, "ai_failed"), ("truncated", 502, "ai_failed")],
)
def test_provider_problems_are_safe_errors(error, status, code):
    client = TestClient(build_app(ai_provider=ScriptedProvider(error=error), ai_config=CONFIG))
    response = analyze(client, result=published_result("pdf", "vacancy-number-change"))
    assert response.status_code == status and response.json()["error"]["code"] == code
    assert "Traceback" not in response.text


def test_an_empty_comparison_is_answered_without_the_model():
    provider = ScriptedProvider(error="failure")
    client = TestClient(build_app(ai_provider=provider, ai_config=CONFIG))
    response = analyze(client, result=published_result("pdf", "identical-notice"))
    assert response.status_code == 200 and response.json()["status"] == "nothing_to_explain"
    assert provider.requests == []


# ---------------------------------------------------------------- repeated requests and cost


def test_the_same_analysis_cannot_run_twice_at_once():
    started, release = threading.Event(), threading.Event()

    class Slow(ScriptedProvider):
        def analyze(self, request):
            started.set()
            release.wait(10)
            return super().analyze(request)

    client = TestClient(build_app(ai_provider=Slow(echo=True), ai_config=CONFIG))
    result = published_result("pdf", "vacancy-number-change")
    first: dict = {}
    worker = threading.Thread(target=lambda: first.setdefault("response", analyze(client, result=result)))
    worker.start()
    assert started.wait(10)
    second = analyze(client, result=result)
    release.set()
    worker.join(10)
    assert second.status_code == 409 and second.json()["error"]["code"] == "ai_busy"
    assert first["response"].status_code == 200
    # Once finished, the same analysis may be asked for again.
    assert analyze(client, result=result).status_code == 200


def test_the_daily_ceiling_stops_further_analyses():
    config = AIConfig(provider="scripted", model="scripted", base_url=None, daily_limit=2)
    provider = ScriptedProvider(echo=True)
    client = TestClient(build_app(ai_provider=provider, ai_config=config))
    for pair in ("vacancy-number-change", "deadline-date-change"):
        assert analyze(client, result=published_result("pdf", pair)).status_code == 200
    refused = analyze(client, result=published_result("pdf", "text-added"))
    assert refused.status_code == 429 and refused.json()["error"]["code"] == "ai_limit_reached"
    assert len(provider.requests) == 2
    # A comparison with nothing to explain costs nothing, so it is still answered.
    assert analyze(client, result=published_result("pdf", "identical-notice")).status_code == 200


# ---------------------------------------------------------------- privacy


def test_nothing_from_the_documents_or_the_reply_reaches_the_logs(caplog, capsys):
    caplog.set_level(logging.DEBUG)
    client = TestClient(build_app(ai_provider=ScriptedProvider(echo=True), ai_config=CONFIG))
    response = analyze(client, result=private_result())
    assert response.status_code == 200
    logged = caplog.text + "".join(capsys.readouterr())
    assert PRIVATE not in logged and "627" not in logged and "The comparison reports" not in logged
    assert "ai analysis tool=pdf" in caplog.text  # counts and timings only


def test_errors_and_their_logs_quote_nothing_from_the_documents(caplog, capsys):
    caplog.set_level(logging.DEBUG)
    for provider in (ScriptedProvider(error="failure"), ScriptedProvider(["not json at all"])):
        client = TestClient(build_app(ai_provider=provider, ai_config=CONFIG))
        response = analyze(client, result=private_result())
        assert PRIVATE not in response.text
    assert PRIVATE not in caplog.text + "".join(capsys.readouterr())


def test_prompt_injection_in_document_text_stays_data():
    provider = ScriptedProvider(echo=True)
    client = TestClient(build_app(ai_provider=provider, ai_config=CONFIG))
    response = analyze(client, tool="web", result=crafted_result("prompt-injection"))
    assert response.status_code == 200
    request = provider.requests[0]
    assert "Ignore all previous instructions" not in request.system
    assert "Ignore all previous instructions" in request.user.split("<untrusted_data")[1]
    body = response.json()
    assert {item["changeId"] for item in body["changes"]} == {"c0", "c1"}
    assert "c99" not in json.dumps(body["summary"]) and "c99" not in [i["changeId"] for i in body["changes"]]


# ---------------------------------------------------------------- determinism


def _compare_files(client, path, fields):
    response = client.post(path, files=fields)
    assert response.status_code == 200, response.text
    body = response.json()
    body.pop("processingMs", None)
    return body


@pytest.mark.parametrize(
    "path, fields",
    [
        (
            "/v1/docx/compare",
            lambda: {
                "original": ("a.docx", (REPO / "golden/docx-pairs/mixed-revision/before.docx").read_bytes()),
                "revised": ("b.docx", (REPO / "golden/docx-pairs/mixed-revision/after.docx").read_bytes()),
            },
        ),
        (
            "/v1/excel/compare",
            lambda: {
                "original": (
                    "a.xlsx",
                    (REPO / "golden/excel-pairs/multiple-changes/before.xlsx").read_bytes(),
                ),
                "revised": ("b.xlsx", (REPO / "golden/excel-pairs/multiple-changes/after.xlsx").read_bytes()),
            },
        ),
    ],
)
def test_comparison_results_are_identical_with_ai_off_on_failing_or_just_used(path, fields):
    off = TestClient(build_app())
    on = TestClient(build_app(ai_provider=ScriptedProvider(echo=True), ai_config=CONFIG))
    failing = TestClient(build_app(ai_provider=ScriptedProvider(error="failure"), ai_config=CONFIG))
    baseline = _compare_files(off, path, fields())
    assert _compare_files(on, path, fields()) == baseline
    assert _compare_files(failing, path, fields()) == baseline
    tool = "docx" if "docx" in path else "excel"
    analyze(on, tool=tool, result=baseline)
    analyze(failing, tool=tool, result=baseline)
    assert _compare_files(on, path, fields()) == baseline


def test_pdf_comparison_is_identical_with_ai_on_or_off(synthetic_dir):
    pair = synthetic_dir / "multiple-changes"
    fields = {
        "previous": ("a.pdf", (pair / "old.pdf").read_bytes(), "application/pdf"),
        "revised": ("b.pdf", (pair / "new.pdf").read_bytes(), "application/pdf"),
    }
    off = _compare_files(TestClient(build_app()), "/v1/compare", fields)
    on_client = TestClient(build_app(ai_provider=ScriptedProvider(echo=True), ai_config=CONFIG))
    assert _compare_files(on_client, "/v1/compare", fields) == off
    assert analyze(on_client, result=off).status_code == 200
    assert _compare_files(on_client, "/v1/compare", fields) == off

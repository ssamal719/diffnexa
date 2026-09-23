"""AI providers and their configuration.

No test reaches a real AI service or uses a real key. Requests are captured by
a fake transport, and the real transport is exercised against a local server.
The promises: requests have the documented shape and carry the key only in a
header; every way a provider can fail becomes a short failure code; the key
never appears in an error, a representation or a log; AI is off unless it is
fully and safely configured.
"""

from __future__ import annotations

import http.server
import json
import socket
import threading

import pytest

from diffnexa_engine.ai.config import AIConfig
from diffnexa_engine.ai.providers import (
    GeminiProvider,
    OpenAICompatibleProvider,
    ProviderError,
    ProviderRequest,
    https_post,
    provider_from_config,
)

KEY = "sk-test-key-that-must-never-appear-anywhere"
REQUEST = ProviderRequest(system="SYSTEM TEXT", user="USER TEXT", max_output_tokens=1024, timeout_seconds=5)


class Transport:
    def __init__(self, status=200, body=None, raw=None, error=None):
        self.status, self.body, self.raw, self.error = status, body, raw, error
        self.calls = []

    def __call__(self, url, headers, body, timeout):
        self.calls.append({"url": url, "headers": headers, "body": json.loads(body), "timeout": timeout})
        if self.error:
            raise self.error
        raw = self.raw if self.raw is not None else json.dumps(self.body).encode()
        return self.status, raw


def gemini_body(text='{"summary": [], "changes": []}', finish="STOP", **extra):
    body = {
        "candidates": [{"content": {"parts": [{"text": text}], "role": "model"}, "finishReason": finish}],
        "usageMetadata": {"promptTokenCount": 120, "candidatesTokenCount": 30, "thoughtsTokenCount": 5},
    }
    body.update(extra)
    return body


def openai_body(text='{"summary": [], "changes": []}', finish="stop", **message):
    return {
        "choices": [{"message": {"role": "assistant", "content": text, **message}, "finish_reason": finish}],
        "usage": {"prompt_tokens": 110, "completion_tokens": 25},
    }


# ---------------------------------------------------------------- Gemini


def test_gemini_request_has_the_documented_shape_and_the_key_only_in_a_header():
    transport = Transport(body=gemini_body())
    GeminiProvider("gemini-3.5-flash-lite", KEY, transport).analyze(REQUEST)
    call = transport.calls[0]
    assert call["url"] == (
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
    )
    assert call["headers"]["x-goog-api-key"] == KEY
    assert KEY not in json.dumps(call["body"]) and KEY not in call["url"]
    assert call["body"]["systemInstruction"] == {"parts": [{"text": "SYSTEM TEXT"}]}
    assert call["body"]["contents"] == [{"role": "user", "parts": [{"text": "USER TEXT"}]}]
    assert call["body"]["generationConfig"]["responseMimeType"] == "application/json"
    assert call["body"]["generationConfig"]["maxOutputTokens"] == 1024
    assert call["timeout"] == 5


def test_gemini_reply_text_and_token_counts_are_read():
    reply = GeminiProvider("m", KEY, Transport(body=gemini_body('{"a": 1}'))).analyze(REQUEST)
    assert reply.text == '{"a": 1}' and reply.input_tokens == 120 and reply.output_tokens == 35


def test_gemini_skips_thought_parts():
    body = gemini_body()
    body["candidates"][0]["content"]["parts"] = [
        {"text": "thinking...", "thought": True},
        {"text": '{"ok": true}'},
    ]
    assert GeminiProvider("m", KEY, Transport(body=body)).analyze(REQUEST).text == '{"ok": true}'


@pytest.mark.parametrize(
    "transport, kind",
    [
        (Transport(body=gemini_body(finish="MAX_TOKENS")), "truncated"),
        (Transport(body=gemini_body(finish="SAFETY")), "refused"),
        (Transport(body=gemini_body(finish="RECITATION")), "refused"),
        (Transport(body={"promptFeedback": {"blockReason": "SAFETY"}}), "refused"),
        (Transport(body={"candidates": []}), "failure"),
        (Transport(body=gemini_body(text="   ")), "failure"),
        (Transport(status=429, body={"error": {"message": "quota"}}), "failure"),
        (Transport(status=401, body={}), "failure"),
        (Transport(status=500, body={}), "failure"),
        (Transport(status=302, raw=b""), "failure"),
        (Transport(raw=b"<html>gateway error</html>"), "failure"),
        (Transport(raw=b"x" * (2 * 1024 * 1024 + 10)), "failure"),
        (Transport(error=ProviderError("timeout", "no reply in time")), "timeout"),
    ],
)
def test_gemini_failures_become_short_codes(transport, kind):
    with pytest.raises(ProviderError) as caught:
        GeminiProvider("m", KEY, transport).analyze(REQUEST)
    assert caught.value.kind == kind
    assert KEY not in str(caught.value)


def test_gemini_model_names_cannot_change_the_address():
    for name in ("../../other", "m?key=x", "m:streamGenerateContent", ""):
        with pytest.raises(ValueError):
            GeminiProvider(name, KEY, Transport())


# ---------------------------------------------------------------- OpenAI-compatible


def test_openai_compatible_request_has_the_documented_shape():
    transport = Transport(body=openai_body())
    OpenAICompatibleProvider("gpt-test", KEY, "https://api.example.com/v1/", transport).analyze(REQUEST)
    call = transport.calls[0]
    assert call["url"] == "https://api.example.com/v1/chat/completions"
    assert call["headers"]["Authorization"] == f"Bearer {KEY}"
    assert call["body"]["model"] == "gpt-test"
    assert call["body"]["messages"] == [
        {"role": "system", "content": "SYSTEM TEXT"},
        {"role": "user", "content": "USER TEXT"},
    ]
    assert call["body"]["response_format"] == {"type": "json_object"}
    assert KEY not in json.dumps(call["body"])


@pytest.mark.parametrize(
    "transport, kind",
    [
        (Transport(body=openai_body(finish="length")), "truncated"),
        (Transport(body=openai_body(finish="content_filter")), "refused"),
        (Transport(body=openai_body(text=None, refusal="I can't help with that.")), "refused"),
        (Transport(body={"choices": []}), "failure"),
        (Transport(status=503, body={}), "failure"),
    ],
)
def test_openai_compatible_failures_become_short_codes(transport, kind):
    with pytest.raises(ProviderError) as caught:
        OpenAICompatibleProvider("m", KEY, "https://api.example.com/v1", transport).analyze(REQUEST)
    assert caught.value.kind == kind


def test_openai_compatible_reply_and_usage_are_read():
    reply = OpenAICompatibleProvider(
        "m", KEY, "https://x.example/v1", Transport(body=openai_body('{"b": 2}'))
    ).analyze(REQUEST)
    assert reply.text == '{"b": 2}' and reply.input_tokens == 110 and reply.output_tokens == 25


def test_providers_never_show_the_key():
    for provider in (GeminiProvider("m", KEY), OpenAICompatibleProvider("m", KEY, "https://x.example/v1")):
        assert KEY not in repr(provider) and KEY not in str(provider)


# ---------------------------------------------------------------- the real transport, against a local server


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("content-length", 0))
        self.rfile.read(length)
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://127.0.0.1:9/steal-the-key")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(openai_body('{"from": "local"}')).encode())

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def local_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def test_the_real_transport_posts_and_reads(local_server):
    status, raw = https_post(
        f"{local_server}/chat/completions", {"Content-Type": "application/json"}, b"{}", 5
    )
    assert status == 200 and json.loads(raw)["choices"][0]["message"]["content"] == '{"from": "local"}'


def test_the_real_transport_never_follows_a_redirect(local_server):
    status, _raw = https_post(f"{local_server}/redirect", {"Authorization": f"Bearer {KEY}"}, b"{}", 5)
    assert status == 302
    provider = OpenAICompatibleProvider("m", KEY, f"{local_server}/redirect-base", https_post)
    provider._url = f"{local_server}/redirect"
    with pytest.raises(ProviderError) as caught:
        provider.analyze(REQUEST)
    assert caught.value.kind == "failure"


def test_the_real_transport_times_out():
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)  # accepts the connection but never answers
    try:
        with pytest.raises(ProviderError) as caught:
            https_post(f"http://127.0.0.1:{listener.getsockname()[1]}/", {}, b"{}", 0.5)
        assert caught.value.kind == "timeout"
    finally:
        listener.close()


def test_the_real_transport_reports_a_refused_connection():
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    with pytest.raises(ProviderError) as caught:
        https_post(f"http://127.0.0.1:{port}/", {}, b"{}", 2)
    assert caught.value.kind == "failure"


# ---------------------------------------------------------------- configuration


def test_ai_is_off_unless_configured():
    config = AIConfig.from_env()
    assert not config.available and config.problem == "DIFFNEXA_AI_PROVIDER is not set"
    assert provider_from_config(config) is None


@pytest.mark.parametrize(
    "env, problem",
    [
        ({"DIFFNEXA_AI_PROVIDER": "chatgpt-plugin", "DIFFNEXA_AI_API_KEY": KEY}, "must be one of"),
        ({"DIFFNEXA_AI_PROVIDER": "gemini"}, "DIFFNEXA_AI_API_KEY is not set"),
        ({"DIFFNEXA_AI_PROVIDER": "openai_compatible", "DIFFNEXA_AI_API_KEY": KEY}, "MODEL is required"),
        (
            {
                "DIFFNEXA_AI_PROVIDER": "openai_compatible",
                "DIFFNEXA_AI_API_KEY": KEY,
                "DIFFNEXA_AI_MODEL": "m",
            },
            "BASE_URL is required",
        ),
        (
            {
                "DIFFNEXA_AI_PROVIDER": "openai_compatible",
                "DIFFNEXA_AI_API_KEY": KEY,
                "DIFFNEXA_AI_MODEL": "m",
                "DIFFNEXA_AI_BASE_URL": "http://api.example.com/v1",
            },
            "must use https",
        ),
    ],
)
def test_incomplete_or_unsafe_configuration_keeps_ai_off(monkeypatch, env, problem):
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    config = AIConfig.from_env()
    assert not config.available and problem in config.problem
    assert KEY not in config.problem and config.api_key is None
    assert provider_from_config(config) is None


def test_gemini_is_configured_with_a_low_cost_default_model(monkeypatch):
    monkeypatch.setenv("DIFFNEXA_AI_PROVIDER", "gemini")
    monkeypatch.setenv("DIFFNEXA_AI_API_KEY", KEY)
    config = AIConfig.from_env()
    assert config.available and config.model == "gemini-3.5-flash-lite"
    assert KEY not in repr(config)
    provider = provider_from_config(config)
    assert isinstance(provider, GeminiProvider) and provider.model == "gemini-3.5-flash-lite"


def test_openai_compatible_is_configured_with_its_address(monkeypatch):
    monkeypatch.setenv("DIFFNEXA_AI_PROVIDER", "openai_compatible")
    monkeypatch.setenv("DIFFNEXA_AI_API_KEY", KEY)
    monkeypatch.setenv("DIFFNEXA_AI_MODEL", "gpt-test")
    monkeypatch.setenv("DIFFNEXA_AI_BASE_URL", "https://api.example.com/v1/")
    provider = provider_from_config(AIConfig.from_env())
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider._url == "https://api.example.com/v1/chat/completions"


def test_limits_are_configurable_and_clamped(monkeypatch):
    monkeypatch.setenv("DIFFNEXA_AI_MAX_CHANGES", "40")
    monkeypatch.setenv("DIFFNEXA_AI_BATCH_SIZE", "15")
    monkeypatch.setenv("DIFFNEXA_AI_TIMEOUT_SECONDS", "9999")
    monkeypatch.setenv("DIFFNEXA_AI_DAILY_LIMIT", "not a number")
    config = AIConfig.from_env()
    assert (config.max_changes, config.batch_size, config.max_batches) == (40, 15, 3)
    assert config.timeout_seconds == 120 and config.daily_limit == 200

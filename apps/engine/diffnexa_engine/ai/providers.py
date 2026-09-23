"""AI providers behind one small interface.

The analyst builds one provider-independent prompt from deterministic facts and
hands it to whichever provider is configured. A provider only transports it:
it sends the instructions and the facts, and returns the model's text. It never
sees a document, and nothing it returns is shown before the validator has
checked it against the facts.

Two providers ship:

* ``gemini`` — Google's Gemini API (generateContent), JSON output mode.
* ``openai_compatible`` — any service that implements the OpenAI Chat
  Completions API (OpenAI itself, and the many compatible services), JSON mode.

Both use the standard library only. Requests go over HTTPS with certificate
checks, redirects are refused (so a key is never replayed to another host),
replies are read up to a fixed size, and nothing — request, reply, key — is
logged. Errors carry a short reason code, never the reply text or the key.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from diffnexa_engine.ai.config import AIConfig

MAX_REPLY_BYTES = 2 * 1024 * 1024

ProviderFailure = Literal["timeout", "failure", "truncated", "refused"]


@dataclass(frozen=True)
class ProviderRequest:
    system: str
    user: str
    max_output_tokens: int
    timeout_seconds: float


@dataclass(frozen=True)
class ProviderReply:
    text: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class ProviderError(Exception):
    """A provider call that produced nothing usable. `detail` is a short code."""

    def __init__(self, kind: ProviderFailure, detail: str) -> None:
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


class AIAnalysisProvider(Protocol):
    """What the analyst needs from any provider."""

    name: str
    model: str

    def analyze(self, request: ProviderRequest) -> ProviderReply: ...


#: (url, headers, body, timeout) -> (status, body). Replaced in tests; never logs.
Transport = Callable[[str, dict[str, str], bytes, float], tuple[int, bytes]]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        return None  # a redirect is treated as a failed call, never followed


_OPENER = urllib.request.build_opener(_NoRedirect)


def https_post(url: str, headers: dict[str, str], body: bytes, timeout: float) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            return response.status, response.read(MAX_REPLY_BYTES + 1)
    except urllib.error.HTTPError as error:
        return error.code, error.read(MAX_REPLY_BYTES + 1) if error.fp else b""
    except TimeoutError:
        raise ProviderError("timeout", "no reply in time") from None
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise ProviderError("timeout", "no reply in time") from None
        raise ProviderError("failure", "connection failed") from None
    except OSError:
        raise ProviderError("failure", "connection failed") from None


def _json_reply(status: int, raw: bytes) -> dict[str, Any]:
    if status == 429:
        raise ProviderError("failure", "provider rate limit")
    if status in (401, 403):
        raise ProviderError("failure", "provider rejected the key")
    if not 200 <= status < 300:
        # Includes redirects, which are never followed.
        raise ProviderError("failure", f"provider status {status}")
    if len(raw) > MAX_REPLY_BYTES:
        raise ProviderError("failure", "reply too large")
    try:
        data = json.loads(raw)
    except ValueError:
        raise ProviderError("failure", "reply is not JSON") from None
    if not isinstance(data, dict):
        raise ProviderError("failure", "reply is not an object")
    return data


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


class GeminiProvider:
    name = "gemini"
    endpoint = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def __init__(self, model: str, api_key: str, transport: Transport = https_post) -> None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", model):
            raise ValueError("model name is not valid")
        self.model = model
        self._key = api_key
        self._transport = transport

    def __repr__(self) -> str:
        return f"GeminiProvider(model={self.model!r})"

    def analyze(self, request: ProviderRequest) -> ProviderReply:
        body = {
            "systemInstruction": {"parts": [{"text": request.system}]},
            "contents": [{"role": "user", "parts": [{"text": request.user}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.1,
                "maxOutputTokens": request.max_output_tokens,
            },
        }
        status, raw = self._transport(
            self.endpoint.format(model=self.model),
            {"Content-Type": "application/json", "x-goog-api-key": self._key},
            json.dumps(body).encode("utf-8"),
            request.timeout_seconds,
        )
        data = _json_reply(status, raw)
        if (data.get("promptFeedback") or {}).get("blockReason"):
            raise ProviderError("refused", "request blocked by the provider")
        candidates = data.get("candidates")
        if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], dict):
            raise ProviderError("failure", "no candidate")
        candidate = candidates[0]
        reason = candidate.get("finishReason")
        if reason == "MAX_TOKENS":
            raise ProviderError("truncated", "output limit reached")
        if reason not in (None, "STOP", "FINISH_REASON_UNSPECIFIED"):
            raise ProviderError("refused", "reply withheld by the provider")
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(
            part["text"]
            for part in parts
            if isinstance(part, dict) and isinstance(part.get("text"), str) and not part.get("thought")
        )
        if not text.strip():
            raise ProviderError("failure", "empty reply")
        usage = data.get("usageMetadata") or {}
        output = _count(usage.get("candidatesTokenCount"))
        thoughts = _count(usage.get("thoughtsTokenCount"))
        if output is not None and thoughts is not None:
            output += thoughts
        return ProviderReply(
            text=text, input_tokens=_count(usage.get("promptTokenCount")), output_tokens=output
        )


class OpenAICompatibleProvider:
    name = "openai_compatible"

    def __init__(self, model: str, api_key: str, base_url: str, transport: Transport = https_post) -> None:
        self.model = model
        self._key = api_key
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self._transport = transport

    def __repr__(self) -> str:
        return f"OpenAICompatibleProvider(model={self.model!r})"

    def analyze(self, request: ProviderRequest) -> ProviderReply:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
            "temperature": 0.1,
            "max_tokens": request.max_output_tokens,
            "response_format": {"type": "json_object"},
        }
        status, raw = self._transport(
            self._url,
            {"Content-Type": "application/json", "Authorization": f"Bearer {self._key}"},
            json.dumps(body).encode("utf-8"),
            request.timeout_seconds,
        )
        data = _json_reply(status, raw)
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise ProviderError("failure", "no choice")
        choice = choices[0]
        reason = choice.get("finish_reason")
        if reason == "length":
            raise ProviderError("truncated", "output limit reached")
        if reason == "content_filter":
            raise ProviderError("refused", "reply withheld by the provider")
        message = choice.get("message") or {}
        if message.get("refusal"):
            raise ProviderError("refused", "the model refused")
        text = message.get("content")
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("failure", "empty reply")
        usage = data.get("usage") or {}
        return ProviderReply(
            text=text,
            input_tokens=_count(usage.get("prompt_tokens")),
            output_tokens=_count(usage.get("completion_tokens")),
        )


def provider_from_config(config: AIConfig, transport: Transport = https_post) -> AIAnalysisProvider | None:
    """The configured provider, or None when AI is off."""
    if not config.available or config.api_key is None or config.model is None:
        return None
    if config.provider == "gemini":
        return GeminiProvider(config.model, config.api_key, transport)
    if config.provider == "openai_compatible" and config.base_url:
        return OpenAICompatibleProvider(config.model, config.api_key, config.base_url, transport)
    return None


__all__ = [
    "AIAnalysisProvider",
    "GeminiProvider",
    "OpenAICompatibleProvider",
    "ProviderError",
    "ProviderReply",
    "ProviderRequest",
    "Transport",
    "https_post",
    "provider_from_config",
]

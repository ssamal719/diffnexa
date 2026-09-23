"""User-facing errors for AI Change Analyst.

Every one of these is an enhancement failure, never a comparison failure: the
deterministic comparison the person already has is complete and unaffected, and
the wording says so where it could be in doubt.

`detail` strings stay in the server and never contain document content.

Codes and messages must match the `ai_messages` section of
packages/contracts/errors.json exactly; a test enforces it.
"""

from __future__ import annotations

from enum import StrEnum


class AIErrorCode(StrEnum):
    UNAVAILABLE = "ai_unavailable"
    BAD_REQUEST = "ai_bad_request"
    UNVERIFIED = "ai_unverified"
    UNSUPPORTED = "ai_unsupported"
    TOO_LARGE = "ai_too_large"
    TIMEOUT = "ai_timeout"
    FAILED = "ai_failed"
    INVALID = "ai_invalid"
    BUSY = "ai_busy"
    LIMIT_REACHED = "ai_limit_reached"


AI_MESSAGES: dict[AIErrorCode, str] = {
    AIErrorCode.UNAVAILABLE: (
        "AI analysis isn't available right now. Your comparison is complete and is not affected."
    ),
    AIErrorCode.BAD_REQUEST: (
        "This comparison couldn't be sent for AI analysis. Run the comparison again, then try once more."
    ),
    AIErrorCode.UNVERIFIED: (
        "This comparison couldn't be confirmed as DiffNexa's own result, so it was not sent for AI "
        "analysis. Run the comparison again, then try once more."
    ),
    AIErrorCode.UNSUPPORTED: "AI analysis isn't available for this kind of comparison.",
    AIErrorCode.TOO_LARGE: (
        "This comparison is too large to send for AI analysis. Every change is still listed in the "
        "comparison."
    ),
    AIErrorCode.TIMEOUT: (
        "The AI analysis took too long. Your comparison is not affected. Try again in a moment."
    ),
    AIErrorCode.FAILED: (
        "The AI service didn't respond properly. Your comparison is not affected. Try again in a moment."
    ),
    AIErrorCode.INVALID: "AI analysis could not be validated against the comparison evidence.",
    AIErrorCode.BUSY: "An AI analysis of this comparison is already running.",
    AIErrorCode.LIMIT_REACHED: (
        "AI analysis has reached its limit for today. Your comparison is complete and is not affected."
    ),
}

AI_STATUS: dict[AIErrorCode, int] = {
    AIErrorCode.UNAVAILABLE: 503,
    AIErrorCode.BAD_REQUEST: 400,
    AIErrorCode.UNVERIFIED: 400,
    AIErrorCode.UNSUPPORTED: 400,
    AIErrorCode.TOO_LARGE: 413,
    AIErrorCode.TIMEOUT: 504,
    AIErrorCode.FAILED: 502,
    AIErrorCode.INVALID: 502,
    AIErrorCode.BUSY: 409,
    AIErrorCode.LIMIT_REACHED: 429,
}


class AIAnalysisError(Exception):
    """Why an analysis produced nothing to show. `detail` never holds document text."""

    def __init__(self, code: AIErrorCode, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail

    @property
    def user_message(self) -> str:
        return AI_MESSAGES[self.code]

    @property
    def status(self) -> int:
        return AI_STATUS[self.code]


__all__ = ["AI_MESSAGES", "AI_STATUS", "AIAnalysisError", "AIErrorCode"]

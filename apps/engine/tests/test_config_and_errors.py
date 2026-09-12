import json

import pytest

from diffnexa_engine.config import DEFAULT_MAX_FILE_MB, DEFAULT_MAX_PAGES, EngineLimits
from diffnexa_engine.errors import USER_MESSAGES, DocumentError, ErrorCode


def test_limits_default(monkeypatch):
    monkeypatch.delenv("DIFFNEXA_MAX_FILE_MB", raising=False)
    monkeypatch.delenv("DIFFNEXA_MAX_PAGES", raising=False)
    limits = EngineLimits.from_env()
    assert limits.max_file_bytes == DEFAULT_MAX_FILE_MB * 1024 * 1024
    assert limits.max_pages == DEFAULT_MAX_PAGES


def test_limits_from_env(monkeypatch):
    monkeypatch.setenv("DIFFNEXA_MAX_FILE_MB", "5")
    monkeypatch.setenv("DIFFNEXA_MAX_PAGES", "12")
    assert EngineLimits.from_env() == EngineLimits(max_file_bytes=5 * 1024 * 1024, max_pages=12)


@pytest.mark.parametrize("value", ["abc", "0", "-3", "2.5"])
def test_limits_reject_bad_values(monkeypatch, value):
    monkeypatch.setenv("DIFFNEXA_MAX_PAGES", value)
    with pytest.raises(ValueError):
        EngineLimits.from_env()


def test_every_code_has_a_message():
    assert set(USER_MESSAGES) == set(ErrorCode)


def test_messages_match_shared_contract(repo_root):
    """Engine wording must match packages/contracts/errors.json exactly (the website is
    tested against the same file)."""
    contract = json.loads((repo_root / "packages/contracts/errors.json").read_text())["messages"]
    assert contract == {code.value: msg for code, msg in USER_MESSAGES.items()}


def test_document_error_keeps_detail_internal():
    err = DocumentError(ErrorCode.CORRUPTED, "qpdf: xref table broken at offset 991")
    assert "qpdf" not in err.user_message
    assert err.user_message == USER_MESSAGES[ErrorCode.CORRUPTED]

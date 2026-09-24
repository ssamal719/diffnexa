"""DOCX Compare's matching options: what counts as "the same words".

Each option must change what the engine reports — deterministically — and
nothing else: evidence still quotes the documents' own words, and the defaults
give exactly the result DOCX Compare has always given.
"""

from __future__ import annotations

import pytest

from diffnexa_engine.compare.normalize import MatchOptions, matching, normalize_key
from diffnexa_engine.docx.api import serialize_docx_comparison
from diffnexa_engine.docx.compare import compare_docx
from diffnexa_engine.docx.extract import extract_docx
from tests.helpers.docx_files import table, word

CASE_SENSITIVE = MatchOptions(ignore_case=False)
NO_PUNCTUATION = MatchOptions(ignore_punctuation=True)


def _doc(*paragraphs: str, rows: list[tuple[str, ...]] | None = None, title: str | None = None):
    def build(document):
        if title:
            document.core_properties.title = title
        for text in paragraphs:
            document.add_paragraph(text)
        if rows:
            table(document, rows)

    return extract_docx(word(build))


def _changes(old, new, options=None):
    return [(change.old_value, change.new_value) for change in compare_docx(old, new, options).result.changes]


# ---------------------------------------------------------------- capitalisation


def test_capitalisation_is_ignored_by_default_as_it_always_has_been():
    assert _changes(_doc("The Deadline is Friday."), _doc("The deadline is Friday.")) == []


def test_capitalisation_changes_are_reported_when_asked_with_the_documents_own_words():
    outcome = compare_docx(_doc("The Deadline is Friday."), _doc("The deadline is Friday."), CASE_SENSITIVE)
    assert [(c.old_value, c.new_value) for c in outcome.result.changes] == [("Deadline", "deadline")]
    quoted = {item.excerpt for item in outcome.result.changes[0].evidence}
    assert any("Deadline" in (text or "") for text in quoted)
    assert any("deadline" in (text or "") for text in quoted)


def test_the_capitalisation_rule_applies_to_table_cells_and_the_title_too():
    old = _doc("Body.", rows=[("Name", "Status"), ("Alpha", "ACTIVE")], title="Supply Agreement")
    new = _doc("Body.", rows=[("Name", "Status"), ("Alpha", "Active")], title="SUPPLY AGREEMENT")
    assert _changes(old, new) == []
    assert sorted(_changes(old, new, CASE_SENSITIVE)) == sorted(
        [("ACTIVE", "Active"), ("Supply Agreement", "SUPPLY AGREEMENT")]
    )


# ---------------------------------------------------------------- punctuation


def test_punctuation_changes_are_reported_by_default():
    assert _changes(_doc("Pay the fee, now."), _doc("Pay the fee now")) == [("fee, now.", "fee now")]


def test_punctuation_only_changes_can_be_ignored():
    assert _changes(_doc("Pay the fee, now."), _doc("Pay the fee now"), NO_PUNCTUATION) == []


def test_ignoring_punctuation_still_reports_the_words_around_it():
    assert _changes(_doc("Pay the fee, now."), _doc("Pay the charge now"), NO_PUNCTUATION) == [
        ("fee,", "charge")
    ]


def test_ignoring_punctuation_never_hides_a_changed_number():
    # "3.5" and "35" are different numbers, and so are "1,000" and "1.000".
    changes = _changes(_doc("Interest is 3.5% a year."), _doc("Interest is 35% a year."), NO_PUNCTUATION)
    assert changes and changes[0][0] == "3.5%"
    assert _changes(_doc("Fee: 1,000 units."), _doc("Fee: 1.000 units."), NO_PUNCTUATION)


def test_a_paragraph_of_only_punctuation_is_ignored_with_the_option():
    old, new = _doc("Terms.", "* * *", "More terms."), _doc("Terms.", "More terms.")
    assert _changes(old, new) == [("* * *", None)]
    assert _changes(old, new, NO_PUNCTUATION) == []


# ---------------------------------------------------------------- scope and the response


def test_options_apply_only_inside_the_comparison_that_asked_for_them():
    with matching(CASE_SENSITIVE):
        assert normalize_key("Deadline") == "Deadline"
    assert normalize_key("Deadline") == "deadline"


def test_the_response_states_the_options_the_engine_used():
    outcome = compare_docx(_doc("a"), _doc("b"), MatchOptions(ignore_case=False, ignore_punctuation=True))
    assert serialize_docx_comparison(outcome, 0)["options"] == {
        "ignoreCase": False,
        "ignorePunctuation": True,
    }
    default = compare_docx(_doc("a"), _doc("b"))
    assert serialize_docx_comparison(default, 0)["options"] == {
        "ignoreCase": True,
        "ignorePunctuation": False,
    }


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from diffnexa_engine.service.app import build_app

    monkeypatch.delenv("ENGINE_SHARED_SECRET", raising=False)
    return TestClient(build_app())


def _files(old: bytes, new: bytes):
    return {"original": ("a.docx", old), "revised": ("b.docx", new)}


def test_the_service_accepts_the_options_and_defaults_without_them(client):
    old = word(lambda d: d.add_paragraph("The Deadline, today."))
    new = word(lambda d: d.add_paragraph("The deadline today"))
    plain = client.post("/v1/docx/compare", files=_files(old, new)).json()
    assert plain["options"] == {"ignoreCase": True, "ignorePunctuation": False}
    assert len(plain["changes"]) == 1  # the comma

    asked = client.post(
        "/v1/docx/compare", files=_files(old, new), data={"ignore_case": "true", "ignore_punctuation": "true"}
    ).json()
    assert asked["changes"] == []

    strict = client.post("/v1/docx/compare", files=_files(old, new), data={"ignore_case": "false"}).json()
    assert strict["options"]["ignoreCase"] is False
    assert [change["oldValue"] for change in strict["changes"]] == ["Deadline, today."]


def test_unrecognised_option_values_keep_the_defaults(client):
    old = word(lambda d: d.add_paragraph("Same"))
    body = client.post(
        "/v1/docx/compare", files=_files(old, old), data={"ignore_case": "maybe", "ignore_punctuation": "yes"}
    ).json()
    assert body["options"] == {"ignoreCase": True, "ignorePunctuation": False}

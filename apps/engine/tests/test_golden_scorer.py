"""The scorer must catch every kind of mistake a comparison engine can make."""

import pytest

from diffnexa_engine.adapters.pdf.extract import extract_file
from diffnexa_engine.contracts import Change, ChangeCategory, ChangeKind, Evidence, Side
from diffnexa_engine.golden.loader import discover_pairs
from diffnexa_engine.golden.scorer import score_comparison
from diffnexa_engine.model import BBox

from .helpers.oracle import find_words, oracle_result


@pytest.fixture(scope="module")
def pairs(synthetic_dir):
    loaded = {p.name: p for p in discover_pairs(synthetic_dir)}
    docs = {n: (extract_file(str(p.old_pdf)), extract_file(str(p.new_pdf))) for n, p in loaded.items()}
    return loaded, docs


def _text_change(doc_old, doc_new, page_old, page_new, text, cid="x1", seq=100, noise=None):
    wo = find_words(doc_old.page(page_old), text)
    wn = find_words(doc_new.page(page_new), text)
    return Change(
        id=cid,
        seq=seq,
        kind=ChangeKind.MODIFIED,
        category=ChangeCategory.TEXT,
        old_value=text,
        new_value=text + " (edited)",
        noise_reason=noise,
        evidence=(
            Evidence(
                side=Side.OLD,
                page=page_old,
                word_ids=tuple(w.id for w in wo),
                bbox=BBox.union([w.bbox for w in wo]),
                excerpt=" ".join(w.text for w in wo),
            ),
            Evidence(
                side=Side.NEW,
                page=page_new,
                word_ids=tuple(w.id for w in wn),
                bbox=BBox.union([w.bbox for w in wn]),
                excerpt=" ".join(w.text for w in wn),
            ),
        ),
    )


def test_oracle_passes_every_synthetic_pair(pairs):
    loaded, docs = pairs
    for name, pair in loaded.items():
        old, new = docs[name]
        score = score_comparison(pair.spec, oracle_result(pair.spec, old, new), old, new)
        assert score.passed, (name, score)
        assert score.recall == 1.0 and score.evidence_completeness == 1.0


def test_missed_change_lowers_recall(pairs):
    loaded, docs = pairs
    pair = loaded["vacancy-number-change"]
    old, new = docs[pair.name]
    empty = oracle_result(pair.spec.model_copy(update={"expected_changes": []}), old, new)
    score = score_comparison(pair.spec, empty, old, new)
    assert score.recall == 0.0 and not score.passed and len(score.missed) == 1


def test_wrong_value_is_not_a_match(pairs):
    loaded, docs = pairs
    pair = loaded["vacancy-number-change"]
    old, new = docs[pair.name]
    wrong_spec = pair.spec.model_copy(deep=True)
    wrong_spec.expected_changes[0].new = "645"
    score = score_comparison(wrong_spec, oracle_result(pair.spec, old, new), old, new)
    assert score.matched == 0 and len(score.false_positives) == 1


def test_extra_change_is_a_false_positive(pairs):
    loaded, docs = pairs
    pair = loaded["deadline-date-change"]
    old, new = docs[pair.name]
    extra = _text_change(old, new, 3, 3, "upload a recent photograph")
    score = score_comparison(pair.spec, oracle_result(pair.spec, old, new, [extra]), old, new)
    assert len(score.false_positives) == 1 and not score.passed


def test_noise_classified_change_is_not_a_false_positive(pairs):
    loaded, docs = pairs
    pair = loaded["deadline-date-change"]
    old, new = docs[pair.name]
    extra = _text_change(old, new, 3, 3, "upload a recent photograph", noise="formatting only")
    score = score_comparison(pair.spec, oracle_result(pair.spec, old, new, [extra]), old, new)
    assert score.passed and score.reported_noise == 1


def test_change_on_unchanged_page_is_noise_leakage(pairs):
    loaded, docs = pairs
    pair = loaded["identical-notice"]
    old, new = docs[pair.name]
    extra = _text_change(old, new, 1, 1, "Post: Junior Assistant")
    score = score_comparison(pair.spec, oracle_result(pair.spec, old, new, [extra]), old, new)
    assert len(score.noise_leakage) == 1 and not score.passed


def test_forbidden_text_is_noise_leakage(pairs):
    loaded, docs = pairs
    pair = loaded["inserted-page"]
    old, new = docs[pair.name]
    footer = _text_change(old, new, 2, 2, "Page 2 of")
    footer = footer.model_copy(update={"old_value": "Page 2 of 3", "new_value": "Page 2 of 4"})
    score = score_comparison(pair.spec, oracle_result(pair.spec, old, new, [footer]), old, new)
    assert any("of 3" in n for n in score.noise_leakage)


def test_untraceable_evidence_fails_the_pair(pairs):
    loaded, docs = pairs
    pair = loaded["vacancy-number-change"]
    old, new = docs[pair.name]
    result = oracle_result(pair.spec, old, new)
    change = result.changes[0]
    bad_ev = change.evidence[0].model_copy(update={"word_ids": ("p2-w999",)})
    broken_change = change.model_copy(update={"evidence": (bad_ev, change.evidence[1])})
    broken = result.model_copy(update={"changes": (broken_change,)})
    score = score_comparison(pair.spec, broken, old, new)
    assert score.evidence_completeness == 0.0 and not score.passed


def test_max_unexpected_changes_allowance(pairs):
    loaded, docs = pairs
    pair = loaded["deadline-date-change"]
    old, new = docs[pair.name]
    relaxed = pair.spec.model_copy(update={"max_unexpected_changes": 1})
    extra = _text_change(old, new, 3, 3, "upload a recent photograph")
    score = score_comparison(relaxed, oracle_result(pair.spec, old, new, [extra]), old, new)
    assert len(score.false_positives) == 1 and score.passed

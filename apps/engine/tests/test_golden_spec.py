from pathlib import Path

import pytest
import yaml

from diffnexa_engine.golden.loader import discover_pairs
from diffnexa_engine.golden.spec import SpecError, load_spec

VALID = {
    "pair": "sample-pair",
    "description": "A sample.",
    "source": "public",
    "expected_changes": [{"category": "number", "old": "627", "new": "654", "old_page": 3}],
}


def _write(tmp_path: Path, data, folder="sample-pair") -> Path:
    d = tmp_path / folder
    d.mkdir(parents=True, exist_ok=True)
    path = d / "expected.yaml"
    path.write_text(yaml.safe_dump(data))
    return path


def test_valid_spec(tmp_path):
    spec = load_spec(_write(tmp_path, VALID))
    assert spec.expected_changes[0].describe() == "number '627' -> '654' (old p3)"
    assert spec.max_unexpected_changes == 0


@pytest.mark.parametrize(
    "mutation",
    [
        {"unknown_field": 1},
        {"source": "somewhere"},
        {"pair": "Bad Name"},
        {"expected_changes": [{"category": "number"}]},
        {"expected_changes": [{"category": "colour", "old": "a"}]},
        {"max_unexpected_changes": -1},
    ],
)
def test_invalid_specs_rejected(tmp_path, mutation):
    with pytest.raises(SpecError):
        load_spec(_write(tmp_path, {**VALID, **mutation}))


def test_pair_name_must_match_folder(tmp_path):
    with pytest.raises(SpecError, match="folder"):
        load_spec(_write(tmp_path, VALID, folder="other-folder"))


def test_discovery_skips_template_and_requires_pdfs(tmp_path):
    _write(tmp_path, VALID, folder="_template")
    assert discover_pairs(tmp_path) == []
    _write(tmp_path, VALID)
    with pytest.raises(SpecError, match="missing old.pdf, new.pdf"):
        discover_pairs(tmp_path)


def test_repository_template_is_a_valid_spec(repo_root):
    raw = yaml.safe_load((repo_root / "golden/pairs/_template/expected.yaml").read_text())
    raw["pair"] = "_template"
    from diffnexa_engine.golden.spec import GoldenSpec

    GoldenSpec.model_validate({**raw, "pair": "template-check"})

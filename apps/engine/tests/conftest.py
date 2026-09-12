from __future__ import annotations

from pathlib import Path

import pytest

from diffnexa_engine.golden.synthetic import generate_synthetic_pairs

REPO_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def synthetic_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """All synthetic golden pairs, generated once per test session."""
    out = tmp_path_factory.mktemp("golden") / "synthetic"
    generate_synthetic_pairs(out)
    return out


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT

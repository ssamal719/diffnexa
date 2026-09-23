from __future__ import annotations

from pathlib import Path

import pytest

from diffnexa_engine.golden.synthetic import generate_synthetic_pairs

REPO_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def isolated_engine_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Run every test against a known environment.

    Engine settings are read from environment variables, so a developer whose
    shell happens to export ENGINE_SHARED_SECRET (or a limit) would otherwise
    see different results from CI. Tests that need a value set it explicitly.
    """
    for name in (
        "ENGINE_SHARED_SECRET",
        "DIFFNEXA_MAX_FILE_MB",
        "DIFFNEXA_MAX_PAGES",
        "DIFFNEXA_DOCX_MAX_FILE_MB",
        "DIFFNEXA_EXCEL_MAX_FILE_MB",
        "DIFFNEXA_EXCEL_MAX_CELLS",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(scope="session")
def synthetic_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """All synthetic golden pairs, generated once per test session."""
    out = tmp_path_factory.mktemp("golden") / "synthetic"
    generate_synthetic_pairs(out)
    return out


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT

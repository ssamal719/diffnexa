"""Guards against source files that exist locally but are missing from the repository.

Stage 1 shipped a broken engine package to CI because `.gitignore` contained an
unanchored `reports/` rule, which silently excluded the real source package
`diffnexa_engine/reports/`. Everything passed locally, where the files exist on
disk, and failed on a clean checkout, where they did not.

These tests reproduce that class of failure cheaply:

* every Python file in the engine package must be tracked by git,
* every sub-package must have an `__init__.py`, so setuptools discovers it,
* every sub-package must be importable and declared by the installed
  distribution.

They are skipped (not silently passed) when git or the repository is unavailable.
"""

from __future__ import annotations

import importlib
import subprocess
from pathlib import Path

import pytest

import diffnexa_engine

PACKAGE_DIR = Path(diffnexa_engine.__file__).resolve().parent


def _git_tracked_files(repo_root: Path) -> set[Path] | None:
    try:
        output = subprocess.run(
            ["git", "-C", str(repo_root), "ls-files", "-z"],
            capture_output=True,
            check=True,
            text=True,
            timeout=60,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return {repo_root / name for name in output.split("\0") if name}


def _source_files() -> list[Path]:
    return sorted(path for path in PACKAGE_DIR.rglob("*.py") if "__pycache__" not in path.parts)


def test_every_engine_source_file_is_committed(repo_root: Path) -> None:
    """A file that only exists on this machine will break a clean checkout."""
    tracked = _git_tracked_files(repo_root)
    if tracked is None:
        pytest.skip("git is not available in this environment")
    if not tracked:
        pytest.skip("not running inside a git working tree")

    untracked = [path for path in _source_files() if path.resolve() not in tracked]
    assert untracked == [], (
        "These engine source files are not committed, so a clean install would "
        "not contain them: " + ", ".join(str(p.relative_to(PACKAGE_DIR)) for p in untracked)
    )


def test_every_subpackage_has_an_init_file() -> None:
    """setuptools' package discovery only finds directories with __init__.py."""
    missing = [
        directory.relative_to(PACKAGE_DIR)
        for directory in sorted(PACKAGE_DIR.rglob("*"))
        if directory.is_dir()
        and "__pycache__" not in directory.parts
        and any(child.suffix == ".py" for child in directory.iterdir())
        and not (directory / "__init__.py").exists()
    ]
    assert missing == [], f"sub-packages without __init__.py: {missing}"


EXPECTED_SUBPACKAGES = [
    "diffnexa_engine.adapters",
    "diffnexa_engine.adapters.pdf",
    "diffnexa_engine.ai",
    "diffnexa_engine.contracts",
    "diffnexa_engine.golden",
    "diffnexa_engine.model",
    "diffnexa_engine.reports",
]


@pytest.mark.parametrize("module_name", EXPECTED_SUBPACKAGES)
def test_subpackage_is_importable(module_name: str) -> None:
    assert importlib.import_module(module_name) is not None


def test_report_renderer_is_importable() -> None:
    """The exact import that failed in CI."""
    from diffnexa_engine.reports.extraction_report import render_extraction_html

    assert callable(render_extraction_html)


def test_installed_distribution_declares_every_subpackage() -> None:
    """Catches a package present on disk but left out of the built distribution."""
    from importlib.metadata import PackageNotFoundError, files

    try:
        distribution_files = files("diffnexa-engine")
    except PackageNotFoundError:
        pytest.skip("diffnexa-engine is not installed as a distribution")
    if distribution_files is None:
        pytest.skip("the installed distribution does not record its file list")

    recorded = {str(item) for item in distribution_files}
    # An editable install records a link rather than the files themselves.
    if not any(name.startswith("diffnexa_engine/") for name in recorded):
        pytest.skip("editable install: file list is not recorded")

    for module_name in EXPECTED_SUBPACKAGES:
        path = module_name.replace(".", "/") + "/__init__.py"
        assert path in recorded, f"{path} is missing from the installed distribution"

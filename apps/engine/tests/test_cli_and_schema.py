import json
import shutil

import pytest

from diffnexa_engine import cli

from .helpers.pdfs import encrypted_pdf, text_pdf


def test_probe_command(tmp_path, capsys):
    good = tmp_path / "good.pdf"
    good.write_bytes(text_pdf([["a"], ["b"]]))
    assert cli.main(["probe", str(good)]) == 0
    assert "2 page(s)" in capsys.readouterr().out
    locked = tmp_path / "locked.pdf"
    locked.write_bytes(encrypted_pdf(text_pdf([["a"]]), user="pw"))
    assert cli.main(["probe", str(locked)]) == 1
    assert "password protected" in capsys.readouterr().out


def test_renamed_file_is_rejected(tmp_path, capsys):
    fake = tmp_path / "notice.pdf"
    fake.write_bytes(b"GIF89a this is really an image")
    assert cli.main(["probe", str(fake)]) == 1
    assert "isn't a PDF" in capsys.readouterr().out


def test_extract_command_writes_reports(tmp_path, capsys):
    src = tmp_path / "notice.pdf"
    src.write_bytes(text_pdf([["Total Vacancies: 627"]], title="<script>alert(1)</script>"))
    assert cli.main(["extract", str(src), "--out", str(tmp_path / "out")]) == 0
    html = (tmp_path / "out" / "notice.extraction.html").read_text()
    data = json.loads((tmp_path / "out" / "notice.extraction.json").read_text())
    assert "Vacancies:" in html and data["pages"][0]["words"][2]["text"] == "627"
    assert "<script>" not in html  # PDF-controlled text is escaped


def test_missing_file(capsys):
    assert cli.main(["probe", "/definitely/not/here.pdf"]) == 1


def test_committed_schemas_are_current(repo_root, monkeypatch, capsys):
    monkeypatch.chdir(repo_root)
    assert cli.main(["schema", "--check"]) == 0, capsys.readouterr().out


@pytest.fixture
def repo_copy(repo_root, tmp_path):
    """A throwaway copy of the repo layout so golden commands can write freely."""
    root = tmp_path / "repo"
    (root / "packages" / "contracts").mkdir(parents=True)
    shutil.copytree(repo_root / "golden", root / "golden", ignore=shutil.ignore_patterns(".generated"))
    return root


def test_golden_run_command(repo_copy, monkeypatch, capsys):
    monkeypatch.chdir(repo_copy)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    assert cli.main(["golden", "run"]) == 0
    out = capsys.readouterr().out
    assert "Extraction failures: **0**" in out
    assert (repo_copy / "reports" / "golden" / "index.html").exists()


def test_golden_baseline_update_needs_reason(repo_copy, monkeypatch):
    monkeypatch.chdir(repo_copy)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    assert cli.main(["golden", "run", "--update-baseline"]) == 2
    assert cli.main(["golden", "run", "--update-baseline", "--reason", "Test baseline refresh."]) == 0
    assert "Test baseline refresh." in (repo_copy / "golden" / "BASELINE_CHANGES.md").read_text()


def test_golden_run_fails_when_a_pair_disappears(repo_copy, monkeypatch, capsys):
    monkeypatch.chdir(repo_copy)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    baseline = json.loads((repo_copy / "golden" / "baseline.json").read_text())
    baseline["pairs"]["a-pair-that-was-deleted"] = {"extraction_passed": True, "comparison": None}
    (repo_copy / "golden" / "baseline.json").write_text(json.dumps(baseline))
    assert cli.main(["golden", "run"]) == 1
    assert "no longer in the suite" in capsys.readouterr().out

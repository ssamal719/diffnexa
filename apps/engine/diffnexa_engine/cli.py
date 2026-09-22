"""`diffnexa` command-line tool.

    diffnexa probe FILE.pdf                    validate a file and show its page count
    diffnexa extract FILE.pdf [--out DIR]      write an extraction report (HTML + JSON)
    diffnexa compare OLD.pdf NEW.pdf            compare two PDFs
    diffnexa serve                             run the engine service for the website
    diffnexa golden generate                   regenerate the synthetic golden pairs
    diffnexa golden run                        run the golden suite and the accuracy ratchet
    diffnexa golden run --update-baseline --reason "why"
    diffnexa schema [--check]                  write (or verify) the JSON schemas

Exit codes: 0 success, 1 failure (bad file, failing checks, regressions), 2 usage error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from diffnexa_engine.adapters.pdf.extract import extract_file
from diffnexa_engine.adapters.pdf.probe import probe_pdf
from diffnexa_engine.errors import USER_MESSAGES, DocumentError


def find_repo_root(start: Path | None = None) -> Path:
    here = (start or Path.cwd()).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "golden").is_dir() and (candidate / "packages" / "contracts").is_dir():
            return candidate
    raise SystemExit("Could not find the DiffNexa repository root (run this inside the repo).")


# ---------------------------------------------------------------- commands


def cmd_probe(args: argparse.Namespace) -> int:
    data = Path(args.file).read_bytes()
    result = probe_pdf(data)
    if result.ok:
        print(f"OK: {result.page_count} page(s), {result.size_bytes:,} bytes, PDF {result.pdf_version}")
        if result.is_encrypted:
            print("Note: permission restrictions are set, but the file opens without a password.")
        return 0
    assert result.error is not None
    print(f"Rejected ({result.error.value}): {USER_MESSAGES[result.error]}")
    return 1


def cmd_extract(args: argparse.Namespace) -> int:
    from diffnexa_engine.reports.extraction_report import document_summary, render_extraction_html

    source = Path(args.file)
    try:
        doc = extract_file(str(source))
    except DocumentError as exc:
        print(f"Rejected ({exc.code.value}): {exc.user_message}")
        return 1
    out_dir = Path(args.out) if args.out else source.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    html_path = out_dir / f"{source.stem}.extraction.html"
    json_path = out_dir / f"{source.stem}.extraction.json"
    html_path.write_text(render_extraction_html(doc, source.name), encoding="utf-8")
    json_path.write_text(doc.model_dump_json(indent=2), encoding="utf-8")
    summary = document_summary(doc)
    print(f"{summary['page_count']} page(s), {summary['word_count']} words extracted.")
    for warning in summary["warnings"]:
        print(f"Warning: {warning}")
    print(f"Report: {html_path}\nData:   {json_path}")
    return 0


def cmd_golden_generate(args: argparse.Namespace) -> int:
    from diffnexa_engine.golden.synthetic import generate_synthetic_pairs

    root = find_repo_root()
    folders = generate_synthetic_pairs(root / "golden" / ".generated" / "synthetic")
    print(f"Generated {len(folders)} synthetic pairs in golden/.generated/synthetic")
    return 0


def cmd_golden_run(args: argparse.Namespace) -> int:
    from diffnexa_engine.compare import compare_documents
    from diffnexa_engine.golden.baseline import find_regressions, load_baseline, write_baseline
    from diffnexa_engine.golden.competitor import discover_competitor_pairs, score_competitor_pair
    from diffnexa_engine.golden.loader import discover_pairs
    from diffnexa_engine.golden.policy import discover_policy_pairs, score_policy_pair
    from diffnexa_engine.golden.runner import (
        PairOutcome,
        render_summary_markdown,
        run_suite,
        write_reports,
    )
    from diffnexa_engine.golden.spec import SpecError
    from diffnexa_engine.golden.synthetic import generate_synthetic_pairs
    from diffnexa_engine.golden.web import discover_web_pairs, score_web_pair

    root = find_repo_root()
    synthetic_dir = root / "golden" / ".generated" / "synthetic"
    generate_synthetic_pairs(synthetic_dir)
    try:
        pairs = discover_pairs(synthetic_dir) + discover_pairs(root / "golden" / "pairs")
    except SpecError as exc:
        print(f"Golden spec error: {exc}")
        return 1
    names = [p.name for p in pairs]
    duplicates = sorted({n for n in names if names.count(n) > 1})
    if duplicates:
        print(f"Pair names must be unique; duplicated: {', '.join(duplicates)}")
        return 1

    report_dir = Path(args.report_dir) if args.report_dir else root / "reports" / "golden"
    suite = run_suite(pairs, comparator=compare_documents, report_dir=report_dir)

    # Webpage pairs are scored the same way and held to the same floor. Their
    # names are prefixed so the two suites share one baseline without colliding.
    try:
        web_pairs = discover_web_pairs(root / "golden" / "web-pairs")
    except Exception as exc:  # a malformed spec must fail loudly, not silently
        print(f"Web golden spec error: {exc}")
        return 1
    for web_pair in web_pairs:
        score, _before, _after = score_web_pair(web_pair)
        suite.pairs.append(
            PairOutcome(
                name=f"web:{web_pair.name}",
                source="web",
                description=web_pair.spec.description,
                extraction_failures=[],
                comparison_status="scored",
                score=score,  # same four metrics as a PDF pair
            )
        )

    # Policy pairs score the same four metrics, plus their own topic checks.
    try:
        policy_pairs = discover_policy_pairs(root / "golden" / "policy-pairs")
    except Exception as exc:
        print(f"Policy golden spec error: {exc}")
        return 1
    for policy_pair in policy_pairs:
        score, _before, _after, _classification = score_policy_pair(policy_pair)
        suite.pairs.append(
            PairOutcome(
                name=f"policy:{policy_pair.name}",
                source="policy",
                description=policy_pair.spec.description,
                extraction_failures=[],
                comparison_status="scored",
                score=score,
            )
        )

    # Competitor pairs score the same four metrics, plus their signal checks.
    try:
        competitor_pairs = discover_competitor_pairs(root / "golden" / "competitor-pairs")
    except Exception as exc:
        print(f"Competitor golden spec error: {exc}")
        return 1
    for competitor_pair in competitor_pairs:
        score, _before, _after, _classification = score_competitor_pair(competitor_pair)
        suite.pairs.append(
            PairOutcome(
                name=f"competitor:{competitor_pair.name}",
                source="competitor",
                description=competitor_pair.spec.description,
                extraction_failures=[],
                comparison_status="scored",
                score=score,
            )
        )
    baseline_path = root / "golden" / "baseline.json"
    current = suite.metrics()
    regressions, new_pairs = find_regressions(load_baseline(baseline_path), current)
    write_reports(suite, report_dir, regressions, new_pairs)
    summary = render_summary_markdown(suite, regressions, new_pairs)
    print(summary)
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as handle:
            handle.write(summary)
    print(f"Full report: {report_dir / 'index.html'}")

    if args.update_baseline:
        if not args.reason:
            print("--update-baseline needs --reason explaining why the baseline is changing.")
            return 2
        if suite.extraction_failures or suite.comparison_failures:
            print("Refusing to update the baseline while checks are failing. Fix them first.")
            return 1
        write_baseline(baseline_path, current, args.reason, root / "golden" / "BASELINE_CHANGES.md")
        print("Baseline updated.")
        return 0

    failed = bool(suite.extraction_failures or suite.comparison_failures or regressions)
    if new_pairs and not failed:
        print("New pairs are not in the baseline yet. Record them with --update-baseline --reason.")
    return 1 if failed else 0


def cmd_compare(args: argparse.Namespace) -> int:
    from diffnexa_engine.compare import compare_documents_verbose
    from diffnexa_engine.contracts import Side

    try:
        old = extract_file(args.old)
        new = extract_file(args.new)
    except DocumentError as exc:
        print(f"Rejected ({exc.code.value}): {exc.user_message}")
        return 1

    outcome = compare_documents_verbose(old, new)
    changes = outcome.result.changes
    meaningful = [c for c in changes if c.noise_reason is None]

    print(f"{len(meaningful)} change(s) found ({len(changes) - len(meaningful)} filtered as noise)")
    for change in meaningful:
        pages_old = sorted(change.evidence_pages(Side.OLD))
        pages_new = sorted(change.evidence_pages(Side.NEW))
        location = f"old p{pages_old or '-'} / new p{pages_new or '-'}"
        print(f"\n  {change.change_type}  [{location}]")
        if change.label:
            print(f"    {change.label}")
        if change.old_value is not None:
            print(f"    previous: {change.old_value}")
        if change.new_value is not None:
            print(f"    new:      {change.new_value}")
        if change.delta:
            print(f"    difference: {change.delta}")

    for note in outcome.diagnostics.notes:
        print(f"\nNote: {note}")

    if args.json:
        path = Path(args.json)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(outcome.result.model_dump_json(indent=2), encoding="utf-8")
        print(f"\nResult written to {path}")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    try:
        import uvicorn

        from diffnexa_engine.service import build_app
    except ImportError:
        print(
            "The engine service needs its optional dependencies. Install them with:\n"
            '    pip install -e "apps/engine[service]"'
        )
        return 1

    print(f"DiffNexa engine listening on http://{args.host}:{args.port}")
    print("Documents are compared in memory and never written to disk. Press Ctrl+C to stop.")
    uvicorn.run(build_app(), host=args.host, port=args.port, log_level="warning")
    return 0


def cmd_schema(args: argparse.Namespace) -> int:
    from diffnexa_engine.contracts.changes import ComparisonResult
    from diffnexa_engine.golden.spec import GoldenSpec
    from diffnexa_engine.model.document import Document

    root = find_repo_root()
    target = root / "packages" / "contracts" / "schema"
    schemas = {
        "document.schema.json": Document.model_json_schema(),
        "comparison-result.schema.json": ComparisonResult.model_json_schema(),
        "golden-spec.schema.json": GoldenSpec.model_json_schema(),
    }
    stale = []
    for name, schema in schemas.items():
        text = json.dumps(schema, indent=2, sort_keys=True) + "\n"
        path = target / name
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                stale.append(name)
        else:
            target.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    if args.check:
        if stale:
            print("Out-of-date schema files: " + ", ".join(stale))
            print("Run `diffnexa schema` and commit the result.")
            return 1
        print("Schema files are up to date.")
        return 0
    print(f"Wrote {len(schemas)} schema files to packages/contracts/schema")
    return 0


# ---------------------------------------------------------------- entry point


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="diffnexa", description="DiffNexa engine tools")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("probe", help="validate a PDF")
    p.add_argument("file")
    p.set_defaults(func=cmd_probe)

    p = sub.add_parser("extract", help="write an extraction report for a PDF")
    p.add_argument("file")
    p.add_argument("--out", help="folder for the report (default: next to the PDF)")
    p.set_defaults(func=cmd_extract)

    golden = sub.add_parser("golden", help="golden test suite")
    gsub = golden.add_subparsers(dest="golden_command", required=True)
    g = gsub.add_parser("generate", help="regenerate synthetic pairs")
    g.set_defaults(func=cmd_golden_generate)
    g = gsub.add_parser("run", help="run the suite and the accuracy ratchet")
    g.add_argument("--report-dir")
    g.add_argument("--update-baseline", action="store_true")
    g.add_argument("--reason")
    g.set_defaults(func=cmd_golden_run)

    p = sub.add_parser("compare", help="compare two PDFs and list the changes")
    p.add_argument("old", help="the previous version")
    p.add_argument("new", help="the new version")
    p.add_argument("--json", help="also write the full result to this file")
    p.set_defaults(func=cmd_compare)

    p = sub.add_parser("serve", help="run the engine as a local service for the website")
    p.add_argument("--host", default="127.0.0.1", help="default: localhost only")
    p.add_argument("--port", type=int, default=8000)
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("schema", help="write or check JSON schemas")
    p.add_argument("--check", action="store_true")
    p.set_defaults(func=cmd_schema)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except FileNotFoundError as exc:
        print(f"File not found: {exc.filename}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

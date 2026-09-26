"""Built-in examples for "Try example" in the web monitoring tools.

A web monitoring tool compares a page as it was (a baseline the person kept)
with the page as it is now (read live). An example cannot depend on a live
page, so each tool's example is two saved versions of a fictional page — the
before and after pages of a golden pair — read by the same extraction and
compared by the same comparison as a real check. Nothing is fetched.
"""

from __future__ import annotations

from typing import Literal

from diffnexa_engine.examples.pages import PAGES
from diffnexa_engine.web.compare import WebComparisonOutcome, compare_snapshots_verbose
from diffnexa_engine.web.extract import extract_snapshot
from diffnexa_engine.web.snapshot import Snapshot

ExampleTool = Literal["web", "policy", "competitor", "price"]
EXAMPLE_TOOLS: tuple[ExampleTool, ...] = ("web", "policy", "competitor", "price")

#: When each example page was "captured". Fixed, so an example is always the same comparison.
BASELINE_AT = "2026-01-01T00:00:00+00:00"
CHECKED_AT = "2026-02-01T00:00:00+00:00"


def example_snapshots(tool: ExampleTool) -> tuple[Snapshot, Snapshot]:
    """The example page for a tool as it was, and as it is "now"."""
    page = PAGES[tool]
    before = extract_snapshot(page["before"], url=page["url"], fetched_at=BASELINE_AT)
    after = extract_snapshot(page["after"], url=page["url"], fetched_at=CHECKED_AT)
    return before, after


def example_comparison(tool: ExampleTool) -> tuple[Snapshot, WebComparisonOutcome]:
    """The example's baseline, and its comparison with the example page "now"."""
    before, after = example_snapshots(tool)
    return before, compare_snapshots_verbose(before, after)


__all__ = ["EXAMPLE_TOOLS", "ExampleTool", "example_comparison", "example_snapshots"]

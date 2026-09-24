/**
 * @vitest-environment jsdom
 *
 * Long evidence stays inside the workspace.
 *
 * Evidence often holds long unbroken strings: addresses, cell values, IDs. In a
 * grid or flex column, `break-words` (overflow-wrap: break-word) still lets
 * such a string set the column's minimum width, and a `1fr` track cannot
 * shrink below it. A 200-character URL in an Excel cell pushed the Evidence
 * panel ~400px wider than its column and made whole pages scroll sideways.
 *
 * jsdom does no layout, so these tests check the rules that prevent it: the
 * panel and everything evidence is written in use `wrap-anywhere`, value
 * columns are `minmax(0,1fr)`, and nothing truncates or hides the evidence.
 * The real-browser check (every tool at 1440/1024/375px) is recorded in
 * docs/evidence-panel-overflow-fix.md.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExcelWorkspace } from "@/components/excel/ExcelWorkspace";
import { DetectedValues, EvidenceQuote } from "@/components/workspace/EvidenceBits";
import type { ExcelComparison } from "@/lib/excel-report";

afterEach(cleanup);

const OLD_URL =
  "https://findsbeacon.com/reviews/best-cordless-stick-vacuum-cleaners-for-pet-hair-and-hardwood-floors-2026-buying-guide/?utm_source=pinterest&utm_medium=pin&utm_campaign=home-cleaning-q4-2026-evergreen-pin-refresh";
const NEW_URL =
  "https://findsbeacon.com/reviews/best-cordless-stick-vacuum-cleaners-for-pet-hair-and-hardwood-floors-2026-buying-guide-updated-october/?utm_source=pinterest&utm_medium=pin&utm_campaign=home-cleaning-q4-2026-evergreen-pin-refresh-v2";
const LONG_NAME = "FindsBeacon-Pinterest-pin-register-cordless-stick-vacuums-pet-hair-hardwood-floors-Q4-2026-final-v2.xlsx";

/** The shared fixture, with change #4 (a hyperlink change) carrying long FindsBeacon URLs everywhere evidence shows them. */
function withLongUrls(): ExcelComparison {
  const result: ExcelComparison = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "excel-comparison.json"), "utf8"),
  );
  const change = result.changes.find((item) => item.number === 4)!;
  change.oldValue = OLD_URL;
  change.newValue = NEW_URL;
  for (const [place, url] of [
    [change.original, OLD_URL],
    [change.revised, NEW_URL],
  ] as const) {
    if (place?.cell) {
      place.cell.display = url;
      place.cell.value = `${url}#stored`;
      place.cell.link = url;
    }
  }
  change.evidence = change.evidence.map((item) => ({ ...item, excerpt: item.side === "old" ? OLD_URL : NEW_URL }));
  return result;
}

/** Classes that let a long string set a column's minimum width. */
const WIDENING = /^(break-words|grid-cols-\[.*(\[|_)1fr(_|\]).*)$/;
/** Classes that would cut evidence off or hide part of it. */
const HIDING = /^(truncate|whitespace-nowrap|text-ellipsis|overflow-hidden|line-clamp-\d+)$/;

function unsafeClasses(root: Element, { hiding = true } = {}): string[] {
  const found: string[] = [];
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const name of (element.getAttribute("class") ?? "").split(/\s+/)) {
      if (WIDENING.test(name) || (hiding && HIDING.test(name))) found.push(`<${element.tagName.toLowerCase()}> ${name}`);
    }
  }
  return found;
}

function showLinkChange() {
  render(
    <ExcelWorkspace
      result={withLongUrls()}
      original={{ name: LONG_NAME, sizeBytes: 18_432 }}
      revised={{ name: LONG_NAME.replace("final", "revised"), sizeBytes: 19_004 }}
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Differences" });
  fireEvent.click(within(nav).getByRole("button", { name: /^Change 4:/ }));
  return screen.getByRole("region", { name: "Evidence" });
}

describe("the Evidence panel with long URLs", () => {
  it("lets every string in it wrap to the panel's width", () => {
    const panel = showLinkChange();
    expect(panel.className).toContain("wrap-anywhere");
    expect(panel.className).toContain("min-w-0");
    expect(panel.className).toContain("max-w-full");
    // And so does everything else in the workspace: the list, both versions, AI Change Analyst.
    const workspace = panel.parentElement!.closest("section")!;
    expect(workspace.getAttribute("aria-labelledby")).toBeTruthy();
    expect(workspace.className).toContain("wrap-anywhere");
  });

  it("shows each URL in full: nothing is truncated, hidden or shortened", () => {
    const panel = showLinkChange();
    fireEvent.click(within(panel).getByRole("button", { name: "View evidence" }));
    const text = panel.textContent ?? "";
    expect(text).toContain(OLD_URL);
    expect(text).toContain(NEW_URL);
    expect(text).toContain(`${NEW_URL}#stored`);
    expect(text.split(NEW_URL).length - 1).toBeGreaterThanOrEqual(3); // value, link, quoted evidence
  });

  it("uses no class that lets a long string widen a column or cuts it off", () => {
    const panel = showLinkChange();
    fireEvent.click(within(panel).getByRole("button", { name: "View evidence" }));
    expect(unsafeClasses(panel)).toEqual([]);
  });

  it("keeps the vertical scroll the panel already had on wide screens", () => {
    const panel = showLinkChange();
    expect(panel.className).toContain("xl:overflow-y-auto");
    expect(panel.className).toContain("xl:max-h-[46rem]");
  });
});

describe("the other views with long URLs and file names", () => {
  it("Diff and Details wrap values and file names instead of widening the page", () => {
    showLinkChange();
    for (const mode of ["Diff", "Details"]) {
      fireEvent.click(screen.getByRole("tab", { name: mode }));
      const view = screen.getByRole("tabpanel");
      expect(unsafeClasses(view, { hiding: false }), mode).toEqual([]);
    }
    expect(screen.getByRole("tabpanel").textContent).toContain(LONG_NAME);
  });
});

describe("the shared evidence pieces", () => {
  it("wrap long before and after values and quotations", () => {
    const { container } = render(
      <>
        <DetectedValues before={OLD_URL} after={NEW_URL} difference={null} />
        <EvidenceQuote side="revised" where="page 1">
          “{NEW_URL}”
        </EvidenceQuote>
      </>,
    );
    expect(unsafeClasses(container)).toEqual([]);
    expect(container.querySelector("dl")!.className).toContain("minmax(0,1fr)");
    for (const dd of container.querySelectorAll("dd")) expect(dd.className).toContain("wrap-anywhere");
    expect(container.querySelector("blockquote")!.className).toContain("wrap-anywhere");
    expect(container.textContent).toContain(OLD_URL);
    expect(container.textContent).toContain(NEW_URL);
  });
});

describe("the workspace source", () => {
  // Components that render inside the Unified Comparison Workspace, for every tool. A bare `1fr`
  // track or `break-words` here is how the overflow came back; this keeps it out.
  const dir = join(import.meta.dirname, "..", "src", "components");
  const files = [
    ...readdirSync(join(dir, "workspace")).map((name) => join("workspace", name)),
    join("excel", "ExcelWorkspace.tsx"),
    join("analysis", "ChangeAnalyst.tsx"),
    // The cards of the List view.
    join("results", "ChangeCard.tsx"),
    join("docx", "DocxChangeCard.tsx"),
    join("website", "WebChangeCard.tsx"),
  ];

  it.each(files)("%s uses wrap-anywhere and minmax(0,1fr) value columns", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    expect(source).not.toMatch(/\bbreak-words\b/);
    expect(source).not.toMatch(/grid-cols-\[[^\]]*_1fr\]/);
  });
});

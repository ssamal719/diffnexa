/**
 * @vitest-environment jsdom
 *
 * DOCX page locations.
 *
 * The fixture is the engine's real output for two 135-page Word documents
 * (apps/engine/tests/fixtures/docx_pages). Its "oracle" holds the page each
 * change was actually rendered on — read from a LibreOffice rendering of the
 * documents, not computed by DiffNexa — so these tests check the page shown in
 * the navigator, the card, the evidence and the document view against real
 * pages, never against paragraph arithmetic.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocxReport } from "@/components/docx/DocxReport";
import {
  docxPlaceNote,
  docxWorkspaceChanges,
  layoutNote,
  pageOf,
  whereOf,
  type DocxComparison,
} from "@/lib/docx-report";

import { choose, evidence, listed, navigator } from "./helpers/workspace";

type Oracle = { what: string; oracleId: string; change: string; oldPage: number | null; newPage: number | null };

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}

const LONG = fixture<{ oracle: Oracle[]; result: DocxComparison }>("docx-long-pages.json");
const RESULT = LONG.result;
const WITHOUT_PAGES = fixture<DocxComparison>("docx-comparison.json");
const FILES = { original: { name: "Long v1.docx", sizeBytes: 90_000 }, revised: { name: "Long v2.docx", sizeBytes: 90_100 } };

afterEach(cleanup);
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/** The page a change is on as a person would read it: the revised page, or the original's for a removal. */
function expectedPage(oracle: Oracle): string {
  return oracle.newPage !== null ? `Page ${oracle.newPage}` : `Page ${oracle.oldPage} (original)`;
}

function numberOf(changeId: string): number {
  return [...RESULT.changes].sort((a, b) => a.seq - b.seq).findIndex((change) => change.id === changeId) + 1;
}

describe("the 135-page fixture", () => {
  it("covers pages near 10, 25, 50, 75 and past 100, and every kind of change asked for", () => {
    expect(RESULT.layout?.previous).toEqual({ status: "recorded", reason: null, pages: 135 });
    expect(RESULT.layout?.revised).toEqual({ status: "recorded", reason: null, pages: 135 });
    const pages = LONG.oracle.map((item) => item.newPage ?? item.oldPage);
    for (const near of [10, 25, 50, 75]) expect(pages.some((page) => page !== null && Math.abs(page - near) <= 1)).toBe(true);
    expect(pages.some((page) => page !== null && page >= 100)).toBe(true);
    const kinds = new Set(LONG.oracle.map((item) => RESULT.changes.find((change) => change.id === item.change)!.kind));
    expect([...kinds].sort()).toEqual(["added", "modified", "removed"]);
    expect(RESULT.changes.some((change) => change.category === "number")).toBe(true);
    // Several changes on one page.
    const onHundredOne = LONG.oracle.filter((item) => item.newPage === 101);
    expect(onHundredOne.length).toBeGreaterThanOrEqual(2);
  });

  it.each(LONG.oracle.map((item) => [item.oracleId, item] as const))(
    "gives %s the page it was rendered on, on each side",
    (_id, oracle) => {
      const change = RESULT.changes.find((item) => item.id === oracle.change)!;
      const pageOn = (side: "old" | "new") => change.evidence.find((item) => item.side === side)?.page ?? null;
      expect(pageOn("old")).toBe(oracle.oldPage);
      expect(pageOn("new")).toBe(oracle.newPage);
      expect(pageOf(change)?.page).toBe(oracle.newPage ?? oracle.oldPage);
    },
  );
});

describe("pages in the workspace", () => {
  it("group the navigator by page, in page order", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    const text = navigator().textContent ?? "";
    const order = ["Page 10", "Page 25", "Page 51", "Page 61", "Page 75 (original)", "Page 82", "Page 101"];
    let at = -1;
    for (const label of order) {
      const index = text.indexOf(label);
      expect(index, label).toBeGreaterThan(at);
      at = index;
    }
    expect(text).not.toMatch(/Paragraph \d/);
  });

  it.each(LONG.oracle.map((item) => [item.oracleId, item] as const))(
    "list %s in the navigator and on its card under its rendered page",
    (_id, oracle) => {
      render(<DocxReport result={RESULT} {...FILES} />);
      const number = numberOf(oracle.change);
      const entry = listed().find((label) => label.startsWith(`Change ${number}:`))!;
      expect(entry).toContain(`${expectedPage(oracle)} ·`);

      fireEvent.click(screen.getByRole("tab", { name: "List" }));
      const card = screen.getAllByRole("article")[number - 1];
      expect(card.textContent).toContain(`Page ${oracle.newPage ?? oracle.oldPage} ·`);
    },
  );

  it.each(LONG.oracle.map((item) => [item.oracleId, item] as const))(
    "show %s in the evidence with the page on each side it is in",
    (_id, oracle) => {
      render(<DocxReport result={RESULT} {...FILES} />);
      choose(new RegExp(`^Change ${numberOf(oracle.change)}:`));
      const text = evidence().textContent ?? "";
      if (oracle.oldPage !== null) expect(text).toMatch(new RegExp(`Original · Page ${oracle.oldPage} ·`));
      if (oracle.newPage !== null) expect(text).toMatch(new RegExp(`Revised · Page ${oracle.newPage} ·`));
      // Word's own paragraph position stays available as a labelled detail.
      expect(text).toContain("Pages are as Word laid out the document when it was last saved");
    },
  );

  it.each(LONG.oracle.map((item) => [item.oracleId, item] as const))(
    "take the reader to %s under the right page in the document view",
    (_id, oracle) => {
      render(<DocxReport result={RESULT} {...FILES} />);
      choose(new RegExp(`^Change ${numberOf(oracle.change)}:`));
      const side = oracle.newPage !== null ? "Revised" : "Original";
      const pane = screen.getByRole("region", { name: `${side} document, as compared` });
      const active = pane.querySelector('mark[data-active="true"]')!;
      expect(active).toBeTruthy();
      // The last page marker before the highlighted words is the page they are on.
      const markers = [...pane.querySelectorAll<HTMLElement>("[data-page]")].filter(
        (marker) => marker.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(Number(markers.at(-1)?.dataset.page)).toBe(oracle.newPage ?? oracle.oldPage);
    },
  );

  it("marks a page that begins inside a paragraph where it begins", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    // In the original, the paragraph this change is in starts on page 60 and runs onto page 61.
    const oracle = LONG.oracle.find((item) => item.oracleId === "second-half-of-a-split-paragraph")!;
    expect(oracle.oldPage).toBe(61);
    choose(new RegExp(`^Change ${numberOf(oracle.change)}:`));
    const pane = screen.getByRole("region", { name: "Original document, as compared" });
    const split = [...pane.querySelectorAll<HTMLElement>("span[data-page]")].find((marker) => marker.dataset.page === "61")!;
    expect(split.textContent).toContain("Page 61 begins here");
    // The page marker sits inside the paragraph, before the changed words.
    const paragraph = split.closest("[data-node-id]")!;
    const active = pane.querySelector('mark[data-active="true"]')!;
    expect(paragraph.contains(active)).toBe(true);
    expect(split.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const divider = within(pane).getAllByRole("separator").find((item) => item.getAttribute("aria-label") === "Page 60");
    expect(divider).toBeTruthy();
  });

  it("draws page dividers as named separators", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    const pane = screen.getByRole("region", { name: "Revised document, as compared" });
    const dividers = within(pane).getAllByRole("separator");
    expect(dividers.map((divider) => divider.getAttribute("aria-label"))).toContain("Page 101");
  });

  it("state where the page numbers come from", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    expect(document.body.textContent).toContain("135 pages");
  });
});

describe("a file that does not record its pages", () => {
  it("shows no page anywhere, and says why", () => {
    render(<DocxReport result={WITHOUT_PAGES} {...FILES} />);
    expect(document.body.textContent).not.toMatch(/\bPage \d/);
    expect(docxWorkspaceChanges(WITHOUT_PAGES).every((item) => !/\bPage \d/.test(item.place))).toBe(true);
    const note = docxPlaceNote(WITHOUT_PAGES.changes.find((change) => change.category !== "metadata")!);
    expect(note).toContain("this file does not record its pages");
  });

  it.each([
    ["no_statistics", "does not record"],
    ["statistics_out_of_date", "out of date"],
    ["pages_disagree", "does not match"],
  ] as const)("explains a layout that is unavailable because of %s", (reason, words) => {
    const result: DocxComparison = {
      ...RESULT,
      layout: {
        previous: { status: "unavailable", reason, pages: null },
        revised: { status: "unavailable", reason, pages: null },
      },
    };
    const note = layoutNote(result);
    expect(note?.text.toLowerCase()).toContain(words);
  });

  it("puts no page on evidence the engine gave no page", () => {
    const item = { ...RESULT.changes[0].evidence[0], page: undefined };
    expect(whereOf(item)).not.toMatch(/Page/);
    expect(whereOf({ ...item, page: 7 })).toMatch(/^Page 7 · /);
  });
});

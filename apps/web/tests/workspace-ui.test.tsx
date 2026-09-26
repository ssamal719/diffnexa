/**
 * @vitest-environment jsdom
 *
 * The Comparison Workspace, as every tool uses it.
 *
 * The promises under test: every tool opens the same workspace — header,
 * navigator, both versions, evidence, optional AI — built from real engine
 * results; choosing a change (navigator, Previous/Next, arrow keys, or AI
 * Change Analyst) moves everything to it; evidence always comes from the
 * comparison and the AI's words sit apart from it; filters never hide a change
 * for good; and no tool shows a page number it does not have.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompetitorReport } from "@/components/competitor/CompetitorReport";
import { DocxReport } from "@/components/docx/DocxReport";
import { ExcelWorkspace } from "@/components/excel/ExcelWorkspace";
import { PolicyReport } from "@/components/policy/PolicyReport";
import { PriceReport } from "@/components/price/PriceReport";
import { ComparisonReport } from "@/components/results/ComparisonReport";
import { WebReport } from "@/components/website/WebReport";
import type { ChangeAnalysis } from "@/lib/analysis";

import { counter, evidence, listed, navigator } from "./helpers/workspace";

vi.mock("@/lib/pdf-view", () => {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  };
  return {
    openPdf: vi.fn(() => Promise.resolve({ getPage: () => Promise.resolve(page) })),
    closePdf: vi.fn(),
  };
});

function fixture(name: string) {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}

const PDF = fixture("workspace-pdf.json");
const DOCX = fixture("workspace-docx.json");
const WEB = fixture("workspace-web.json");
const POLICY = fixture("workspace-policy.json");
const COMPETITOR = fixture("workspace-competitor.json");
const PRICE = fixture("workspace-price.json");
const EXCEL = fixture("excel-comparison.json");
const ANALYSIS: ChangeAnalysis = fixture("ai-analysis.json");

const OFFICE = { original: { name: "v1", sizeBytes: 1000 }, revised: { name: "v2", sizeBytes: 1000 } };
const FILES = { original: new File(["%PDF"], "old.pdf"), revised: new File(["%PDF"], "new.pdf") };
const BASELINE = "2026-03-12T09:30:00+00:00";

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom has no layout; give the page panes a width so pages are drawn.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
    },
  );
});

type Tool = {
  name: string;
  count: number;
  view: string | null;
  render: (extra?: { analyst?: ReactNode; analysis?: ChangeAnalysis | null }) => ReactNode;
};

const TOOLS: Tool[] = [
  {
    name: "PDF Compare",
    count: PDF.counts.meaningful,
    view: "Pages",
    render: (extra) => <ComparisonReport result={PDF} files={FILES} names={{ original: "old.pdf", revised: "new.pdf" }} {...extra} />,
  },
  { name: "DOCX Compare", count: DOCX.changes.length, view: "Side by side", render: (extra) => <DocxReport result={DOCX} {...OFFICE} {...extra} /> },
  { name: "Excel Compare", count: EXCEL.changes.length, view: "Grid", render: (extra) => <ExcelWorkspace result={EXCEL} {...OFFICE} {...extra} /> },
  {
    name: "Website Change Detector",
    count: WEB.counts.meaningful,
    view: "Side by side",
    render: (extra) => <WebReport result={WEB} url="https://example.com/agreement" {...extra} />,
  },
  {
    name: "Policy and Terms Monitor",
    count: POLICY.counts.meaningful,
    view: "Side by side",
    render: (extra) => (
      <PolicyReport result={POLICY} url="https://example.com/terms" policyType="terms_of_service" baselineCapturedAt={BASELINE} {...extra} />
    ),
  },
  {
    name: "Competitor Monitor",
    count: COMPETITOR.counts.meaningful,
    view: "Side by side",
    render: (extra) => (
      <CompetitorReport result={COMPETITOR} url="https://rival.example" competitor="Rival" pageType="pricing" baselineCapturedAt={BASELINE} {...extra} />
    ),
  },
  {
    name: "Price Monitor",
    count: PRICE.counts.meaningful,
    view: "Side by side",
    render: (extra) => (
      <PriceReport result={PRICE} url="https://shop.example" product="Plan" pageType="saas_pricing" baselineCapturedAt={BASELINE} {...extra} />
    ),
  },
];

describe.each(TOOLS)("$name opens the shared workspace", (tool) => {
  it("with the header, every change in the navigator, both versions, and the evidence", () => {
    render(<>{tool.render()}</>);
    expect(screen.getByText(`Comparison complete · ${tool.name}`)).toBeTruthy();
    expect(listed()).toHaveLength(tool.count);
    expect(screen.getByRole("tab", { name: tool.view!, selected: true })).toBeTruthy();
    const panel = evidence();
    expect(panel.textContent).toContain("Comparison evidence");
    expect(panel.textContent).toContain("AI explanation");
    expect(panel.textContent).toContain("Not requested");
    expect(counter()).toBe(`Change 1 of ${tool.count}`);
  });

  it("where Next moves the navigator and the evidence together", () => {
    if (tool.count < 2) return;
    render(<>{tool.render()}</>);
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(counter()).toBe(`Change 2 of ${tool.count}`);
    const current = within(navigator()).getByRole("button", { current: true });
    expect(current.getAttribute("aria-label")).toMatch(/^Change 2: /);
    expect(evidence().textContent).toContain(`Change 2 of ${tool.count}`);
  });

  it("with AI Change Analyst offered as an optional second step, and its words kept apart from the evidence", () => {
    render(<>{tool.render({ analyst: <p>AI Change Analyst panel</p> })}</>);
    const link = screen.getByRole("link", { name: /AI Analysis/ });
    const target = document.getElementById(link.getAttribute("href")!.slice(1));
    expect(target?.textContent).toContain("AI Change Analyst panel");
    // The panel comes after the comparison, never before it.
    expect(navigator().compareDocumentPosition(target!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("and never shows a page number the tool does not have", () => {
    render(<>{tool.render()}</>);
    if (tool.name === "PDF Compare") return;
    expect(document.body.textContent).not.toMatch(/\bPage \d+ of \d+/);
    expect(navigator().textContent).not.toMatch(/\bPage \d/);
  });
});

describe("choosing a change", () => {
  it("works with the arrow keys inside the navigator", () => {
    render(<WebReport result={WEB} url="https://example.com/agreement" />);
    const first = within(navigator()).getByRole("button", { current: true });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(counter()).toBe(`Change 2 of ${WEB.counts.meaningful}`);
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Change 2: /);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(counter()).toBe(`Change 1 of ${WEB.counts.meaningful}`);
  });

  it("from AI Change Analyst clears the filters that hide it", () => {
    const { rerender } = render(<WebReport result={WEB} url="https://example.com/agreement" />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "What changed" })).getByRole("button", { name: /^Dates/ }));
    expect(listed()).toHaveLength(1);
    const hidden = WEB.changes.find((change: { category: string }) => change.category === "number");
    rerender(<WebReport result={WEB} url="https://example.com/agreement" focus={{ id: hidden.id, token: 1 }} />);
    expect(listed()).toHaveLength(WEB.counts.meaningful);
    const current = within(navigator()).getByRole("button", { current: true });
    expect(current.textContent).toContain("Number changed");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("shows the AI's explanation beside the evidence once it has been asked for, and says who wrote it", () => {
    const analysis: ChangeAnalysis = { ...ANALYSIS, tool: "docx" };
    const target = analysis.changes[0];
    render(<DocxReport result={fixture("docx-comparison.json")} {...OFFICE} analysis={analysis} />);
    fireEvent.click(within(navigator()).getByRole("button", { name: /^Change 1:/ }));
    const text = evidence().textContent ?? "";
    expect(text).toContain(target.analysis.explanation);
    expect(text.indexOf("Comparison evidence")).toBeLessThan(text.indexOf(target.analysis.explanation));
    expect(text).toContain("The evidence above remains the source of truth.");
  });

  it("says plainly when AI did not explain the chosen change", () => {
    const analysis: ChangeAnalysis = { ...ANALYSIS, tool: "docx", changes: [] };
    render(<DocxReport result={fixture("docx-comparison.json")} {...OFFICE} analysis={analysis} />);
    expect(evidence().textContent).toContain("AI Change Analyst did not explain this change.");
  });
});

describe("filters", () => {
  it("offer only what a tool found, and a cleared filter brings every change back", () => {
    render(<PriceReport result={PRICE} url="https://shop.example" product="Plan" pageType="saas_pricing" baselineCapturedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const kinds = within(screen.getByRole("group", { name: "Kind of change" })).getAllByRole("button");
    expect(kinds.every((button) => /\d/.test(button.textContent ?? ""))).toBe(true);
    const category = screen.getByRole("region", { name: "What kind of changes" });
    fireEvent.click(within(category).getAllByRole("button")[0]);
    expect(listed().length).toBeLessThan(PRICE.counts.meaningful);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(listed()).toHaveLength(PRICE.counts.meaningful);
  });

  it("say so when nothing matches, with a way back", () => {
    render(<WebReport result={WEB} url="https://example.com/agreement" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing like this at all" } });
    expect(navigator().textContent).toContain("No change matches this search or filter.");
    fireEvent.click(screen.getByRole("button", { name: "Show all changes" }));
    expect(listed()).toHaveLength(WEB.counts.meaningful);
  });
});

describe("the two versions", () => {
  it("mark the words each change cites, and move to the active change", () => {
    render(<WebReport result={WEB} url="https://example.com/agreement" />);
    const number = WEB.changes.find((change: { category: string }) => change.category === "number");
    fireEvent.click(within(navigator()).getByRole("button", { name: new RegExp(`^Change ${WEB.changes.indexOf(number) + 1}:`) }));
    const before = screen.getByRole("region", { name: "Baseline capture, as compared" });
    const after = screen.getByRole("region", { name: "The page now, as compared" });
    expect(before.querySelector('[data-active="true"]')?.textContent).toContain(number.oldValue);
    expect(after.querySelector('[data-active="true"]')?.textContent).toContain(number.newValue);
  });

  it("say when a change is only in one version, and show that version on a small screen", () => {
    render(<DocxReport result={DOCX} {...OFFICE} />);
    const original = screen.getByRole("region", { name: "Original document" });
    expect(original.textContent).toContain("Not in the original: this was added in the revised version.");
    const choice = screen.getByRole("group", { name: "Version to show" });
    expect(within(choice).getByRole("button", { name: "Revised" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keep every control a real, named control", () => {
    for (const tool of TOOLS) {
      const { unmount } = render(<>{tool.render({ analyst: <p>panel</p> })}</>);
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("[tabindex]"))) {
        if (element.tabIndex < 0) continue;
        const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
        expect(["button", "a", "input", "select", "textarea", "region", "section", "tab"], `${tool.name}: ${element.outerHTML.slice(0, 80)}`).toContain(role);
        if (role === "region" || role === "section") {
          expect(element.getAttribute("aria-label") ?? element.getAttribute("aria-labelledby")).toBeTruthy();
        }
      }
      for (const button of screen.getAllByRole("button")) {
        expect(((button.textContent ?? "").trim() + (button.getAttribute("aria-label") ?? "")).length).toBeGreaterThan(0);
      }
      unmount();
    }
  });
});

describe("PDF pages", () => {
  function pdf() {
    return render(<ComparisonReport result={PDF} files={FILES} names={{ original: "old.pdf", revised: "new.pdf" }} />);
  }

  it("open both documents at the page the first change's evidence is on", async () => {
    pdf();
    const first = PDF.changes[0];
    const original = screen.getByRole("region", { name: "Original document" });
    const revised = screen.getByRole("region", { name: "Revised document" });
    expect(original.textContent).toContain(`Page ${first.oldPages[0]} of ${PDF.documents.previous.pageCount}`);
    expect(revised.textContent).toContain(`Page ${first.newPages[0]} of ${PDF.documents.revised.pageCount}`);
    // Once drawn, the change is outlined and numbered where the engine found it.
    await waitFor(() => expect(revised.querySelector('[data-active="true"]')?.textContent).toBe("#1"));
  });

  it("turn to the change's page when another change is chosen", async () => {
    pdf();
    const date = PDF.changes.find((change: { type: string }) => change.type === "DATE_CHANGED");
    const number = PDF.changes.indexOf(date) + 1;
    fireEvent.click(within(navigator()).getByRole("button", { name: new RegExp(`^Change ${number}:`) }));
    expect(screen.getByRole("region", { name: "Original document" }).textContent).toContain(`Page ${date.oldPages[0]} of`);
    expect(screen.getByRole("region", { name: "Revised document" }).textContent).toContain(`Page ${date.newPages[0]} of`);
    await act(async () => {});
  });

  it("do not guess a page for a change that is only in the revised document", async () => {
    pdf();
    const added = PDF.changes.find((change: { kind: string }) => change.kind === "added");
    const number = PDF.changes.indexOf(added) + 1;
    const original = screen.getByRole("region", { name: "Original document" });
    const before = original.textContent?.match(/Page \d+ of \d+/)?.[0];
    fireEvent.click(within(navigator()).getByRole("button", { name: new RegExp(`^Change ${number}:`) }));
    expect(original.textContent).toContain("Not in the original: this was added in the revised version.");
    expect(original.textContent?.match(/Page \d+ of \d+/)?.[0]).toBe(before);
    await act(async () => {});
  });

  it("step through pages and zoom with named controls", async () => {
    pdf();
    const revised = screen.getByRole("region", { name: "Revised document" });
    fireEvent.click(within(revised).getByRole("button", { name: "Next page of the revised document" }));
    expect(revised.textContent).toContain(`Page 3 of ${PDF.documents.revised.pageCount}`);
    expect(within(revised).getByRole("button", { name: /Go to the change on page 2/ })).toBeTruthy();
    fireEvent.click(within(revised).getByRole("button", { name: "Zoom in to the revised document" }));
    expect(within(revised).getByRole("button", { name: "Fit the revised page to the width" }).getAttribute("aria-pressed")).toBe("false");
    await act(async () => {});
  });

  it("are not offered when the files are no longer in the browser", () => {
    render(<ComparisonReport result={PDF} />);
    expect(screen.queryByRole("tab", { name: "Pages" })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(PDF.counts.meaningful);
  });
});

describe("comparison controls", () => {
  const WEB_TOOLS = ["Website Change Detector", "Policy and Terms Monitor", "Competitor Monitor", "Price Monitor"];

  it.each(TOOLS)("appear in $name only where the tool gives them real behaviour", (tool) => {
    render(<>{tool.render()}</>);
    // Every tool's side-by-side view can keep both versions in step.
    expect(screen.getByRole("button", { name: /^Linked/ }).getAttribute("aria-pressed")).toBe("true");
    const group = screen.queryByRole("group", { name: "Comparison controls" });
    if (WEB_TOOLS.includes(tool.name)) {
      // A web check can be exported; Ignore options and Reverse would need a page read again, so are not offered.
      expect(within(group!).getByRole("button", { name: /^Export/ })).toBeTruthy();
      expect(within(group!).queryByRole("button", { name: /^Ignore options|^Reverse/ })).toBeNull();
    } else {
      // Ignore options, Export and Reverse are passed in by the page that can compare the files again.
      expect(group).toBeNull();
    }
  });

  it("offers no Linked switch in the list view, where there is nothing to keep in step", () => {
    render(<WebReport result={WEB} url="https://example.com/agreement" />);
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.queryByRole("button", { name: /^Linked/ })).toBeNull();
  });
});

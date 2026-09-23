/**
 * @vitest-environment jsdom
 *
 * The Excel Compare page and the Comparison Workspace it uses.
 *
 * The promises under test: the page says exactly what it does and does not
 * compare; the button works only when both workbooks pass the first check and
 * the service is there; every change the engine returned is in the navigator,
 * grouped by sheet; choosing a change moves BOTH workbooks to its sheet and
 * cell, outlines it, and updates the details and the counter; every mode shows
 * real data; failures name the workbook they are about; and nothing ranks a
 * change.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ExcelComparePage from "@/app/excel-compare/page";
import { ExcelWorkspace } from "@/components/excel/ExcelWorkspace";
import { NO_CHANGES_NOTE, type ExcelComparison } from "@/lib/excel-report";
import { EXCEL_ERROR_MESSAGES } from "@/lib/validation";

const RESULT: ExcelComparison = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "excel-comparison.json"), "utf8"),
);
const FILES = {
  original: { name: "Company Q3.xlsx", sizeBytes: 18_432 },
  revised: { name: "Company Q4.xlsx", sizeBytes: 19_004 },
};

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Stands in for the browser's upload request, answering with a fixed reply. */
class FakeRequest extends EventTarget {
  static reply: { status: number; body: unknown } = { status: 200, body: RESULT };
  static sent: FormData[] = [];
  static urls: string[] = [];
  upload = new EventTarget();
  status = 0;
  responseText = "";
  open(_method: string, url: string) {
    FakeRequest.urls.push(url);
  }
  abort() {}
  send(body: FormData) {
    FakeRequest.sent.push(body);
    setTimeout(() => {
      this.status = FakeRequest.reply.status;
      this.responseText = JSON.stringify(FakeRequest.reply.body);
      this.dispatchEvent(new Event("load"));
    }, 0);
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  FakeRequest.reply = { status: 200, body: RESULT };
  FakeRequest.sent = [];
  FakeRequest.urls = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ available: true }))));
  Element.prototype.scrollIntoView = vi.fn();
});

function choose(label: string, bytes: Uint8Array, name: string) {
  const slot = screen.getByRole("region", { name: label });
  const input = slot.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([bytes as BlobPart], name)] } });
}

async function chooseBoth() {
  choose("Original workbook", ZIP, "Company Q3.xlsx");
  choose("Revised workbook", ZIP, "Company Q4.xlsx");
  await waitFor(() => expect(screen.getByRole("button", { name: "Compare workbooks" })).toHaveProperty("disabled", false));
}

function showWorkspace(result: ExcelComparison = RESULT) {
  return render(<ExcelWorkspace result={result} {...FILES} />);
}

const navigator = () => screen.getByRole("navigation", { name: "Differences" });
const entry = (number: number) =>
  within(navigator()).getByRole("button", { name: new RegExp(`^Change ${number}:`) });
const pane = (side: "Original" | "Revised") => screen.getByRole("region", { name: `${side} spreadsheet` });
const activeTab = (side: "Original" | "Revised") =>
  within(within(pane(side)).getByRole("group", { name: "Sheets" })).getByRole("button", { pressed: true });
const cell = (side: "Original" | "Revised", ref: string) =>
  pane(side).querySelector(`[data-cell="${ref}"]`) as HTMLElement | null;
const outline = (side: "Original" | "Revised") => within(pane(side)).queryByTestId("active-outline");
const counter = () => screen.getByText(/^(Change .+ of \d+|No changes)/, { selector: "[role=status]" });

describe("the page", () => {
  it("names the tool once and says what it does", () => {
    render(<ExcelComparePage />);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Excel Compare"]);
    expect(document.body.textContent).toContain("Compare two Excel workbooks side by side.");
  });

  it("states the limits plainly: .xlsx only, not stored, nothing run, formatting not compared", () => {
    render(<ExcelComparePage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Excel .xlsx files only. Older .xls, macro-enabled .xlsm and binary .xlsb files are not accepted.");
    expect(text).toContain("not stored");
    expect(text).toContain("No formula is calculated, no macro is run");
    expect(text).toContain("Formatting and charts are not.");
  });

  it("never claims formatting, chart or pixel comparison, or AI analysis", () => {
    render(<ExcelComparePage />);
    const text = (document.body.textContent ?? "").toLowerCase();
    expect(text).not.toMatch(/(compares?|comparing) (the )?(formatting|charts|images|colours|pixels)/);
    expect(text).not.toMatch(/visually identical/);
    expect(text).not.toMatch(/ai[- ](powered|analysis|summary)/);
  });

  it("keeps the button disabled until both workbooks are ready", async () => {
    render(<ExcelComparePage />);
    const button = screen.getByRole("button", { name: "Compare workbooks" });
    expect(button).toHaveProperty("disabled", true);
    choose("Original workbook", ZIP, "a.xlsx");
    await screen.findByText("a.xlsx");
    expect(button).toHaveProperty("disabled", true);
  });
});

describe("the first check on each workbook", () => {
  it.each([
    ["a CSV file", new TextEncoder().encode("Plan,Price\nStarter,299\n"), "excel_not_xlsx"],
    ["an older .xls", new Uint8Array([...OLE, 0, 0]), "excel_legacy_xls"],
    ["an empty file", new Uint8Array(0), "excel_empty_file"],
  ] as const)("refuses %s with the shared message", async (_name, bytes, code) => {
    render(<ExcelComparePage />);
    choose("Original workbook", bytes, "file.xlsx");
    expect(await screen.findByText(EXCEL_ERROR_MESSAGES[code])).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare workbooks" })).toHaveProperty("disabled", true);
  });
});

describe("comparing", () => {
  it("sends both workbooks to this site, under fixed names, and opens the workspace", async () => {
    render(<ExcelComparePage />);
    await chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Compare workbooks" }));

    expect(await screen.findByRole("heading", { name: "11 changes found" })).toBeTruthy();
    expect(FakeRequest.urls).toEqual(["/api/excel/compare"]);
    const sent = FakeRequest.sent[0];
    expect((sent.get("original") as File).name).toBe("original.xlsx");
    expect((sent.get("revised") as File).name).toBe("revised.xlsx");
    expect(within(navigator()).getAllByRole("button")).toHaveLength(RESULT.changes.length);
  });

  it("shows the no-change result in the agreed words, and still shows both workbooks", async () => {
    FakeRequest.reply = {
      status: 200,
      body: {
        ...RESULT,
        changes: [],
        counts: { total: 0 },
        groups: RESULT.groups.map((group) => ({ ...group, changeCount: 0, changeIds: [] })),
      },
    };
    render(<ExcelComparePage />);
    await chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Compare workbooks" }));
    expect(await screen.findByRole("heading", { name: "No changes found" })).toBeTruthy();
    expect(screen.getByText(NO_CHANGES_NOTE)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Differences" })).toBeNull();
    expect(screen.getByRole("region", { name: "Original spreadsheet" })).toBeTruthy();
    expect((document.body.textContent ?? "").toLowerCase()).not.toContain("identical");
  });

  it("names the workbook a refusal is about", async () => {
    FakeRequest.reply = {
      status: 400,
      body: { error: { code: "excel_macro_enabled", message: EXCEL_ERROR_MESSAGES.excel_macro_enabled, side: "revised" } },
    };
    render(<ExcelComparePage />);
    await chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Compare workbooks" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This is about your revised workbook.");
    expect(alert.textContent).toContain(EXCEL_ERROR_MESSAGES.excel_macro_enabled);
  });

  it("does not blame a workbook when the service is down", async () => {
    FakeRequest.reply = { status: 503, body: { error: { code: "engine_unavailable", message: "x", side: null } } };
    render(<ExcelComparePage />);
    await chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Compare workbooks" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The comparison service isn't reachable");
    expect(alert.textContent).not.toContain("This is about your");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("the overview and the navigator", () => {
  it("says the comparison is complete, how many changes, and only the kinds present", () => {
    showWorkspace();
    expect(screen.getByText(/Comparison complete/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "11 changes found" })).toBeTruthy();
    expect(screen.getByText("4 value changes · 3 formula changes · 3 structural changes · 1 link change")).toBeTruthy();
    expect(document.body.textContent).toContain("Company Q3.xlsx");
    expect(document.body.textContent).toContain("Company Q4.xlsx");
  });

  it("lists every change, grouped by sheet, with number, cell, category and before → after", () => {
    showWorkspace();
    const groups = within(navigator()).getAllByText(/^Sheet: /).map((item) => item.textContent);
    expect(groups).toEqual(["Sheet: Summary", "Sheet: Pricing", "Sheet: Employees", "Sheet: Regions"]);
    const eight = entry(8);
    expect(eight.textContent).toContain("#8");
    expect(eight.textContent).toContain("F5");
    expect(eight.textContent).toContain("Date");
    expect(eight.textContent).toContain("15 Oct 2026");
    expect(eight.textContent).toContain("1 Nov 2026");
  });

  it("never shows an internal identifier as a location", () => {
    showWorkspace();
    const text = navigator().textContent ?? "";
    expect(text).not.toMatch(/\bc\d+\b|paragraph|node|token/i);
  });

  it("searches changes by what they say", () => {
    showWorkspace();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search changes" }), { target: { value: "Carter" } });
    expect(within(navigator()).getAllByRole("button")).toHaveLength(1);
    expect(counter().textContent).toBe("Change – of 1 shown · 11 in total");
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(counter().textContent).toBe("Change 1 of 1 shown · 11 in total");
    expect(activeTab("Original").textContent).toContain("Employees");
  });
});

describe("choosing a change moves both workbooks to it", () => {
  it("starts at the first change, in both workbooks", () => {
    showWorkspace();
    expect(entry(1).getAttribute("aria-current")).toBe("true");
    expect(counter().textContent).toBe("Change 1 of 11");
    expect(activeTab("Original").textContent).toContain("Summary");
    expect(activeTab("Revised").textContent).toContain("Summary");
  });

  it("opens Pricing on both sides and outlines F4 in the original and F5 in the revised", () => {
    showWorkspace();
    fireEvent.click(entry(8));

    expect(entry(8).getAttribute("aria-current")).toBe("true");
    expect(entry(1).getAttribute("aria-current")).toBeNull();
    expect(counter().textContent).toBe("Change 8 of 11");

    expect(activeTab("Original").textContent).toContain("Pricing");
    expect(activeTab("Revised").textContent).toContain("Pricing");
    const id = RESULT.changes.find((change) => change.number === 8)!.id;
    expect(cell("Original", "F4")?.getAttribute("data-change")).toBe(id);
    expect(cell("Original", "F4")?.textContent).toContain("15 Oct 2026");
    expect(cell("Revised", "F5")?.getAttribute("data-change")).toBe(id);
    expect(cell("Revised", "F5")?.textContent).toContain("1 Nov 2026");
    expect(outline("Original")).toBeTruthy();
    expect(outline("Revised")).toBeTruthy();

    const details = screen.getByRole("heading", { name: /^Date changed/ });
    expect(details.closest("section")!.textContent).toContain("Pricing · F5 (was F4)");
  });

  it("shows before and after, the sheet and the cell for each side in the details", () => {
    showWorkspace();
    fireEvent.click(entry(5));
    const panel = screen.getByRole("heading", { name: /^Number changed/ }).closest("section")!;
    expect(panel.textContent).toContain("$299.00");
    expect(panel.textContent).toContain("$349.00");
    expect(panel.textContent).toContain("+50 (+16.72%)");
    // Once as the change's place, then once in each workbook's card.
    expect(within(panel).getAllByText("B3")).toHaveLength(3);
  });

  it("shows a formula and its saved result on both sides", () => {
    showWorkspace();
    const panel = screen.getByRole("heading", { name: /^Formula changed/ }).closest("section")!;
    expect(panel.textContent).toContain("=SUM(Pricing!E2:E5)");
    expect(panel.textContent).toContain("=SUM(Pricing!E2:E6)");
  });

  it("opens the evidence, cell by cell, from each workbook", () => {
    showWorkspace();
    fireEvent.click(entry(8));
    fireEvent.click(screen.getByRole("button", { name: "View evidence" }));
    const panel = screen.getByRole("heading", { name: /^Date changed/ }).closest("section")!;
    expect(panel.textContent).toContain("Original · Pricing · F4:");
    expect(panel.textContent).toContain("Revised · Pricing · F5:");
    // The evidence closes again when another change is chosen.
    fireEvent.click(entry(9));
    expect(screen.getByRole("button", { name: "View evidence" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("marks a removed row only in the original, and switches small screens to the original", () => {
    showWorkspace();
    fireEvent.click(entry(10));
    expect(activeTab("Original").textContent).toContain("Employees");
    expect(cell("Original", "A5")?.textContent).toContain("Omar Haddad");
    expect(cell("Original", "A5")?.getAttribute("data-change")).toBeTruthy();
    const smallScreens = screen.getByRole("group", { name: "Show on small screens" });
    expect(within(smallScreens).getByRole("button", { name: "original" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows an added sheet as new, and says the original has no such sheet", () => {
    showWorkspace();
    fireEvent.click(entry(11));
    expect(activeTab("Revised").textContent).toContain("Regions");
    expect(activeTab("Revised").textContent).toContain("(new)");
    expect(pane("Original").textContent).toContain("This sheet is not in this workbook.");
    expect(pane("Original").textContent).toContain("This change has no place in the original workbook.");
  });

  it("steps with Previous and Next, and stops at the ends", () => {
    showWorkspace();
    const previous = screen.getByRole("button", { name: "Previous change" });
    const next = screen.getByRole("button", { name: "Next change" });
    expect(previous).toHaveProperty("disabled", true);
    fireEvent.click(next);
    expect(counter().textContent).toBe("Change 2 of 11");
    expect(entry(2).getAttribute("aria-current")).toBe("true");
    fireEvent.click(entry(11));
    expect(next).toHaveProperty("disabled", true);
    fireEvent.click(previous);
    expect(counter().textContent).toBe("Change 10 of 11");
  });

  it("moves with the arrow keys inside the navigator", () => {
    showWorkspace();
    fireEvent.keyDown(entry(1), { key: "ArrowDown" });
    expect(counter().textContent).toBe("Change 2 of 11");
    fireEvent.keyDown(entry(2), { key: "ArrowUp" });
    expect(counter().textContent).toBe("Change 1 of 11");
  });

  it("opens the matching sheet on the other side when a sheet tab is chosen", () => {
    showWorkspace();
    const tabs = within(pane("Original")).getByRole("group", { name: "Sheets" });
    fireEvent.click(within(tabs).getByRole("button", { name: /^Employees/ }));
    expect(activeTab("Original").textContent).toContain("Employees");
    expect(activeTab("Revised").textContent).toContain("Employees");
  });
});

describe("the three views", () => {
  it("offers exactly Grid, Diff and Details", () => {
    showWorkspace();
    const tabs = within(screen.getByRole("tablist", { name: "View" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Grid", "Diff", "Details"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("Diff lists every change with its values before and after, and can go back to the grid", () => {
    showWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Diff" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(RESULT.changes.length + 1);
    expect(table.textContent).toContain("=SUM(Pricing!E2:E5)");
    expect(table.textContent).toContain("Pricing · F5 (was F4)");
    expect(table.textContent).not.toMatch(/[{}"]/);

    const row = within(table).getByRole("button", { name: "Employees · A2" }).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Show in grid" }));
    expect(screen.getByRole("tab", { name: "Grid" }).getAttribute("aria-selected")).toBe("true");
    expect(counter().textContent).toBe("Change 9 of 11");
    expect(activeTab("Revised").textContent).toContain("Employees");
  });

  it("Details states facts about both workbooks and counts each kind of change", () => {
    showWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    const original = screen.getByRole("heading", { name: "Original workbook" }).closest("section")!;
    const revised = screen.getByRole("heading", { name: "Revised workbook" }).closest("section")!;
    expect(original.textContent).toContain("Sheets4");
    expect(revised.textContent).toContain("Sheets5");
    expect(original.textContent).toContain("1900 (standard)");
    const counts = screen.getByRole("heading", { name: "What changed, counted" }).closest("section")!;
    expect(counts.textContent).toContain("Formula changes3");
  });
});

describe("the wording", () => {
  it("never ranks or judges a change", () => {
    showWorkspace();
    for (const mode of ["Grid", "Diff", "Details"]) {
      fireEvent.click(screen.getByRole("tab", { name: mode }));
      const text = (document.body.textContent ?? "").toLowerCase();
      for (const judgement of ["important", "minor", "major", "critical", "better", "worse", "risky"]) {
        expect(text).not.toContain(judgement);
      }
    }
  });
});

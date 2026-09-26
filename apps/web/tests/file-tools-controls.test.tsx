/**
 * @vitest-environment jsdom
 *
 * PDF Compare and Excel Compare: Try example, Ignore options, Reverse, Export
 * and Linked.
 *
 * The replies stand in for the engine and are its real output for the
 * built-in example files (tests/fixtures/examples), in the order each test
 * sends them. What is checked is what reaches the comparison service and what
 * the page then shows — every control has to do what it says.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExcelDesk } from "@/components/excel/ExcelDesk";
import { ExcelWorkspace } from "@/components/excel/ExcelWorkspace";
import { ComparisonReport } from "@/components/results/ComparisonReport";
import { CompareDesk } from "@/components/upload/CompareDesk";
import type { ComparisonResponse } from "@/lib/comparison";
import type { ExcelComparison } from "@/lib/excel-report";
import { EXAMPLE_FILES } from "@/lib/examples";

import { listed } from "./helpers/workspace";

vi.mock("@/lib/pdf-preview", () => ({
  inspectPdf: vi.fn(() => Promise.resolve({ ok: true, pageCount: 3, encrypted: false })),
}));

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

const EXAMPLES = join(import.meta.dirname, "..", "public", "examples");
const FIXTURES = join(import.meta.dirname, "fixtures", "examples");
const fixture = <T,>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const PDF = fixture<ComparisonResponse>("pdf.json");
const PDF_REVERSED = fixture<ComparisonResponse>("pdf-reversed.json");
const EXCEL = fixture<ExcelComparison>("excel.json");
const EXCEL_REVERSED = fixture<ExcelComparison>("excel-reversed.json");

const BYTES: Record<string, Buffer> = Object.fromEntries(
  [EXAMPLE_FILES.pdf, EXAMPLE_FILES.excel].flatMap((pair) =>
    [pair.original, pair.revised].map((file) => [file.url, readFileSync(join(EXAMPLES, file.url.replace("/examples/", "")))]),
  ),
);

/** Stands in for the upload request: records what was sent and answers with the engine's output for it. */
class FakeRequest extends EventTarget {
  static sent: { url: string; form: FormData }[] = [];
  static answer: (url: string, form: FormData) => unknown = () => ({});
  upload = new EventTarget();
  status = 0;
  responseText = "";
  url = "";
  open(_method: string, url: string) {
    this.url = url;
  }
  abort() {}
  getResponseHeader() {
    return null;
  }
  send(form: FormData) {
    FakeRequest.sent.push({ url: this.url, form });
    setTimeout(() => {
      this.status = 200;
      this.responseText = JSON.stringify(FakeRequest.answer(this.url, form));
      this.dispatchEvent(new Event("load"));
    }, 0);
  }
}

/** The engine's answer, told apart by which file came first. */
function engine(url: string, form: FormData): unknown {
  const first = (form.get("previous") ?? form.get("original")) as File;
  if (url === "/api/compare") {
    const reversed = first.size === BYTES[EXAMPLE_FILES.pdf.revised.url].length;
    const base = reversed ? PDF_REVERSED : PDF;
    return { ...base, options: { ignoreCase: form.get("ignoreCase") !== "false", ignorePunctuation: form.get("ignorePunctuation") === "true" } };
  }
  const reversed = first.size === BYTES[EXAMPLE_FILES.excel.revised.url].length;
  const base = reversed ? EXCEL_REVERSED : EXCEL;
  return { ...base, options: { ignoreCase: form.get("ignoreCase") === "true", ignoreWhitespace: form.get("ignoreWhitespace") === "true" } };
}

const saved: { name: string; text: Promise<string> }[] = [];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  FakeRequest.sent = [];
  FakeRequest.answer = engine;
  saved.length = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  vi.stubGlobal("fetch", (url: string) =>
    Promise.resolve(BYTES[url] ? new Response(new Uint8Array(BYTES[url])) : new Response(JSON.stringify({ available: true }))),
  );
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
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      saved.push({ name: "", text: blob.text() });
      return "blob:saved";
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (saved.length > 0) saved[saved.length - 1].name = this.download;
  });
});

async function start(desk: React.ReactElement, headline: RegExp) {
  await act(async () => {
    render(desk);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try example" }));
  });
  await screen.findByRole("heading", { name: headline });
}

async function applyIgnore(label: RegExp, value: boolean) {
  fireEvent.click(screen.getByRole("button", { name: /^Ignore options/ }));
  const panel = screen.getByRole("group", { name: "Ignore options" });
  const box = within(panel).getByRole("checkbox", { name: label }) as HTMLInputElement;
  if (box.checked !== value) fireEvent.click(box);
  const before = FakeRequest.sent.length;
  await act(async () => {
    fireEvent.click(within(panel).getByRole("button", { name: "Apply and compare again" }));
  });
  await waitFor(() => expect(FakeRequest.sent).toHaveLength(before + 1));
  return FakeRequest.sent[before].form;
}

async function exportAll() {
  for (const label of [/CSV/, /HTML/, /plain text/]) {
    fireEvent.click(screen.getByRole("button", { name: /^Export/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Export this comparison" })).getByRole("button", { name: label }));
  }
  return Promise.all(saved.map((file) => file.text));
}

// ---------------------------------------------------------------- PDF Compare

describe("PDF Compare", () => {
  it("serves two real example PDFs", () => {
    for (const file of [EXAMPLE_FILES.pdf.original, EXAMPLE_FILES.pdf.revised]) {
      expect(BYTES[file.url].subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("Try example loads both example files, labelled, compares them the ordinary way and explains the tool", async () => {
    await start(<CompareDesk />, /4 changes/);
    for (const name of ["Previous version", "New version"]) {
      expect(within(screen.getByRole("region", { name })).getByText("Example file")).toBeTruthy();
    }
    expect(FakeRequest.sent).toHaveLength(1);
    const { url, form } = FakeRequest.sent[0];
    expect(url).toBe("/api/compare");
    expect((form.get("previous") as File).size).toBe(BYTES[EXAMPLE_FILES.pdf.original.url].length);
    expect(form.get("ignoreCase")).toBe("true");
    expect(form.get("ignorePunctuation")).toBe("false");
    expect(screen.getByText("How this tool works")).toBeTruthy();
    expect(document.body.textContent).toContain("Total vacancies changed from 627 to 654");
    expect(listed()).toHaveLength(PDF.counts.meaningful);
  });

  it("Ignore options offer only what the engine applies, and compare again with them", async () => {
    await start(<CompareDesk />, /4 changes/);
    fireEvent.click(screen.getByRole("button", { name: /^Ignore options/ }));
    const panel = screen.getByRole("group", { name: "Ignore options" });
    const boxes = within(panel).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    expect(panel.textContent).toContain("Repeated headers, footers and page numbers");
    fireEvent.keyDown(document, { key: "Escape" });

    const form = await applyIgnore(/Ignore punctuation-only/, true);
    expect(form.get("ignorePunctuation")).toBe("true");
    expect(form.get("ignoreCase")).toBe("true");
  });

  it("Reverse swaps the two PDFs and compares again", async () => {
    await start(<CompareDesk />, /4 changes/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Reverse/ }));
    });
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(2));
    const { form } = FakeRequest.sent[1];
    expect((form.get("previous") as File).size).toBe(BYTES[EXAMPLE_FILES.pdf.revised.url].length);
    expect(screen.getByRole("region", { name: "Previous version" }).textContent).toContain(EXAMPLE_FILES.pdf.revised.name);
    await waitFor(() => expect(listed().some((label) => /654 to 627/.test(label))).toBe(true));
  });

  it("Export saves real files of the result, without AI", async () => {
    await start(<CompareDesk />, /4 changes/);
    const [csv, html, text] = await exportAll();
    expect(saved.map((file) => file.name.split(".").pop())).toEqual(["csv", "html", "txt"]);
    expect(csv.trim().split("\r\n")).toHaveLength(PDF.counts.meaningful + 1);
    for (const content of [csv, html, text]) {
      expect(content).toContain("627");
      expect(content).toContain("654");
      expect(content).toContain("Page 2");
    }
    expect(html).toContain("AI explanations are not included");
  });

  it("Linked turns the other version to the matching page, and stops when switched off", async () => {
    const files = { original: new File(["%PDF"], "a.pdf"), revised: new File(["%PDF"], "b.pdf") };
    render(<ComparisonReport result={PDF} files={files} names={{ original: "a.pdf", revised: "b.pdf" }} />);
    const toggle = screen.getByRole("button", { name: /^Linked/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const pageOf = (side: "original" | "revised") =>
      screen.getByRole("region", { name: new RegExp(`^${side === "original" ? "Original" : "Revised"} document, page \\d`) });
    const start = Number(pageOf("revised").getAttribute("aria-label")!.match(/page (\d+)/)![1]);

    fireEvent.click(screen.getByRole("button", { name: "Next page of the original document" }));
    const original = Number(pageOf("original").getAttribute("aria-label")!.match(/page (\d+)/)![1]);
    await waitFor(() => expect(pageOf("revised").getAttribute("aria-label")).toContain(`page ${original}`));

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Previous page of the original document" }));
    expect(pageOf("revised").getAttribute("aria-label")).toContain(`page ${original}`);
    expect(start).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- Excel Compare

describe("Excel Compare", () => {
  it("Try example loads both example workbooks, labelled, compares them and explains the tool", async () => {
    await start(<ExcelDesk />, /11 changes/);
    for (const name of ["Original workbook", "Revised workbook"]) {
      expect(within(screen.getByRole("region", { name })).getByText("Example file")).toBeTruthy();
    }
    const { url, form } = FakeRequest.sent[0];
    expect(url).toBe("/api/excel/compare");
    expect((form.get("original") as File).size).toBe(BYTES[EXAMPLE_FILES.excel.original.url].length);
    expect(form.get("ignoreCase")).toBe("false");
    expect(form.get("ignoreWhitespace")).toBe("false");
    expect(screen.getByText("How this tool works")).toBeTruthy();
    expect(listed()).toHaveLength(EXCEL.changes.length);
  });

  it("Ignore options compare text exactly by default, and can ignore capitalisation or extra spaces", async () => {
    await start(<ExcelDesk />, /11 changes/);
    fireEvent.click(screen.getByRole("button", { name: /^Ignore options/ }));
    const boxes = within(screen.getByRole("group", { name: "Ignore options" })).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, false]);
    fireEvent.keyDown(document, { key: "Escape" });

    const form = await applyIgnore(/Ignore extra spaces/, true);
    expect(form.get("ignoreWhitespace")).toBe("true");
    expect(form.get("ignoreCase")).toBe("false");
  });

  it("Reverse swaps the workbooks and compares again", async () => {
    await start(<ExcelDesk />, /11 changes/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Reverse/ }));
    });
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(2));
    expect((FakeRequest.sent[1].form.get("original") as File).size).toBe(BYTES[EXAMPLE_FILES.excel.revised.url].length);
    expect(screen.getByRole("region", { name: "Original workbook" }).textContent).toContain(EXAMPLE_FILES.excel.revised.name);
    await waitFor(() => expect(listed().some((label) => /\$349\.00 to \$299\.00/.test(label))).toBe(true));
  });

  it("Export saves real files of the result, without AI", async () => {
    await start(<ExcelDesk />, /11 changes/);
    const [csv, html, text] = await exportAll();
    expect(csv.trim().split("\r\n")).toHaveLength(EXCEL.changes.length + 1);
    for (const content of [csv, html, text]) {
      expect(content).toContain("$299.00");
      expect(content).toContain("$349.00");
      expect(content).toContain("Pricing · B3");
    }
  });

  it("Linked replaces the old checkbox and is on by default in the grid", () => {
    render(<ExcelWorkspace result={EXCEL} original={{ name: "a.xlsx", sizeBytes: 1 }} revised={{ name: "b.xlsx", sizeBytes: 1 }} />);
    expect(screen.queryByText("Scroll both workbooks together")).toBeNull();
    const toggle = screen.getByRole("button", { name: /^Linked/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("title")).toContain("matching row");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });
});

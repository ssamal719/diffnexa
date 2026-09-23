/**
 * @vitest-environment jsdom
 *
 * The DOCX Compare page and report.
 *
 * The promises under test: the page says exactly what it does and does not
 * compare; the button works only when both files pass the first check and the
 * service is there; every change the engine returned is on screen, in one
 * group, with its evidence; failures name the document they are about; and
 * nothing on screen ranks a change.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DocxComparePage from "@/app/docx-compare/page";
import { DocxReport } from "@/components/docx/DocxReport";
import type { DocxComparison } from "@/lib/docx-report";
import { DOCX_ERROR_MESSAGES } from "@/lib/validation";

const RESULT: DocxComparison = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "docx-comparison.json"), "utf8"),
);
const FILES = {
  original: { name: "Supplier Agreement v1.docx", sizeBytes: 36_864 },
  revised: { name: "Supplier Agreement v2.docx", sizeBytes: 37_120 },
};

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);

/** Stands in for the browser's upload request, answering with a fixed reply. */
class FakeRequest extends EventTarget {
  static reply: { status: number; body: unknown } = { status: 200, body: RESULT };
  static sent: FormData[] = [];
  upload = new EventTarget();
  status = 0;
  responseText = "";
  open() {}
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
  choose("Original document", ZIP, "Contract v1.docx");
  choose("Revised document", ZIP, "Contract v2.docx");
  await waitFor(() => expect(screen.getByRole("button", { name: "Compare documents" })).toHaveProperty("disabled", false));
}

describe("the page", () => {
  it("names the tool and says what it does", () => {
    render(<DocxComparePage />);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["DOCX Compare"]);
    expect(document.body.textContent).toContain(
      "Compare two Word documents and see exactly what changed, with evidence you can verify.",
    );
  });

  it("labels the two uploads as agreed", () => {
    render(<DocxComparePage />);
    expect(screen.getByRole("region", { name: "Original document" }).textContent).toContain(
      "Choose the earlier DOCX",
    );
    expect(screen.getByRole("region", { name: "Revised document" }).textContent).toContain(
      "Choose the newer DOCX",
    );
  });

  it("states the limits plainly: DOCX only, not stored, no visual comparison", () => {
    render(<DocxComparePage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Word .docx files only.");
    expect(text).toContain("not stored as account history");
    expect(text).toContain("Visual formatting and images are not compared in this version.");
  });

  it("never claims visual comparison, legacy .doc support or AI analysis", () => {
    render(<DocxComparePage />);
    const text = (document.body.textContent ?? "").toLowerCase();
    expect(text).not.toMatch(/(compares?|comparing) (the )?(images|fonts|layout|screenshots)/);
    expect(text).not.toMatch(/supports? (older |legacy )?\.doc\b/);
    expect(text).not.toMatch(/ai[- ](powered|analysis|summary)/);
  });

  it("keeps the button disabled until both documents are ready", async () => {
    render(<DocxComparePage />);
    const button = screen.getByRole("button", { name: "Compare documents" });
    expect(button).toHaveProperty("disabled", true);
    choose("Original document", ZIP, "a.docx");
    await screen.findByText("a.docx");
    expect(button).toHaveProperty("disabled", true);
  });
});

describe("the first check on each file", () => {
  it.each([
    ["a PDF", new TextEncoder().encode("%PDF-1.7 …"), "docx_not_docx"],
    ["an older .doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), "docx_legacy_doc"],
    ["an empty file", new Uint8Array(0), "docx_empty_file"],
  ] as const)("refuses %s with the shared message", async (_name, bytes, code) => {
    render(<DocxComparePage />);
    choose("Original document", bytes, "file.docx");
    expect(await screen.findByText(DOCX_ERROR_MESSAGES[code])).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare documents" })).toHaveProperty("disabled", true);
  });
});

describe("comparing", () => {
  it("sends both files and shows every change the engine found", async () => {
    render(<DocxComparePage />);
    await chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Compare documents" }));

    expect(await screen.findByRole("heading", { name: "11 changes found" })).toBeTruthy();
    const sent = FakeRequest.sent[0];
    expect(sent.get("original")).toBeInstanceOf(File);
    expect(sent.get("revised")).toBeInstanceOf(File);
    expect(screen.getAllByRole("article")).toHaveLength(RESULT.changes.length);
  });

  it("shows the no-change result in the agreed words", async () => {
    FakeRequest.reply = {
      status: 200,
      body: {
        ...RESULT,
        changes: [],
        counts: { total: 0, meaningful: 0, noise: 0 },
        groups: RESULT.groups.map((group) => ({ ...group, changeCount: 0, changeIds: [] })),
      },
    };
    render(<DocxComparePage />);
    await chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Compare documents" }));
    expect(await screen.findByRole("heading", { name: "No changes found" })).toBeTruthy();
    expect(screen.getByText("This document says the same as the original.")).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("names the document a refusal is about", async () => {
    FakeRequest.reply = {
      status: 400,
      body: {
        error: {
          code: "docx_tracked_changes",
          message: DOCX_ERROR_MESSAGES.docx_tracked_changes,
          side: "revised",
        },
      },
    };
    render(<DocxComparePage />);
    await chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Compare documents" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This is about your revised document.");
    expect(alert.textContent).toContain(DOCX_ERROR_MESSAGES.docx_tracked_changes);
  });

  it("does not blame a document when the service is down", async () => {
    FakeRequest.reply = {
      status: 503,
      body: { error: { code: "engine_unavailable", message: "x", side: null } },
    };
    render(<DocxComparePage />);
    await chooseBoth();
    fireEvent.click(screen.getByRole("button", { name: "Compare documents" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The comparison service isn't reachable");
    expect(alert.textContent).not.toContain("This is about your");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("the report", () => {
  it("shows the headline, both documents and a count for each group", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    expect(screen.getByRole("heading", { name: "11 changes found" })).toBeTruthy();
    expect(document.body.textContent).toContain("Supplier Agreement v1.docx");
    expect(document.body.textContent).toContain("Supplier Agreement v2.docx");
    const chips = screen.getAllByRole("button", { pressed: false }).map((button) => button.textContent);
    expect(chips).toContain("Tables: 2 changes.");
    expect(chips).toContain("Other: 2 changes.");
  });

  it("lists every change in exactly one group", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(RESULT.changes.length);
    for (const group of RESULT.groups.filter((item) => item.changeCount > 0)) {
      const heading = screen.getByRole("heading", { name: new RegExp(`^${group.label} · ${group.changeCount} change`) });
      expect(heading).toBeTruthy();
    }
  });

  it("filters to one group and back", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    fireEvent.click(screen.getByRole("button", { name: /^Tables/ }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(RESULT.changes.length);
  });

  it("shows before, after and the difference for a changed amount in a table", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    const card = screen.getByRole("article", { name: /Number in a table changed/ });
    expect(card.textContent).toContain("$10,000");
    expect(card.textContent).toContain("$12,000");
    expect(card.textContent).toContain("+2000 (+20%)");
    expect(card.textContent).toContain("Revised: Table 1, row 2, column 2");
  });

  it("opens the evidence, quoted from each document with where it is", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    const card = screen.getByRole("article", { name: /Date changed/ });
    fireEvent.click(within(card).getByRole("button", { name: "View evidence" }));
    expect(card.textContent).toContain("Original document");
    expect(card.textContent).toContain("Revised document");
    expect(card.textContent).toContain("Paragraph 4: ");
    expect(card.textContent).toContain("15 March 2026");
    expect(card.textContent).toContain("30 March 2026");
  });

  it("moves between changes with previous and next", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    expect(screen.getByText(/Change 1 of 11/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByText(/Change 2 of 11/)).toBeTruthy();
  });

  it("never ranks or judges a change", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const judgement of [
      "important", "minor", "major", "critical", "better", "worse", "risky", "favorable", "unfavorable",
    ]) {
      expect(text).not.toContain(judgement);
    }
  });

  it("says what was not compared", () => {
    render(<DocxReport result={RESULT} {...FILES} />);
    expect(document.body.textContent).toContain(
      "Visual formatting, images, headers, footers, footnotes and comments are not compared.",
    );
  });
});

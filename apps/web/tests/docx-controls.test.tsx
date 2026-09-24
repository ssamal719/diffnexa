/**
 * @vitest-environment jsdom
 *
 * DOCX Compare's comparison controls: Try example, Ignore options, Reverse,
 * Export and Linked scrolling.
 *
 * The replies stand in for the engine and are its real output for the
 * built-in example documents (tests/fixtures/docx-example*.json), for the
 * files in the order and with the options each test sends. What is checked is
 * what reaches the comparison service and what the page then shows — each
 * control has to do what it says.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOCX_EXAMPLE, DocxDesk } from "@/components/docx/DocxDesk";
import { DocxReport } from "@/components/docx/DocxReport";
import { ComparisonControls, LinkedToggle } from "@/components/workspace/WorkspaceControls";
import { docxExportFormats, docxExportReport } from "@/lib/docx-export";
import type { DocxComparison } from "@/lib/docx-report";

import { listed, navigator } from "./helpers/workspace";

const FIXTURES = join(import.meta.dirname, "fixtures");
const EXAMPLES = join(import.meta.dirname, "..", "public", "examples");

function fixture(name: string): DocxComparison {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

const EXAMPLE = fixture("docx-example.json");
const REVERSED = fixture("docx-example-reversed.json");
const CASE_SENSITIVE = fixture("docx-example-case-sensitive.json");
const ORIGINAL_BYTES = readFileSync(join(EXAMPLES, "service-agreement-original.docx"));
const REVISED_BYTES = readFileSync(join(EXAMPLES, "service-agreement-revised.docx"));

/** Stands in for the browser's upload request; answers with the engine's output for what was sent. */
class FakeRequest extends EventTarget {
  static sent: FormData[] = [];
  static answer: (form: FormData) => unknown = () => EXAMPLE;
  upload = new EventTarget();
  status = 0;
  responseText = "";
  open() {}
  abort() {}
  getResponseHeader() {
    return null;
  }
  send(body: FormData) {
    FakeRequest.sent.push(body);
    setTimeout(() => {
      this.status = 200;
      this.responseText = JSON.stringify(FakeRequest.answer(body));
      this.dispatchEvent(new Event("load"));
    }, 0);
  }
}

/** The engine's output for the files and options in a request, told apart by the files' sizes. */
function engineFor(form: FormData): DocxComparison {
  const original = form.get("original") as File;
  const reversed = original.size === REVISED_BYTES.length;
  if (reversed) return REVERSED;
  return form.get("ignoreCase") === "false" ? CASE_SENSITIVE : EXAMPLE;
}

const saved: { name: string; type: string; text: Promise<string> }[] = [];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  FakeRequest.sent = [];
  FakeRequest.answer = engineFor;
  saved.length = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  vi.stubGlobal("fetch", (url: string) => {
    if (url === DOCX_EXAMPLE.original.url) return Promise.resolve(new Response(ORIGINAL_BYTES));
    if (url === DOCX_EXAMPLE.revised.url) return Promise.resolve(new Response(REVISED_BYTES));
    return Promise.resolve(new Response(JSON.stringify({ available: true })));
  });
  Element.prototype.scrollIntoView = vi.fn();
  // Capture files handed to the browser to save: the file when its address is made, its name when the link is clicked.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      saved.push({ name: "", type: blob.type, text: blob.text() });
      return "blob:saved";
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (saved.length > 0 && this.href.startsWith("blob:")) saved[saved.length - 1].name = this.download;
  });
});

function slot(name: string) {
  return screen.getByRole("region", { name: `${name} upload` });
}

async function runExample() {
  // Rendered inside act so the check on the comparison service has finished.
  await act(async () => {
    render(<DocxDesk />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try example" }));
  });
  await screen.findByText(/7 changes found/);
}

describe("Try example", () => {
  it("is offered without an account, beside the compare button, and says what it loads", () => {
    render(<DocxDesk />);
    const button = screen.getByRole("button", { name: "Try example" });
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    const note = document.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(note.textContent).toContain("fictional versions of a services agreement");
    expect(note.textContent).toContain("no account");
  });

  it("serves two genuine Word documents with the site", () => {
    for (const bytes of [ORIGINAL_BYTES, REVISED_BYTES]) {
      expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
      expect(bytes.includes(Buffer.from("word/document.xml"))).toBe(true);
    }
    expect(ORIGINAL_BYTES.equals(REVISED_BYTES)).toBe(false);
  });

  it("loads the example files into both slots, labelled as examples, and compares them the ordinary way", async () => {
    await runExample();
    expect(slot("Original document").textContent).toContain(DOCX_EXAMPLE.original.name);
    expect(slot("Revised document").textContent).toContain(DOCX_EXAMPLE.revised.name);
    expect(within(slot("Original document")).getByText("Example file")).toBeTruthy();
    expect(within(slot("Revised document")).getByText("Example file")).toBeTruthy();

    // One request, the same one an upload makes: both files and the default options.
    expect(FakeRequest.sent).toHaveLength(1);
    const form = FakeRequest.sent[0];
    expect((form.get("original") as File).size).toBe(ORIGINAL_BYTES.length);
    expect((form.get("revised") as File).size).toBe(REVISED_BYTES.length);
    expect(form.get("ignoreCase")).toBe("true");
    expect(form.get("ignorePunctuation")).toBe("false");

    // The result is the engine's: every change, with pages from the files' own layout.
    expect(listed()).toHaveLength(EXAMPLE.changes.length);
    expect(navigator().textContent).toContain("Page 1");
    expect(navigator().textContent).toContain("Page 2");
    expect(document.body.textContent).toContain("£2,500");
    expect(document.body.textContent).toContain("£2,750");
  });

  it("can be replaced by the person's own file", async () => {
    await runExample();
    const input = slot("Original document").querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0])], "Mine.docx")] },
    });
    await within(slot("Original document")).findByText("Mine.docx");
    expect(within(slot("Original document")).queryByText("Example file")).toBeNull();
    expect(within(slot("Revised document")).getByText("Example file")).toBeTruthy();
    // A result never stays beside different files.
    expect(screen.queryByText(/7 changes found/)).toBeNull();
  });

  it("says so when the example cannot be loaded", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(url.startsWith("/examples/") ? new Response("", { status: 404 }) : new Response('{"available":true}')),
    );
    render(<DocxDesk />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try example" }));
    });
    expect(await screen.findByText("The example couldn't be loaded")).toBeTruthy();
    expect(FakeRequest.sent).toHaveLength(0);
  });
});

describe("Reverse", () => {
  it("swaps the files, compares again, and updates the direction, counts and evidence", async () => {
    await runExample();
    const header = () => screen.getByRole("region", { name: /changes found/ });
    expect(header().textContent).toContain(DOCX_EXAMPLE.original.name);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Reverse/ }));
    });
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(2));
    const form = FakeRequest.sent[1];
    expect((form.get("original") as File).size).toBe(REVISED_BYTES.length);
    expect((form.get("revised") as File).size).toBe(ORIGINAL_BYTES.length);

    // The slots say which file is which now.
    expect(slot("Original document").textContent).toContain(DOCX_EXAMPLE.revised.name);
    expect(slot("Revised document").textContent).toContain(DOCX_EXAMPLE.original.name);

    // An addition in one direction is a removal in the other.
    await waitFor(() => expect(listed()).toHaveLength(REVERSED.changes.length));
    const added = EXAMPLE.changes.filter((change) => change.kind === "added").length;
    const removedNow = REVERSED.changes.filter((change) => change.kind === "removed").length;
    expect(removedNow).toBe(added);
    expect(listed().some((label) => /Text removed/.test(label) && /subcontractor/.test(label))).toBe(true);
    expect(listed().some((label) => /£2,750 to £2,500/.test(label))).toBe(true);

    // Reversing twice is the original comparison again, and no file is lost.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Reverse/ }));
    });
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(3));
    expect((FakeRequest.sent[2].get("original") as File).size).toBe(ORIGINAL_BYTES.length);
    await waitFor(() => expect(listed().some((label) => /£2,500 to £2,750/.test(label))).toBe(true));
  });

  it("keeps the Ignore options the comparison used", async () => {
    await runExample();
    await applyIgnore({ "Ignore punctuation-only changes": true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Reverse/ }));
    });
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(3));
    expect(FakeRequest.sent[2].get("ignorePunctuation")).toBe("true");
  });
});

async function applyIgnore(choices: Record<string, boolean>) {
  fireEvent.click(screen.getByRole("button", { name: /^Ignore options/ }));
  const panel = screen.getByRole("group", { name: "Ignore options" });
  for (const [label, value] of Object.entries(choices)) {
    const box = within(panel).getByRole("checkbox", { name: new RegExp(label) }) as HTMLInputElement;
    if (box.checked !== value) fireEvent.click(box);
  }
  const before = FakeRequest.sent.length;
  await act(async () => {
    fireEvent.click(within(panel).getByRole("button", { name: "Apply and compare again" }));
  });
  await waitFor(() => expect(FakeRequest.sent).toHaveLength(before + 1));
}

describe("Ignore options", () => {
  it("offers only what the engine implements, ticked as the comparison on screen applied them", async () => {
    await runExample();
    fireEvent.click(screen.getByRole("button", { name: /^Ignore options/ }));
    const panel = screen.getByRole("group", { name: "Ignore options" });
    const boxes = within(panel).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.labels?.[0]?.textContent?.split("“")[0].trim().replace(/\.$/, ""))).toEqual([
      expect.stringContaining("Ignore capitalisation"),
      expect.stringContaining("Ignore punctuation-only changes"),
    ]);
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    // What is always ignored, and what is never compared, are stated — not offered as options.
    expect(panel.textContent).toContain("Always ignored");
    expect(panel.textContent).toContain("Not compared by this tool");
    expect(panel.textContent).toContain("Images");
    // Nothing to apply until something changes.
    expect(within(panel).getByRole("button", { name: "Apply and compare again" })).toHaveProperty("disabled", true);
  });

  it("compares again with capitalisation counted, and shows the change it had ignored", async () => {
    await runExample();
    expect(listed()).toHaveLength(7);
    await applyIgnore({ "Ignore capitalisation": false });
    expect(FakeRequest.sent[1].get("ignoreCase")).toBe("false");
    await waitFor(() => expect(listed()).toHaveLength(CASE_SENSITIVE.changes.length));
    expect(document.body.textContent).toContain("capitalisation compared");
    fireEvent.click(screen.getByRole("button", { name: /^Ignore options/ }));
    const box = within(screen.getByRole("group", { name: "Ignore options" })).getByRole("checkbox", {
      name: /Ignore capitalisation/,
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it("closes with Escape and returns focus to its button", async () => {
    await runExample();
    const button = screen.getByRole("button", { name: /^Ignore options/ });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });
});

describe("Export", () => {
  it("offers only the formats it can build, and each saves a real file of the result", async () => {
    await runExample();
    const button = screen.getByRole("button", { name: /^Export/ });
    fireEvent.click(button);
    const panel = screen.getByRole("group", { name: "Export this comparison" });
    const formats = within(panel).getAllByRole("button").map((item) => item.textContent ?? "");
    expect(formats.map((text) => text.split(/\(|\)/)[1])).toEqual(["CSV", "HTML", "plain text"]);
    expect(panel.textContent).not.toMatch(/\bPDF\b(?! from your browser)|\bWord\b|\.docx/);
    fireEvent.keyDown(document, { key: "Escape" });

    for (const label of [/CSV/, /HTML/, /plain text/]) {
      fireEvent.click(screen.getByRole("button", { name: /^Export/ }));
      fireEvent.click(within(screen.getByRole("group", { name: "Export this comparison" })).getByRole("button", { name: label }));
    }
    expect(saved.map((file) => file.name.split(".").pop())).toEqual(["csv", "html", "txt"]);
    const [csv, html, text] = await Promise.all(saved.map((file) => file.text));
    // One row per change, with where it is and both values.
    expect(csv.trim().split("\r\n")).toHaveLength(EXAMPLE.changes.length + 1);
    for (const content of [csv, html, text]) {
      expect(content).toContain("£2,500");
      expect(content).toContain("£2,750");
      expect(content).toContain("Page 2");
    }
    for (const content of [html, text]) expect(content).toContain(DOCX_EXAMPLE.original.name);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Export/ }));
  });

  it("is built only from the comparison, never from AI", () => {
    const report = docxExportReport(EXAMPLE, { name: "a.docx" }, { name: "b.docx" }, new Date("2026-09-01T10:00:00Z"));
    expect(report.rows).toHaveLength(EXAMPLE.changes.length);
    for (const row of report.rows) {
      const change = EXAMPLE.changes[row.number - 1];
      expect(row.before).toBe(change.oldValue ?? "");
      expect(row.after).toBe(change.newValue ?? "");
    }
    expect(JSON.stringify(report).toLowerCase()).not.toMatch(/explanation|importance|critical|ai summary/);
    const formats = docxExportFormats(EXAMPLE, { name: "a.docx" }, { name: "b.docx" });
    expect(formats.map((format) => format.id)).toEqual(["csv", "html", "text"]);
  });
});

describe("Linked scrolling", () => {
  function panes() {
    return {
      original: screen.getByRole("region", { name: "Original document, as compared" }),
      revised: screen.getByRole("region", { name: "Revised document, as compared" }),
    };
  }

  /** jsdom has no layout: every block is 100px tall, stacked in order in its pane. */
  function layOut() {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(10_000);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const pane = this.closest('[role="region"][aria-label$="as compared"]');
      const box = (top: number) => ({ top, bottom: top + 100, height: 100, left: 0, right: 600, width: 600, x: 0, y: top }) as DOMRect;
      if (!pane || pane === this) return box(0);
      const blocks = [...pane.querySelectorAll("[data-node-id]")];
      return box(blocks.indexOf(this) * 100 - (pane as HTMLElement).scrollTop);
    });
  }

  it("is on by default in the side-by-side view, and moves the other version to the matching paragraph", () => {
    layOut();
    render(<DocxReport result={EXAMPLE} original={{ name: "a.docx", sizeBytes: 1 }} revised={{ name: "b.docx", sizeBytes: 1 }} />);
    const toggle = screen.getByRole("button", { name: /^Linked/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    vi.spyOn(performance, "now").mockReturnValue(1e12); // past the pause after choosing a change
    const { original, revised } = panes();
    // The heading "3. Intellectual property" is one block further down the original than the
    // revised, because the revision removes a paragraph before it.
    const heading = (pane: HTMLElement) =>
      [...pane.querySelectorAll("[data-node-id]")].findIndex((block) => block.textContent === "3. Intellectual property");
    expect(heading(original) - heading(revised)).toBe(1);
    original.scrollTop = heading(original) * 100;
    fireEvent.scroll(original);
    expect(revised.scrollTop).toBe(heading(revised) * 100);
  });

  it("leaves the other version alone when switched off", () => {
    layOut();
    render(<DocxReport result={EXAMPLE} original={{ name: "a.docx", sizeBytes: 1 }} revised={{ name: "b.docx", sizeBytes: 1 }} />);
    const toggle = screen.getByRole("button", { name: /^Linked/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toContain("Off");
    vi.spyOn(performance, "now").mockReturnValue(1e12);
    const { original, revised } = panes();
    original.scrollTop = 1200;
    fireEvent.scroll(original);
    expect(revised.scrollTop).toBe(0);
  });

  it("is not offered in the list view, where there is nothing to link", () => {
    render(<DocxReport result={EXAMPLE} original={{ name: "a.docx", sizeBytes: 1 }} revised={{ name: "b.docx", sizeBytes: 1 }} />);
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.queryByRole("button", { name: /^Linked/ })).toBeNull();
  });

  it("says what it does", () => {
    const onChange = vi.fn();
    render(<LinkedToggle linked onChange={onChange} />);
    const toggle = screen.getByRole("button", { name: /Linked/ });
    expect(toggle.getAttribute("title")).toContain("matching paragraph");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("the controls bar", () => {
  it("draws nothing for a tool that offers no controls", () => {
    const { container } = render(<ComparisonControls />);
    expect(container.innerHTML).toBe("");
    render(<DocxReport result={EXAMPLE} original={{ name: "a.docx", sizeBytes: 1 }} revised={{ name: "b.docx", sizeBytes: 1 }} />);
    expect(screen.queryByRole("group", { name: "Comparison controls" })).toBeNull();
  });

  it("wraps onto more lines rather than overflowing a narrow screen", async () => {
    await runExample();
    const bar = screen.getByRole("group", { name: "Comparison controls" });
    expect(bar.className).toContain("flex-wrap");
  });

  it("keeps an opened panel on screen, wherever its button is", async () => {
    await runExample();
    const width = window.innerWidth;
    const place = (left: number) => {
      window.innerWidth = 375;
      const button = screen.getByRole("button", { name: /^Export/ });
      vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ left, right: left + 80, top: 0, bottom: 30 } as DOMRect);
      fireEvent.click(button);
      const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
      const shift = parseFloat(panel.style.left);
      fireEvent.keyDown(document, { key: "Escape" });
      return shift;
    };
    // The panel is 352px wide at most; on a 375px screen it keeps 8px clear of both edges.
    expect(left(300, place(300))).toBe(375 - 8 - 352);
    expect(left(4, place(4))).toBe(8);
    window.innerWidth = width;
  });
});

function left(buttonLeft: number, shift: number): number {
  return buttonLeft + shift;
}

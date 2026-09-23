/**
 * @vitest-environment jsdom
 *
 * The Website Change Detector interface, rendered and driven the way a person
 * would drive it. These cover what pure logic cannot: that the first screen
 * explains itself, that errors say the right thing, that evidence is one click
 * away, and that controls have names a screen reader can announce.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebError } from "@/components/website/WebError";
import { WebReport } from "@/components/website/WebReport";
import { WebsiteDesk } from "@/components/website/WebsiteDesk";
import type { WebChange, WebComparison } from "@/lib/web-report";

import { counter, evidence, filterBy, listed, navigator } from "./helpers/workspace";

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

const BASELINE = {
  schema_version: "1",
  source: {
    url: "https://example.com/pricing",
    final_url: "https://example.com/pricing",
    fetched_at: "2026-03-12T09:30:00+00:00",
  },
  metadata: { title: "Pricing — Example" },
  nodes: [],
  content_sha256: "c".repeat(64),
};

function change(overrides: Partial<WebChange> = {}): WebChange {
  return {
    id: "c0",
    seq: 0,
    type: "NUMBER_CHANGED",
    kind: "modified",
    category: "number",
    subtype: null,
    label: "Standard plan",
    oldValue: "$49/month",
    newValue: "$59/month",
    delta: "+$10",
    confidence: 1,
    isNoise: false,
    noiseReason: null,
    sections: ["Pricing › Starter"],
    evidence: [
      { side: "old", scope: "node", nodeId: "n3", path: "main > p", sectionPath: ["Pricing", "Starter"], field: null, excerpt: "The Starter plan costs $49/month." },
      { side: "new", scope: "node", nodeId: "n3", path: "main > p", sectionPath: ["Pricing", "Starter"], field: null, excerpt: "The Starter plan costs $59/month." },
    ],
    ...overrides,
  };
}

function comparison(changes: WebChange[]): WebComparison {
  return {
    engineVersion: "test",
    processingMs: 800,
    documents: {
      previous: { url: "https://example.com/pricing", sha256: "a".repeat(64) },
      revised: { url: "https://example.com/pricing", sha256: "b".repeat(64) },
    },
    counts: { total: changes.length, meaningful: changes.filter((c) => !c.isNoise).length, noise: 0 },
    changes,
    diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
  };
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
}

// ---------------------------------------------------------------- first run

describe("the first screen", () => {
  it("offers capturing a page and explains what a baseline is for", () => {
    render(<WebsiteDesk />);
    expect(screen.getByRole("button", { name: "Capture baseline" })).toBeTruthy();
    expect(screen.getByLabelText("Web page address")).toBeTruthy();
    expect(document.body.textContent).toContain("baseline");
    expect(document.body.textContent).toContain("what has changed");
  });

  it("uses no implementation words anywhere on screen", () => {
    render(<WebsiteDesk />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const jargon of ["snapshot model", "contentnode", "ssrf", "dom", "endpoint", "api ", "engine"]) {
      expect(text).not.toContain(jargon);
    }
  });

  it("lets a returning visitor switch to checking for changes", () => {
    render(<WebsiteDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    expect(screen.getByRole("button", { name: "Check for changes", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check this page now" })).toBeTruthy();
    expect(screen.getByText("Choose baseline file")).toBeTruthy();
  });
});

// ---------------------------------------------------------------- validation

describe("address validation", () => {
  it("explains an empty address without calling the server", async () => {
    const calls = vi.fn();
    vi.stubGlobal("fetch", calls);
    render(<WebsiteDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Enter the address");
    expect(calls).not.toHaveBeenCalled();
  });

  it("explains a local address in plain words", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<WebsiteDesk />);
    fireEvent.change(screen.getByLabelText("Web page address"), { target: { value: "http://localhost:3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("publicly on the internet");
  });

  it("refuses to compare without a baseline file", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<WebsiteDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    fireEvent.change(screen.getByLabelText("Web page address"), { target: { value: "example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));

    expect((await screen.findByRole("alert")).textContent).toContain("baseline file");
  });
});

// ---------------------------------------------------------------- baseline

describe("capturing a baseline", () => {
  it("confirms the capture and offers the download", async () => {
    stubFetch(200, { snapshot: BASELINE });
    render(<WebsiteDesk />);
    fireEvent.change(screen.getByLabelText("Web page address"), { target: { value: "example.com/pricing" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    expect(await screen.findByText("Baseline captured")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pricing — Example" })).toBeTruthy();
    expect(screen.getByText("https://example.com/pricing")).toBeTruthy();
    expect(document.body.textContent).toMatch(/2026/);
    expect(screen.getByRole("button", { name: "Download baseline" })).toBeTruthy();
    expect(document.body.textContent).toContain("not an account");
  });

  it("downloads the baseline as a file when asked", async () => {
    stubFetch(200, { snapshot: BASELINE });
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));

    render(<WebsiteDesk />);
    fireEvent.change(screen.getByLabelText("Web page address"), { target: { value: "example.com/pricing" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download baseline" }));

    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- errors

describe("error messages", () => {
  it.each([
    ["url_not_allowed", "can't be checked"],
    ["url_unreachable", "couldn't reach"],
    ["url_not_html", "isn't a web page"],
    ["page_needs_javascript", "builds its content in the browser"],
    ["page_too_large", "too large"],
    ["snapshot_mismatch", "different page"],
    ["snapshot_unreadable", "isn't a DiffNexa baseline"],
    ["fetch_timeout", "too long"],
    ["engine_unavailable", "Nothing is wrong with the address"],
  ])("explains %s helpfully", (code, expected) => {
    render(<WebError failure={{ code, message: "raw internal detail" }} />);
    expect(screen.getByRole("alert").textContent).toContain(expected);
  });

  it("never calls a working page damaged", () => {
    for (const code of ["url_unreachable", "page_needs_javascript", "engine_unavailable", "fetch_timeout"]) {
      cleanup();
      render(<WebError failure={{ code, message: "" }} />);
      expect(screen.getByRole("alert").textContent?.toLowerCase()).not.toContain("damaged");
      expect(screen.getByRole("alert").textContent?.toLowerCase()).not.toContain("corrupt");
    }
  });

  it("shows a failure from the server rather than a result", async () => {
    stubFetch(400, { error: { code: "page_needs_javascript", message: "x" } });
    render(<WebsiteDesk />);
    fireEvent.change(screen.getByLabelText("Web page address"), { target: { value: "example.com/app" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("builds its content in the browser"),
    );
  });
});

// ---------------------------------------------------------------- the report

describe("the report", () => {
  it("summarises what changed, in sections", () => {
    render(<WebReport result={comparison([change()])} url="https://example.com/pricing" />);
    expect(screen.getByRole("heading", { name: "1 change across 1 section" })).toBeTruthy();
    expect(screen.getByText("Comparison complete · Website Change Detector")).toBeTruthy();
  });

  it("says plainly when nothing changed", () => {
    render(<WebReport result={comparison([])} url="https://example.com/pricing" />);
    expect(screen.getByRole("heading", { name: "No changes found" })).toBeTruthy();
    expect(document.body.textContent).toContain("says the same as it did");
  });

  it("shows a price change with before, after and the difference", () => {
    render(<WebReport result={comparison([change()])} url="https://example.com/pricing" />);
    const panel = evidence();
    expect(within(panel).getByText("Number changed")).toBeTruthy();
    expect(within(panel).getByText("$49/month")).toBeTruthy();
    expect(within(panel).getByText("$59/month")).toBeTruthy();
    expect(within(panel).getByText("+$10")).toBeTruthy();
    expect(document.body.textContent).not.toContain("NUMBER_CHANGED");
  });

  it("shows a table cell change without claiming the table was rewritten", () => {
    const cell = change({
      subtype: "table_cell", label: "Premium · Price",
      oldValue: "$90,000", newValue: "$95,000", delta: "+$5,000 (+5.56%)",
    });
    render(<WebReport result={comparison([cell])} url="https://example.com/pricing" />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("Table value changed")).toBeTruthy();
    expect(within(card).getByText("Premium · Price")).toBeTruthy();
    expect(within(evidence()).getByText("+$5,000 (+5.56%)")).toBeTruthy();
  });

  it("shows a page-details change", () => {
    const meta = change({
      category: "metadata", subtype: "title", oldValue: "Old title", newValue: "New title",
      delta: null, sections: [], label: "Page title",
      evidence: [
        { side: "old", scope: "document", nodeId: null, path: null, sectionPath: [], field: "metadata.title", excerpt: "Old title" },
        { side: "new", scope: "document", nodeId: null, path: null, sectionPath: [], field: "metadata.title", excerpt: "New title" },
      ],
    });
    render(<WebReport result={comparison([meta])} url="https://example.com/pricing" />);
    expect(within(evidence()).getByRole("heading", { name: /Page title/ })).toBeTruthy();
    expect(within(evidence()).getByText("Whole page")).toBeTruthy();
  });

  it("keeps evidence one click away", async () => {
    render(<WebReport result={comparison([change()])} url="https://example.com/pricing" />);
    const card = screen.getByRole("article");
    expect(within(card).queryByText(/The Starter plan costs \$49/)).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: "View evidence" }));
    expect(await within(card).findByText(/The Starter plan costs \$49/)).toBeTruthy();
    expect(within(card).getByText(/The Starter plan costs \$59/)).toBeTruthy();
    expect(card.textContent).toContain("Taken directly from the page");
  });

  it("shows the evidence for the chosen change beside it, quoted from both versions", () => {
    render(<WebReport result={comparison([change()])} url="https://example.com/pricing" />);
    const panel = evidence();
    expect(panel.textContent).toContain("Comparison evidence");
    expect(within(panel).getByText(/The Starter plan costs \$49/)).toBeTruthy();
    expect(within(panel).getByText(/The Starter plan costs \$59/)).toBeTruthy();
    expect(panel.textContent).toContain("Pricing › Starter");
    // AI is a separate, optional section, and says nothing until asked.
    expect(panel.textContent).toContain("AI explanation");
    expect(panel.textContent).toContain("Not requested");
  });

  it("groups changes under the page's own headings", () => {
    const result = comparison([
      change({ id: "a", seq: 0, sections: ["Pricing › Starter"] }),
      change({ id: "b", seq: 1, sections: ["FAQ"] }),
    ]);
    render(<WebReport result={result} url="https://example.com/pricing" />);
    expect(screen.getByText("Where the changes are")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Pricing\s*\d/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^FAQ\s*\d/ })).toBeTruthy();
    // The navigator uses the same headings, and never a page number.
    expect(within(navigator()).getAllByText("Pricing").length).toBeGreaterThan(0);
    expect(within(navigator()).getAllByText("FAQ").length).toBeGreaterThan(0);
    expect(navigator().textContent).not.toMatch(/Page \d/);
  });

  it("filters to a section when one is chosen", () => {
    const result = comparison([
      change({ id: "a", seq: 0, sections: ["Pricing › Starter"], oldValue: "$49/month", newValue: "$59/month" }),
      change({ id: "b", seq: 1, sections: ["FAQ"], oldValue: "ten days", newValue: "five days", category: "text", delta: null }),
    ]);
    render(<WebReport result={result} url="https://example.com/pricing" />);
    fireEvent.click(screen.getByRole("button", { name: /^FAQ\s*\d/ }));

    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain("five days");
    expect(screen.queryAllByRole("article")).toHaveLength(1);
  });

  it("filters by category, and clearing brings every change back", () => {
    const result = comparison([
      change({ id: "a", seq: 0 }),
      change({ id: "b", seq: 1, category: "link", oldValue: "https://a.example", newValue: "https://b.example", delta: null }),
    ]);
    render(<WebReport result={result} url="https://example.com/pricing" />);
    filterBy("What changed", /^Links/);

    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain("Link now points elsewhere");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(listed()).toHaveLength(2);
  });

  it("offers only the kinds of change that were found", () => {
    render(<WebReport result={comparison([change()])} url="https://example.com/pricing" />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const kinds = within(screen.getByRole("group", { name: "What changed" })).getAllByRole("button");
    expect(kinds.map((button) => button.textContent)).toEqual(["Numbers 1 change"]);
  });

  it("searches the changes", () => {
    const result = comparison([
      change({ id: "a", seq: 0 }),
      change({ id: "b", seq: 1, category: "text", oldValue: "thirty days", newValue: "fourteen days", delta: null, label: null }),
    ]);
    render(<WebReport result={result} url="https://example.com/pricing" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "fourteen" } });

    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain("fourteen days");
  });

  it("lets a reader step through the changes", () => {
    const result = comparison([change({ id: "a", seq: 0 }), change({ id: "b", seq: 1 })]);
    render(<WebReport result={result} url="https://example.com/pricing" />);

    expect(counter()).toContain("Change 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(counter()).toContain("Change 2 of 2");
  });

  it("keeps the filter context while navigating", () => {
    const result = comparison([
      change({ id: "a", seq: 0 }),
      change({ id: "b", seq: 1 }),
      change({ id: "c", seq: 2, category: "link", oldValue: "https://a.example", newValue: "https://b.example", delta: null }),
    ]);
    render(<WebReport result={result} url="https://example.com/pricing" />);
    filterBy("What changed", /^Numbers/);

    expect(counter()).toContain("of 2 shown");
    expect(counter()).toContain("3 in total");
  });

  it("sets unimportant differences aside, and shows them when asked", () => {
    const result = comparison([
      change({ id: "a", seq: 0 }),
      change({ id: "b", seq: 1, isNoise: true, noiseReason: "A visitor counter", oldValue: "10", newValue: "11", delta: null }),
    ]);
    render(<WebReport result={result} url="https://example.com/pricing" />);
    expect(listed()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByLabelText(/Include 1 unimportant difference/));
    expect(listed()).toHaveLength(2);
  });

  it("draws both captures side by side, with the changed words marked, when the result carries them", () => {
    const result = {
      ...comparison([change()]),
      view: {
        original: { nodes: [{ id: "n3", role: "paragraph", text: "The Starter plan costs $49/month." }], fields: {} },
        revised: { nodes: [{ id: "n3", role: "paragraph", text: "The Starter plan costs $59/month." }], fields: {} },
        marks: [
          { change: "c0", side: "original", node: "n3", start: 23, end: 33 },
          { change: "c0", side: "revised", node: "n3", start: 23, end: 33 },
        ],
      },
    };
    render(<WebReport result={result} url="https://example.com/pricing" />);
    expect(screen.getByRole("tab", { name: "Side by side", selected: true })).toBeTruthy();
    const before = screen.getByRole("region", { name: "Baseline capture, as compared" });
    const after = screen.getByRole("region", { name: "The page now, as compared" });
    expect(before.querySelector("mark")?.textContent).toContain("$49/month.");
    expect(after.querySelector("mark")?.textContent).toContain("$59/month.");
    expect(after.querySelector('[data-active="true"]')).toBeTruthy();
    // No page numbers are invented for a webpage.
    expect(document.body.textContent).not.toMatch(/Page \d+ of/);
  });
});

// ---------------------------------------------------------------- accessibility

describe("accessibility basics", () => {
  it("gives every control a distinct name a screen reader can announce", () => {
    render(<WebsiteDesk />);
    const names = screen.getAllByRole("button").map((b) => (b.textContent ?? "").trim());
    expect(new Set(names).size).toBe(names.length);
    for (const button of screen.getAllByRole("button")) {
      expect((button.textContent ?? "").trim().length + (button.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText("Web page address")).toBeTruthy();
  });

  it("uses a sensible heading order in the report", () => {
    render(<WebReport result={comparison([change()])} url="https://example.com/pricing" />);
    const levels = screen.getAllByRole("heading").map((node) => Number(node.tagName.slice(1)));
    expect(levels[0]).toBe(2);
    // Never skips a level on the way down.
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it("announces progress and results politely", () => {
    render(<WebsiteDesk />);
    const status = screen.getAllByRole("status");
    expect(status.length).toBeGreaterThan(0);
    expect(status.some((node) => node.getAttribute("aria-live") === "polite")).toBe(true);
  });

  it("marks a change's kind with a word, not only a colour", () => {
    render(<WebReport result={comparison([change({ kind: "added", category: "text", oldValue: null, newValue: "New clause" })])} url="https://example.com/x" />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("Text added")).toBeTruthy();
    expect(within(card).getByText("After")).toBeTruthy();
    expect(within(navigator()).getByText("Added")).toBeTruthy();
  });

  it("names each change card for assistive technology", () => {
    render(<WebReport result={comparison([change()])} url="https://example.com/pricing" />);
    const article = screen.getByRole("article");
    expect(within(article).getByText("Number changed")).toBeTruthy();
    expect(article.getAttribute("aria-label")).toContain("Change 1 of 1");
  });
});

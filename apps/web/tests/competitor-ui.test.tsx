/**
 * @vitest-environment jsdom
 *
 * The Competitor Monitor interface.
 *
 * The promises under test: every change the engine returned is on screen, in
 * exactly one group; the labels the person chose stay in the browser; the
 * report is honest about what "no changes" means; and no wording judges a
 * change or a competitor.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompetitorDesk } from "@/components/competitor/CompetitorDesk";
import { CompetitorReport } from "@/components/competitor/CompetitorReport";
import {
  buildBaselineFile,
  type CompetitorChange,
  type CompetitorComparison,
} from "@/lib/competitor-report";

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

const SNAPSHOT = {
  schema_version: "1",
  source: {
    url: "https://acme.example.com/pricing",
    final_url: "https://acme.example.com/pricing",
    fetched_at: "2026-03-12T09:30:00+00:00",
  },
  metadata: { title: "Acme Pricing" },
  nodes: [],
  content_sha256: "c".repeat(64),
};

const SIGNALS = [
  ["pricing_commercial", "Pricing & Commercial"],
  ["product_features", "Product & Features"],
  ["messaging_positioning", "Messaging & Positioning"],
  ["plans_packaging", "Plans & Packaging"],
  ["calls_to_action", "Calls to Action"],
  ["content_sections", "Content & Sections"],
  ["links_destinations", "Links & Destinations"],
  ["seo_metadata", "SEO & Metadata"],
  ["other", "Other"],
] as const;

function change(
  id: string,
  signal: (typeof SIGNALS)[number][0],
  overrides: Partial<CompetitorChange> = {},
): CompetitorChange {
  const label = SIGNALS.find(([key]) => key === signal)![1];
  return {
    id,
    seq: Number(id.slice(1)),
    type: "TEXT_MODIFIED",
    kind: "modified",
    category: "text",
    subtype: null,
    label: null,
    oldValue: "before",
    newValue: "after",
    delta: null,
    confidence: 1,
    isNoise: false,
    noiseReason: null,
    sections: ["Acme › Plans"],
    evidence: [
      { side: "old", scope: "node", nodeId: "n4", path: "main > p", sectionPath: ["Acme", "Plans"], field: null, excerpt: "The words before." },
      { side: "new", scope: "node", nodeId: "n4", path: "main > p", sectionPath: ["Acme", "Plans"], field: null, excerpt: "The words after." },
    ],
    competitorSignal: {
      signal,
      label,
      basis: "section_heading",
      matchedText: "Plans",
      reason: "it sits in the section “Plans”",
      summary: `Touches ${label}`,
    },
    ...overrides,
  };
}

const PRICE = change("c0", "pricing_commercial", {
  type: "NUMBER_CHANGED",
  category: "number",
  label: "Team",
  oldValue: "$15",
  newValue: "$18",
  delta: "+3 (+20%)",
  sections: ["Acme › Plans › Team"],
  competitorSignal: {
    signal: "pricing_commercial",
    label: "Pricing & Commercial",
    basis: "money_value",
    matchedText: "$18",
    reason: "“$18” is an amount of money",
    summary: "Touches Pricing & Commercial",
  },
});
const FEATURE = change("c1", "product_features", {
  kind: "added",
  type: "TEXT_ADDED",
  oldValue: null,
  newValue: "Automations",
  sections: ["Acme › Features"],
});
const CTA = change("c2", "calls_to_action", { oldValue: "Start free trial", newValue: "Book a demo" });
const OTHER = change("c3", "other", { oldValue: "Leeds", newValue: "York", sections: [] });

function comparison(changes: CompetitorChange[], minor: CompetitorChange[] = []): CompetitorComparison {
  const all = [...changes, ...minor];
  return {
    engineVersion: "test",
    processingMs: 500,
    documents: {
      previous: { url: "https://acme.example.com/pricing", sha256: "a".repeat(64) },
      revised: { url: "https://acme.example.com/pricing", sha256: "b".repeat(64) },
    },
    counts: { total: all.length, meaningful: changes.length, noise: minor.length },
    changes: all,
    diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
    competitor: {
      signalsVersion: "2026.09.1",
      signals: SIGNALS.map(([id, label]) => {
        const mine = changes.filter((c) => c.competitorSignal?.signal === id);
        return { id, label, blurb: `${label} blurb.`, changeCount: mine.length, changeIds: mine.map((c) => c.id) };
      }),
      changedSignals: SIGNALS.map(([id]) => id).filter((id) =>
        changes.some((c) => c.competitorSignal?.signal === id),
      ),
    },
  };
}

type Call = { url: string; body: unknown };

function stubFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const next = responses.shift() ?? { status: 500, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return calls;
}

function renderReport(result: CompetitorComparison) {
  return render(
    <CompetitorReport
      result={result}
      url="https://acme.example.com/pricing"
      competitor="Acme"
      pageType="pricing"
      baselineCapturedAt="2026-03-12T09:30:00+00:00"
    />,
  );
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function upload(content: string, name = "acme-pricing-2026-03-12.diffnexa-snapshot.json") {
  const file = new File([content], name, { type: "application/json" });
  const input = document.getElementById("competitor-baseline-file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

// ---------------------------------------------------------------- first run

describe("the first screen", () => {
  it("offers capturing a baseline, with the three inputs", () => {
    render(<CompetitorDesk />);
    expect(screen.getByRole("button", { name: "Capture baseline" })).toBeTruthy();
    expect(screen.getByLabelText("Competitor")).toBeTruthy();
    expect(screen.getByLabelText("Page address")).toBeTruthy();
    expect(screen.getByLabelText("Page type")).toBeTruthy();
    expect(document.body.textContent).toContain("your baseline");
  });

  it("offers exactly the agreed page types, and says they are only a label", () => {
    render(<CompetitorDesk />);
    const select = screen.getByLabelText("Page type") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.text)).toEqual([
      "Homepage",
      "Pricing",
      "Product",
      "Features",
      "Plans",
      "Changelog",
      "Documentation",
      "Other",
    ]);
    expect(document.body.textContent).toContain("It does not change how the page is read.");
  });

  it("never claims the page is being watched", () => {
    render(<CompetitorDesk />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const claim of ["we monitor", "we'll alert", "automatically", "every day", "notif"]) {
      expect(text).not.toContain(claim);
    }
  });

  it("asks for a competitor name before capturing", async () => {
    const calls = stubFetch([]);
    render(<CompetitorDesk />);
    fill("Page address", "acme.example.com/pricing");
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));
    expect(await screen.findByText(/Enter a name for this competitor/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("explains an address it cannot check, before asking the server", async () => {
    const calls = stubFetch([]);
    render(<CompetitorDesk />);
    fill("Competitor", "Acme");
    fill("Page address", "http://localhost:3000/admin");
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));
    expect(await screen.findByText(/available publicly on the internet/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- capture

describe("capturing a baseline", () => {
  it("confirms the competitor, page, page type and time, and sends only the address", async () => {
    const calls = stubFetch([{ status: 200, body: { snapshot: SNAPSHOT } }]);
    render(<CompetitorDesk />);
    fill("Competitor", "Acme");
    fill("Page address", "acme.example.com/pricing");
    fireEvent.change(screen.getByLabelText("Page type"), { target: { value: "changelog" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    const panel = (await screen.findByText("Baseline captured")).closest("section")!;
    expect(within(panel).getByRole("heading", { name: "Acme" })).toBeTruthy();
    expect(panel.textContent).toContain("https://acme.example.com/pricing");
    expect(panel.textContent).toContain("Changelog");
    expect(panel.textContent).toContain("2026");
    expect(calls[0].url).toBe("/api/competitor/snapshot");
    expect(calls[0].body).toEqual({ url: "https://acme.example.com/pricing" });
  });

  it("downloads the baseline as a .diffnexa-snapshot.json file", async () => {
    stubFetch([{ status: 200, body: { snapshot: SNAPSHOT } }]);
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const names: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });

    render(<CompetitorDesk />);
    fill("Competitor", "Acme Corp");
    fill("Page address", "acme.example.com/pricing");
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download baseline" }));

    expect(createObjectURL).toHaveBeenCalled();
    expect(names).toEqual(["acme-corp-pricing-2026-03-12.diffnexa-snapshot.json"]);
    click.mockRestore();
  });
});

// ---------------------------------------------------------------- check

describe("checking against a baseline", () => {
  it("refuses without a baseline file", async () => {
    const calls = stubFetch([]);
    render(<CompetitorDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    fill("Page address", "acme.example.com/pricing");
    fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));
    expect(await screen.findByText(/Choose the baseline file/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("fills the form from the file, checks, and shows the report with the labels", async () => {
    const calls = stubFetch([{ status: 200, body: comparison([PRICE, FEATURE]) }]);
    render(<CompetitorDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    upload(JSON.stringify(buildBaselineFile(SNAPSHOT, "Acme", "plans")));

    await waitFor(() =>
      expect((screen.getByLabelText("Page address") as HTMLInputElement).value).toBe(
        "https://acme.example.com/pricing",
      ),
    );
    expect((screen.getByLabelText("Competitor") as HTMLInputElement).value).toBe("Acme");
    expect((screen.getByLabelText("Page type") as HTMLSelectElement).value).toBe("plans");

    fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));
    const heading = await screen.findByRole("heading", { name: "2 changes found" });
    const report = heading.closest("section")!;
    expect(report.textContent).toContain("Acme");
    expect(report.textContent).toContain("Plans");
    expect(report.textContent).toContain("https://acme.example.com/pricing");

    expect(calls[0].url).toBe("/api/competitor/compare");
    expect(calls[0].body).toEqual({ url: "https://acme.example.com/pricing", previous_snapshot: SNAPSHOT });
  });

  it("accepts a baseline saved by Website Change Detector", async () => {
    stubFetch([{ status: 200, body: comparison([]) }]);
    render(<CompetitorDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    upload(JSON.stringify(SNAPSHOT), "acme.example.com-2026-03-12.diffnexa.json");
    await waitFor(() =>
      expect((screen.getByLabelText("Page address") as HTMLInputElement).value).not.toBe(""),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));
    expect(await screen.findByRole("heading", { name: "No changes found" })).toBeTruthy();
    // No name in the file and none typed: the page's own address stands in.
    expect(document.body.textContent).toContain("acme.example.com");
  });

  it("refuses a file that is not a baseline, before asking the server", async () => {
    const calls = stubFetch([]);
    render(<CompetitorDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    upload("this is not json", "notes.txt");
    expect(await screen.findByText(/isn't a DiffNexa baseline/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["snapshot_mismatch", "This baseline is for a different page"],
    ["snapshot_unreadable", "That file isn't a valid baseline"],
    ["url_unreachable", "Could not fetch this page"],
    ["url_not_allowed", "This address can't be checked"],
    ["page_needs_javascript", "This page builds its content in the browser"],
  ])("explains a %s failure", async (code, title) => {
    stubFetch([{ status: 400, body: { error: { code, message: "x", side: null } } }]);
    render(<CompetitorDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    upload(JSON.stringify(buildBaselineFile(SNAPSHOT, "Acme", "pricing")));
    await waitFor(() =>
      expect((screen.getByLabelText("Page address") as HTMLInputElement).value).not.toBe(""),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(title);
    expect(alert.textContent?.toLowerCase()).not.toContain("damaged");
  });
});

// ---------------------------------------------------------------- the report

describe("the report", () => {
  it("says plainly when nothing changed, without claiming the competitor changed nothing", () => {
    renderReport(comparison([]));
    expect(screen.getByRole("heading", { name: "No changes found" })).toBeTruthy();
    expect(document.body.textContent).toContain(
      "This page says the same as it did when you captured your baseline.",
    );
    expect(document.body.textContent).not.toMatch(/competitor has not changed/i);
  });

  it("shows the competitor, page, page type and baseline time", () => {
    renderReport(comparison([PRICE]));
    const header = screen.getByRole("heading", { name: "1 change found" }).closest("header")!;
    for (const term of ["Competitor", "Page", "Page type", "Baseline"]) {
      expect(within(header).getByText(term, { selector: "dt" })).toBeTruthy();
    }
    expect(header.textContent).toContain("Acme");
    expect(header.textContent).toContain("Pricing");
  });

  it("groups what changed by signal, with every change shown exactly once", () => {
    renderReport(comparison([PRICE, FEATURE, CTA, OTHER]));
    for (const name of ["Pricing & Commercial", "Product & Features", "Calls to Action", "Other"]) {
      expect(screen.getByRole("heading", { level: 3, name: new RegExp(`^${name.replace(/[&]/g, "\\$&")}`) })).toBeTruthy();
    }
    expect(screen.getAllByRole("article")).toHaveLength(4);
  });

  it("shows values exactly as the engine returned them, with the reason for the group", () => {
    renderReport(comparison([PRICE]));
    const card = screen.getByRole("article");
    expect(card.textContent).toContain("$15");
    expect(card.textContent).toContain("$18");
    expect(card.textContent).toContain("+3 (+20%)");
    expect(card.textContent).toContain("Touches Pricing & Commercial");
    expect(card.textContent).toContain("“$18” is an amount of money");
  });

  it("narrows to one signal when it is chosen, and clears again", () => {
    renderReport(comparison([PRICE, FEATURE, CTA]));
    fireEvent.click(screen.getByRole("button", { name: /Product & Features/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article").textContent).toContain("Automations");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("searches wording, values and signal names", () => {
    renderReport(comparison([PRICE, FEATURE, CTA]));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "$18" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "calls to action" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing like this" } });
    expect(document.body.textContent).toContain("Nothing matches these filters");
  });

  it("steps between changes across the groups", () => {
    renderReport(comparison([PRICE, FEATURE, CTA]));
    expect(screen.getByText(/Change 1 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByText(/Change 2 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByText(/Change 3 of 3/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next change" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous change" }));
    expect(screen.getByText(/Change 2 of 3/)).toBeTruthy();
  });

  it("opens the evidence for a change", () => {
    renderReport(comparison([PRICE]));
    fireEvent.click(screen.getByRole("button", { name: "View evidence" }));
    expect(document.body.textContent).toContain("The words before.");
    expect(document.body.textContent).toContain("The words after.");
  });

  it("does not count ignored differences as changes", () => {
    const noise = change("c9", "content_sections", { isNoise: true, noiseReason: "A timestamp." });
    renderReport(comparison([], [noise]));
    expect(screen.getByRole("heading", { name: "No changes found" })).toBeTruthy();
    expect(document.body.textContent).toContain("1 difference such as timestamps were ignored");
  });

  it("never judges a change or a competitor", () => {
    renderReport(comparison([PRICE, FEATURE, CTA, OTHER]));
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const word of [
      "important change",
      "critical",
      "major competitor move",
      "threat",
      "risk",
      "opportunity",
      "better",
      "worse",
      "strategic",
      "winning",
      "losing",
      "aggressive",
      "weak",
      "strong",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });
});

// ---------------------------------------------------------------- accessibility

describe("accessibility basics", () => {
  it("labels every control and gives buttons distinct names", () => {
    render(<CompetitorDesk />);
    for (const input of Array.from(document.querySelectorAll("input:not([type=file]), select"))) {
      const id = input.getAttribute("id");
      expect(id && document.querySelector(`label[for="${id}"]`), `unlabelled ${input.outerHTML}`).toBeTruthy();
    }
    const fileInput = document.getElementById("competitor-baseline-file");
    expect(fileInput).toBeNull(); // only offered when checking
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    expect(document.querySelector('label[for="competitor-baseline-file"]')?.textContent).toBe(
      "Choose baseline file",
    );
    const names = screen.getAllByRole("button").map((button) => button.textContent);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks signal filters as toggles", () => {
    renderReport(comparison([PRICE, FEATURE]));
    const toggle = screen.getByRole("button", { name: /Pricing & Commercial/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
});

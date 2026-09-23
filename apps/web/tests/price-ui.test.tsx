/**
 * @vitest-environment jsdom
 *
 * The Price Monitor interface.
 *
 * The promises under test: every change the engine returned is on screen, in
 * exactly one group, with "Other Changes" keeping ordinary edits visible; the
 * labels the person chose stay in the browser; and no wording evaluates a price.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PriceDesk } from "@/components/price/PriceDesk";
import { PriceReport } from "@/components/price/PriceReport";
import { buildBaselineFile, type PriceChange, type PriceComparison } from "@/lib/price-report";

import { counter } from "./helpers/workspace";

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
    url: "https://tasklane.example.com/pricing",
    final_url: "https://tasklane.example.com/pricing",
    fetched_at: "2026-03-12T09:30:00+00:00",
  },
  metadata: { title: "Pricing — Tasklane" },
  nodes: [],
  content_sha256: "c".repeat(64),
};

const CATEGORIES = [
  ["price", "Price"],
  ["discount_sale", "Discount / Sale Price"],
  ["original_price", "Original / Compare-at Price"],
  ["currency", "Currency"],
  ["billing_period", "Billing Period"],
  ["product_plan", "Product / Plan"],
  ["availability", "Availability"],
  ["pricing_details", "Pricing Details"],
  ["other", "Other Changes"],
] as const;

type CategoryId = (typeof CATEGORIES)[number][0];

function change(id: string, category: CategoryId, overrides: Partial<PriceChange> = {}): PriceChange {
  const label = CATEGORIES.find(([key]) => key === category)![1];
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
    sections: ["Tasklane pricing › Plans"],
    evidence: [
      { side: "old", scope: "node", nodeId: "n4", path: "main > p", sectionPath: ["Tasklane pricing", "Plans"], field: null, excerpt: "The words before." },
      { side: "new", scope: "node", nodeId: "n4", path: "main > p", sectionPath: ["Tasklane pricing", "Plans"], field: null, excerpt: "The words after." },
    ],
    priceCategory: { category, label, basis: "pricing_section", matchedText: "Plans", reason: "it sits with prices on the page (“Plans”)" },
    ...overrides,
  };
}

const PRICE = change("c0", "price", {
  type: "NUMBER_CHANGED",
  category: "number",
  label: "Pro Plan",
  oldValue: "$29",
  newValue: "$39",
  delta: "+10 (+34.48%)",
  priceCategory: { category: "price", label: "Price", basis: "money", matchedText: "$39", reason: "“$39” is an amount with a currency" },
});
const SALE = change("c1", "discount_sale", { label: "Annual plan", oldValue: "$299", newValue: "$249" });
const AVAILABILITY = change("c2", "availability", { label: "Business plan", oldValue: "Available", newValue: "Contact sales" });
const TEXT = change("c3", "other", { oldValue: "Leeds", newValue: "York", sections: [] });
const LINK = change("c4", "other", {
  type: "LINK_CHANGED",
  category: "link",
  oldValue: "https://tasklane.example.com/blog",
  newValue: "https://tasklane.example.com/news",
});

function comparison(changes: PriceChange[], minor: PriceChange[] = []): PriceComparison {
  const all = [...changes, ...minor];
  return {
    engineVersion: "test",
    processingMs: 400,
    documents: {
      previous: { url: "https://tasklane.example.com/pricing", sha256: "a".repeat(64) },
      revised: { url: "https://tasklane.example.com/pricing", sha256: "b".repeat(64) },
    },
    counts: { total: all.length, meaningful: changes.length, noise: minor.length },
    changes: all,
    diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
    price: {
      rulesVersion: "2026.09.1",
      categories: CATEGORIES.map(([id, label]) => {
        const mine = changes.filter((c) => c.priceCategory?.category === id);
        return { id, label, blurb: `${label} blurb.`, changeCount: mine.length, changeIds: mine.map((c) => c.id) };
      }),
      changedCategories: CATEGORIES.map(([id]) => id).filter((id) => changes.some((c) => c.priceCategory?.category === id)),
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
      new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } }),
    );
  });
  return calls;
}

function renderReport(result: PriceComparison) {
  return render(
    <PriceReport
      result={result}
      url="https://tasklane.example.com/pricing"
      product="Tasklane"
      pageType="saas_pricing"
      baselineCapturedAt="2026-03-12T09:30:00+00:00"
    />,
  );
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function upload(content: string, name = "tasklane-saas-pricing-2026-03-12.diffnexa-snapshot.json") {
  const file = new File([content], name, { type: "application/json" });
  fireEvent.change(document.getElementById("price-baseline-file") as HTMLInputElement, { target: { files: [file] } });
}

async function openCheck(file = JSON.stringify(buildBaselineFile(SNAPSHOT, "Tasklane", "saas_pricing"))) {
  fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
  upload(file);
  await waitFor(() => expect((screen.getByLabelText("Page address") as HTMLInputElement).value).not.toBe(""));
}

describe("the first screen", () => {
  it("asks for a product or service, a public address and a page type", () => {
    render(<PriceDesk />);
    expect(screen.getByLabelText("Product / service")).toBeTruthy();
    expect(document.body.textContent).toContain("Your own label for this product or service.");
    expect((screen.getByLabelText("Product / service") as HTMLInputElement).placeholder).toBe("GitHub Copilot");
    expect(screen.getByLabelText("Page address")).toBeTruthy();
    expect(document.body.textContent).toContain("A public page, for example example.com/pricing");
    expect(screen.getByRole("button", { name: "Capture this page" })).toBeTruthy();
  });

  it("offers exactly the agreed page types, and says they are only a label", () => {
    render(<PriceDesk />);
    const select = screen.getByLabelText("Page type") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.text)).toEqual([
      "Product",
      "Subscription Plan",
      "SaaS Pricing",
      "Service Pricing",
      "Pricing Table",
      "Other",
    ]);
    expect(document.body.textContent).toContain("It does not change how the page is read.");
  });

  it("never claims prices are watched or alerts are sent", () => {
    render(<PriceDesk />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const claim of ["we monitor", "alert", "automatically", "every day", "notif", "we'll email"]) {
      expect(text).not.toContain(claim);
    }
  });

  it("asks for a product name before capturing", async () => {
    const calls = stubFetch([]);
    render(<PriceDesk />);
    fill("Page address", "example.com/pricing");
    fireEvent.click(screen.getByRole("button", { name: "Capture this page" }));
    expect(await screen.findByText(/Enter a name for this product or service/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("explains an address it cannot check, before asking the server", async () => {
    const calls = stubFetch([]);
    render(<PriceDesk />);
    fill("Product / service", "Tasklane");
    fill("Page address", "http://192.168.1.10/pricing");
    fireEvent.click(screen.getByRole("button", { name: "Capture this page" }));
    expect(await screen.findByText(/available publicly on the internet/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe("capturing a baseline", () => {
  it("confirms the capture and sends only the address", async () => {
    const calls = stubFetch([{ status: 200, body: { snapshot: SNAPSHOT } }]);
    render(<PriceDesk />);
    fill("Product / service", "Tasklane");
    fill("Page address", "tasklane.example.com/pricing");
    fireEvent.change(screen.getByLabelText("Page type"), { target: { value: "saas_pricing" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture this page" }));

    const panel = (await screen.findByText("Baseline captured")).closest("section")!;
    expect(within(panel).getByRole("heading", { name: "Tasklane" })).toBeTruthy();
    expect(panel.textContent).toContain("SaaS Pricing");
    expect(panel.textContent).toContain("https://tasklane.example.com/pricing");
    expect(calls).toEqual([{ url: "/api/price/snapshot", body: { url: "https://tasklane.example.com/pricing" } }]);
  });

  it("downloads the baseline as a .diffnexa-snapshot.json file", async () => {
    stubFetch([{ status: 200, body: { snapshot: SNAPSHOT } }]);
    const createObjectURL = vi.fn(() => "blob:fake");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    render(<PriceDesk />);
    fill("Product / service", "GitHub Copilot");
    fill("Page address", "tasklane.example.com/pricing");
    fireEvent.change(screen.getByLabelText("Page type"), { target: { value: "subscription_plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture this page" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download baseline" }));
    expect(names).toEqual(["github-copilot-subscription-plan-2026-03-12.diffnexa-snapshot.json"]);
    click.mockRestore();
  });
});

describe("checking against a baseline", () => {
  it("refuses without a baseline file", async () => {
    const calls = stubFetch([]);
    render(<PriceDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    fill("Page address", "tasklane.example.com/pricing");
    fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));
    expect(await screen.findByText(/Choose the baseline file/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("fills the form from the file, checks, and sends only the address and baseline", async () => {
    const calls = stubFetch([{ status: 200, body: comparison([PRICE, SALE, AVAILABILITY]) }]);
    render(<PriceDesk />);
    await openCheck();
    expect((screen.getByLabelText("Product / service") as HTMLInputElement).value).toBe("Tasklane");
    expect((screen.getByLabelText("Page type") as HTMLSelectElement).value).toBe("saas_pricing");
    fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));
    expect(await screen.findByRole("heading", { name: "3 changes found" })).toBeTruthy();
    expect(calls).toEqual([
      { url: "/api/price/compare", body: { url: "https://tasklane.example.com/pricing", previous_snapshot: SNAPSHOT } },
    ]);
  });

  it("gives the same request whatever page type is chosen", async () => {
    const bodies: unknown[] = [];
    for (const pageType of ["product", "pricing_table"]) {
      const calls = stubFetch([{ status: 200, body: comparison([]) }]);
      render(<PriceDesk />);
      await openCheck();
      fireEvent.change(screen.getByLabelText("Page type"), { target: { value: pageType } });
      fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));
      await screen.findByRole("heading", { name: "No changes found" });
      bodies.push(calls[0].body);
      cleanup();
    }
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it("refuses a file that is not a baseline, before asking the server", async () => {
    const calls = stubFetch([]);
    render(<PriceDesk />);
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
    render(<PriceDesk />);
    await openCheck();
    fireEvent.click(screen.getByRole("button", { name: "Check this page now" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(title);
  });
});

describe("the report", () => {
  it("says plainly when nothing changed", () => {
    renderReport(comparison([]));
    expect(screen.getByRole("heading", { name: "No changes found" })).toBeTruthy();
    expect(document.body.textContent).toContain("This page says the same as it did when you captured your baseline.");
  });

  it("shows the product, page, page type and baseline time", () => {
    renderReport(comparison([PRICE]));
    const header = screen.getByRole("heading", { name: "1 change found" }).closest("header")!;
    for (const term of ["Product / service", "Page", "Page type", "Baseline"]) {
      expect(within(header).getByText(term, { selector: "dt" })).toBeTruthy();
    }
    expect(header.textContent).toContain("Tasklane");
    expect(header.textContent).toContain("SaaS Pricing");
  });

  it("groups changes by category and keeps ordinary changes under Other Changes", () => {
    renderReport(comparison([PRICE, SALE, AVAILABILITY, TEXT, LINK]));
    for (const name of ["Price", "Discount / Sale Price", "Availability", "Other Changes"]) {
      const escaped = name.replace(/[/]/g, "\\/");
      expect(screen.getByRole("heading", { level: 3, name: new RegExp(`^${escaped} ·`) }), name).toBeTruthy();
    }
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.getByRole("heading", { level: 3, name: /^Other Changes · 2 changes/ })).toBeTruthy();
  });

  it("shows values exactly as the engine returned them, with the reason", () => {
    renderReport(comparison([PRICE]));
    const card = screen.getByRole("article");
    expect(card.textContent).toContain("Pro Plan");
    expect(card.textContent).toContain("$29");
    expect(card.textContent).toContain("$39");
    expect(card.textContent).toContain("“$39” is an amount with a currency");
  });

  it("narrows to one category when it is chosen, and clears again", () => {
    renderReport(comparison([PRICE, AVAILABILITY, TEXT]));
    fireEvent.click(screen.getByRole("button", { name: /^Availability/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("searches values, wording and category names", () => {
    renderReport(comparison([PRICE, AVAILABILITY, TEXT]));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "$39" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "availability" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("steps between changes across the groups", () => {
    renderReport(comparison([PRICE, SALE, AVAILABILITY]));
    expect(counter()).toBe("Change 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(counter()).toBe("Change 2 of 3");
  });

  it("opens the evidence for a change", () => {
    renderReport(comparison([PRICE]));
    fireEvent.click(screen.getByRole("button", { name: "View evidence" }));
    expect(document.body.textContent).toContain("The words before.");
    expect(document.body.textContent).toContain("The words after.");
  });

  it("never evaluates a price", () => {
    renderReport(comparison([PRICE, SALE, AVAILABILITY, TEXT, LINK]));
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const phrase of [
      "significant", "expensive", "better deal", "worse deal", "good price", "bad price", "undercut",
      "best price", "cheapest", "great offer", "poor offer", "increased", "decreased",
    ]) {
      expect(text, phrase).not.toContain(phrase);
    }
  });
});

describe("accessibility basics", () => {
  it("labels every control and gives buttons distinct names", () => {
    render(<PriceDesk />);
    for (const input of Array.from(document.querySelectorAll("input:not([type=file]), select"))) {
      const id = input.getAttribute("id");
      expect(id && document.querySelector(`label[for="${id}"]`), input.outerHTML).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    expect(document.querySelector('label[for="price-baseline-file"]')?.textContent).toBe("Choose baseline file");
    const names = screen.getAllByRole("button").map((button) => button.textContent);
    expect(new Set(names).size).toBe(names.length);
  });
});

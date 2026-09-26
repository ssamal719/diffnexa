/**
 * @vitest-environment jsdom
 *
 * The Policy and Terms Monitor interface.
 *
 * Two promises are under test. Every change the engine returned is still on
 * screen, classified or not. And no wording anywhere judges a change: the tool
 * says where something sits in a document, never what it means for the reader.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PolicyDesk } from "@/components/policy/PolicyDesk";
import { PolicyReport } from "@/components/policy/PolicyReport";
import { POLICY_TYPES, type PolicyChange, type PolicyComparison } from "@/lib/policy-report";

import { counter, evidence, listed, navigator } from "./helpers/workspace";

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
    url: "https://example.com/privacy",
    final_url: "https://example.com/privacy",
    fetched_at: "2026-03-12T09:30:00+00:00",
  },
  metadata: { title: "Privacy Policy — Example" },
  nodes: [],
  content_sha256: "c".repeat(64),
};

function change(overrides: Partial<PolicyChange> = {}): PolicyChange {
  return {
    id: "c0",
    seq: 0,
    type: "NUMBER_CHANGED",
    kind: "modified",
    category: "number",
    subtype: null,
    label: "Data retention",
    oldValue: "12",
    newValue: "24",
    delta: "+12 (+100%)",
    confidence: 1,
    isNoise: false,
    noiseReason: null,
    sections: ["Privacy Policy › Data retention"],
    evidence: [
      { side: "old", scope: "node", nodeId: "n4", path: "main > p", sectionPath: ["Privacy Policy", "Data retention"], field: null, excerpt: "We retain your information for 12 months." },
      { side: "new", scope: "node", nodeId: "n4", path: "main > p", sectionPath: ["Privacy Policy", "Data retention"], field: null, excerpt: "We retain your information for 24 months." },
    ],
    policyTopics: [
      {
        topic: "data_retention",
        label: "Data retention",
        source: "heading",
        matchedText: "data retention",
        summary: "Touches Data retention",
      },
    ],
    ...overrides,
  };
}

const UNCLASSIFIED = change({
  id: "c1",
  seq: 1,
  label: null,
  oldValue: "400",
  newValue: "520",
  delta: "+120 (+30%)",
  sections: ["Privacy Policy › About us"],
  policyTopics: [],
});

function comparison(changes: PolicyChange[], topicOverrides = {}): PolicyComparison {
  return {
    engineVersion: "test",
    processingMs: 900,
    documents: {
      previous: { url: "https://example.com/privacy", sha256: "a".repeat(64) },
      revised: { url: "https://example.com/privacy", sha256: "b".repeat(64) },
    },
    counts: { total: changes.length, meaningful: changes.length, noise: 0 },
    changes,
    diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
    policy: {
      signalsVersion: "2026.09.1",
      topics: [
        { id: "data_retention", label: "Data retention", blurb: "How long information is kept.", status: "changed", changeCount: 1, sections: ["Data retention"] },
        { id: "governing_law", label: "Governing law", blurb: "Which law applies.", status: "present", changeCount: 0, sections: ["Governing law"] },
        { id: "liability", label: "Liability", blurb: "Who is responsible.", status: "not_found", changeCount: 0, sections: [] },
      ],
      changedTopics: ["data_retention"],
      classifiedChanges: changes.filter((c) => (c.policyTopics ?? []).length > 0).length,
      unclassifiedChanges: changes.filter((c) => (c.policyTopics ?? []).length === 0).length,
      ...topicOverrides,
    },
  };
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

// ---------------------------------------------------------------- first run

describe("the first screen", () => {
  it("shows the baseline and the policy page side by side, and explains the baseline", () => {
    render(<PolicyDesk />);
    const baseline = screen.getByRole("region", { name: "Baseline" });
    expect(within(baseline).getByRole("button", { name: "Capture baseline" })).toBeTruthy();
    expect(within(baseline).getByText("Choose baseline file")).toBeTruthy();
    const page = screen.getByRole("region", { name: "Policy page to check" });
    expect(within(page).getByLabelText("Policy page address")).toBeTruthy();
    expect(within(page).getByLabelText("What kind of document is this?")).toBeTruthy();
    expect(document.body.textContent).toContain("No baseline yet? Capture the page as it is today.");
  });

  it("offers exactly the agreed policy types", () => {
    render(<PolicyDesk />);
    const select = screen.getByLabelText("What kind of document is this?") as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.text);
    expect(labels).toEqual([
      "Privacy Policy",
      "Terms of Service",
      "Terms & Conditions",
      "Data Processing Agreement",
      "Subprocessor List",
      "Security Policy",
      "Cookie Policy",
      "Refund / Return Policy",
      "Other Policy",
    ]);
    expect(labels).toHaveLength(POLICY_TYPES.length);
  });

  it("says the policy type is only a label", () => {
    render(<PolicyDesk />);
    expect(document.body.textContent).toContain("does not change how the page is read");
  });

  it("never claims the page is being watched", () => {
    render(<PolicyDesk />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const claim of ["we will alert", "monitoring your", "automatically check", "we watch"]) {
      expect(text).not.toContain(claim);
    }
  });

  it("uses no implementation words", () => {
    render(<PolicyDesk />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const jargon of ["snapshot model", "contentnode", "ssrf", "endpoint", "engine"]) {
      expect(text).not.toContain(jargon);
    }
  });
});

// ---------------------------------------------------------------- capture

describe("capturing a baseline", () => {
  it("confirms the capture with the label, address and time", async () => {
    stubFetch(200, { snapshot: SNAPSHOT });
    render(<PolicyDesk />);
    fireEvent.change(screen.getByLabelText("Policy page address"), {
      target: { value: "example.com/privacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    const panel = screen.getByRole("region", { name: "Baseline" });
    expect(await within(panel).findByText("Captured now")).toBeTruthy();
    expect(panel.textContent).toContain("Privacy Policy — Example");
    expect(panel.textContent).toContain("example.com");
    expect(panel.textContent).toMatch(/2026/);
    expect(within(panel).getByRole("button", { name: "Download baseline" })).toBeTruthy();
  });

  it("records the chosen policy type with the capture", async () => {
    stubFetch(200, { snapshot: SNAPSHOT });
    render(<PolicyDesk />);
    fireEvent.change(screen.getByLabelText("What kind of document is this?"), {
      target: { value: "subprocessor_list" },
    });
    fireEvent.change(screen.getByLabelText("Policy page address"), {
      target: { value: "example.com/privacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    const panel = screen.getByRole("region", { name: "Baseline" });
    await within(panel).findByText("Captured now");
    expect(within(panel.querySelector("dl")!).getByText("Subprocessor List")).toBeTruthy();
  });

  it("makes clear the file is the user's to keep", async () => {
    stubFetch(200, { snapshot: SNAPSHOT });
    render(<PolicyDesk />);
    fireEvent.change(screen.getByLabelText("Policy page address"), {
      target: { value: "example.com/privacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    await screen.findByText("Captured now");
    expect(document.body.textContent).toContain("not an account");
    expect(document.body.textContent).toContain("Keep this file — you will need it");
  });

  it("downloads the baseline when asked", async () => {
    stubFetch(200, { snapshot: SNAPSHOT });
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));

    render(<PolicyDesk />);
    fireEvent.change(screen.getByLabelText("Policy page address"), {
      target: { value: "example.com/privacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download baseline" }));

    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- checking

describe("checking for changes", () => {
  it("asks for the baseline file and refuses without it", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<PolicyDesk />);
    fireEvent.change(screen.getByLabelText("Policy page address"), {
      target: { value: "example.com/privacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain("baseline file");
  });

  it("fills the form from a baseline file, then checks the page against it", async () => {
    const sent: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(new Response(JSON.stringify(comparison([change()])), { status: 200 }));
    });
    const file = {
      diffnexa: "policy-baseline",
      version: 1,
      policyType: "subprocessor_list",
      capturedAt: SNAPSHOT.source.fetched_at,
      url: SNAPSHOT.source.final_url,
      title: SNAPSHOT.metadata.title,
      snapshot: SNAPSHOT,
    };
    render(<PolicyDesk />);
    const input = document.getElementById("policy-baseline-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(file)], "privacy.json")] } });
    expect(await screen.findByText("privacy.json")).toBeTruthy();
    expect((screen.getByLabelText("Policy page address") as HTMLInputElement).value).toBe("https://example.com/privacy");
    expect((screen.getByLabelText("What kind of document is this?") as HTMLSelectElement).value).toBe("subprocessor_list");

    fireEvent.click(screen.getByRole("button", { name: "Check for changes" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      url: "/api/policy/compare",
      body: { url: "https://example.com/privacy", previous_snapshot: SNAPSHOT },
    });
  });

  it("explains an address it cannot check, before asking the server", async () => {
    const calls = vi.fn();
    vi.stubGlobal("fetch", calls);
    render(<PolicyDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Enter the address");
    expect(calls).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- the example

describe("Try example", () => {
  it("asks for the built-in example and explains how the tool works", async () => {
    const sent: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(new Response(JSON.stringify(comparison([change()])), { status: 200 }));
    });
    render(<PolicyDesk />);
    fireEvent.click(screen.getByRole("button", { name: "Try example" }));
    expect(await screen.findByText("How this tool works")).toBeTruthy();
    expect(sent).toEqual([{ url: "/api/policy/compare", body: { example: true } }]);
    expect(document.body.textContent).toContain("Terms of Service");
  });
});

// ---------------------------------------------------------------- the report

describe("the report", () => {
  const props = {
    url: "https://example.com/privacy",
    policyType: "privacy_policy",
    baselineCapturedAt: "2026-03-12T09:30:00+00:00",
  };

  it("leads with how many changes were detected", () => {
    render(<PolicyReport result={comparison([change()])} {...props} />);
    expect(screen.getByRole("heading", { name: "1 change detected" })).toBeTruthy();
    const details = document.querySelector("dl")!;
    expect(within(details).getByText("Privacy Policy")).toBeTruthy();
  });

  it("says plainly when nothing changed", () => {
    const empty = comparison([]);
    render(<PolicyReport result={empty} {...props} />);
    expect(screen.getByRole("heading", { name: "No changes found" })).toBeTruthy();
    expect(document.body.textContent).toContain("says the same as it did");
  });

  it("shows the change exactly as the engine returned it", () => {
    render(<PolicyReport result={comparison([change()])} {...props} />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("12")).toBeTruthy();
    expect(within(card).getByText("24")).toBeTruthy();
    expect(within(card).getByText("+12 (+100%)")).toBeTruthy();
    expect(within(evidence()).getByText("+12 (+100%)")).toBeTruthy();
  });

  it("shows the topic as additional information, with its phrase", () => {
    render(<PolicyReport result={comparison([change()])} {...props} />);
    expect(within(screen.getByRole("article")).getByText("Touches Data retention")).toBeTruthy();
    expect(within(evidence()).getByText("Touches Data retention")).toBeTruthy();
    // The topic is also the change's category in the navigator.
    expect(within(navigator()).getByText("Data retention")).toBeTruthy();
    expect(document.body.textContent).toContain("the section heading contains");
    expect(document.body.textContent).toContain("data retention");
  });

  it("keeps an unclassified change visible like any other", () => {
    render(<PolicyReport result={comparison([change(), UNCLASSIFIED])} {...props} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(listed()).toHaveLength(2);
    const cards = screen.getAllByRole("article");
    const plain = cards.find((card) => card.textContent?.includes("520"))!;
    expect(within(plain).queryByText(/^Touches /)).toBeNull();
  });

  it("distinguishes the three topic statuses", () => {
    render(<PolicyReport result={comparison([change()])} {...props} />);
    const topics = screen.getByRole("region", { name: "Parts of this document" });
    expect(within(topics).getByRole("button", { name: /Data retention/ })).toBeTruthy();
    expect(screen.getByText("Found in this document, with no detected changes")).toBeTruthy();
    expect(screen.getByText("Not found on this page")).toBeTruthy();
    expect(document.body.textContent).toContain("not the same as saying they did not change");
  });

  it("narrows to one part of the document when a topic is chosen", () => {
    render(<PolicyReport result={comparison([change(), UNCLASSIFIED])} {...props} />);
    const topics = screen.getByRole("region", { name: "Parts of this document" });
    fireEvent.click(within(topics).getByRole("button", { name: /Data retention/ }));

    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain("24");
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("opens the evidence for a change", async () => {
    render(<PolicyReport result={comparison([change()])} {...props} />);
    // Beside the chosen change, in the evidence panel.
    expect(within(evidence()).getByText(/We retain your information for 12 months/)).toBeTruthy();
    expect(within(evidence()).getByText(/We retain your information for 24 months/)).toBeTruthy();

    // And one click away on its card.
    const card = screen.getByRole("article");
    expect(within(card).queryByText(/We retain your information for 12 months/)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "View evidence" }));
    expect(await within(card).findByText(/We retain your information for 12 months/)).toBeTruthy();
    expect(within(card).getByText(/We retain your information for 24 months/)).toBeTruthy();
  });

  it("searches the changes", () => {
    render(<PolicyReport result={comparison([change(), UNCLASSIFIED])} {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "520" } });
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain("520");
  });

  it("steps between changes", () => {
    render(<PolicyReport result={comparison([change(), UNCLASSIFIED])} {...props} />);
    expect(counter()).toContain("Change 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(counter()).toContain("Change 2 of 2");
  });

  it("never judges a change or offers legal advice", () => {
    render(<PolicyReport result={comparison([change(), UNCLASSIFIED])} {...props} />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const judgement of [
      "high risk", "low risk", "unfavourable", "unfavorable", "favourable",
      "weakens", "legally significant", "compliance violation", "severity", "score",
    ]) {
      expect(text).not.toContain(judgement);
    }
    expect(text).toContain("not what it means");
    expect(text).toContain("does not give legal advice");
  });

  it("never invents an importance ranking", () => {
    render(<PolicyReport result={comparison([change(), UNCLASSIFIED])} {...props} />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const word of ["critical", "important change", "priority", "urgent"]) {
      expect(text).not.toContain(word);
    }
  });
});

// ---------------------------------------------------------------- errors

describe("errors", () => {
  it.each([
    ["url_not_allowed", "can't be checked"],
    ["url_not_html", "isn't a web page"],
    ["page_needs_javascript", "builds its content in the browser"],
    ["snapshot_mismatch", "different page"],
    ["snapshot_unreadable", "isn't a DiffNexa baseline"],
    ["engine_unavailable", "Nothing is wrong with the address"],
  ])("explains %s", async (code, expected) => {
    stubFetch(400, { error: { code, message: "internal detail" } });
    render(<PolicyDesk />);
    fireEvent.change(screen.getByLabelText("Policy page address"), {
      target: { value: "example.com/privacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Capture baseline" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(expected));
    expect(screen.getByRole("alert").textContent).not.toContain("internal detail");
  });
});

// ---------------------------------------------------------------- accessibility

describe("accessibility basics", () => {
  it("labels every control and gives buttons distinct names", () => {
    render(<PolicyDesk />);
    expect(screen.getByLabelText("Policy page address")).toBeTruthy();
    expect(screen.getByLabelText("What kind of document is this?")).toBeTruthy();
    const names = screen.getAllByRole("button").map((button) => (button.textContent ?? "").trim());
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps a sensible heading order in the report", () => {
    render(
      <PolicyReport
        result={comparison([change()])}
        url="https://example.com/privacy"
        policyType="privacy_policy"
        baselineCapturedAt={null}
      />,
    );
    const levels = screen.getAllByRole("heading").map((node) => Number(node.tagName.slice(1)));
    expect(Math.min(...levels)).toBe(2);
    expect(Math.max(...levels)).toBeLessThanOrEqual(4);
  });

  it("announces progress politely", () => {
    render(<PolicyDesk />);
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((node) => node.getAttribute("aria-live") === "polite")).toBe(true);
  });

  it("marks a topic count for screen readers, not by position alone", () => {
    render(
      <PolicyReport
        result={comparison([change()])}
        url="https://example.com/privacy"
        policyType="privacy_policy"
        baselineCapturedAt={null}
      />,
    );
    const topics = screen.getByRole("region", { name: "Parts of this document" });
    const button = within(topics).getByRole("button", { name: /Data retention/ });
    // The count is spelled out in text, not left to be inferred from a number
    // sitting next to a label.
    expect(button.textContent).toContain("Data retention");
    expect(button.textContent).toContain("1 change");
    expect(button.textContent).toContain("Changes detected");
  });
});

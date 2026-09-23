/**
 * @vitest-environment jsdom
 *
 * AI Change Analyst in the result pages.
 *
 * The promises under test: nothing is sent until the person asks; what is sent
 * is the sealed comparison, not files; there is no chat; the analysis keeps the
 * comparison's own facts and the AI's words visibly apart; every explanation
 * links back to its change through the report's own navigation; failures say
 * so plainly and leave the comparison exactly as it was.
 *
 * The analysis fixture is real engine output: the engine's analyst run over the
 * DOCX fixture with a scripted model reply, then validated. One statement in
 * that reply ("a better deal") was withheld by the engine's checks.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeAnalyst } from "@/components/analysis/ChangeAnalyst";
import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { DocxReport } from "@/components/docx/DocxReport";
import { ExcelWorkspace } from "@/components/excel/ExcelWorkspace";
import { AI_DISCLOSURE, AI_ERROR_MESSAGES, analysisPayload, type ChangeAnalysis } from "@/lib/analysis";
import type { DocxComparison } from "@/lib/docx-report";
import type { ExcelComparison } from "@/lib/excel-report";

const DOCX: DocxComparison = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "docx-comparison.json"), "utf8"));
const EXCEL: ExcelComparison = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "excel-comparison.json"), "utf8"),
);
const ANALYSIS: ChangeAnalysis = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "ai-analysis.json"), "utf8"));
const FILES = { original: { name: "Agreement v1.docx", sizeBytes: 36_864 }, revised: { name: "Agreement v2.docx", sizeBytes: 37_120 } };

type Reply = { status: number; body: unknown };
let replies: { status: Reply; analyze: Reply | (() => Promise<Response>) };
const requests: { url: string; body: unknown }[] = [];

beforeEach(() => {
  requests.length = 0;
  replies = { status: { status: 200, body: { available: true } }, analyze: { status: 200, body: ANALYSIS } };
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    requests.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith("/api/ai/status")) {
      return Promise.resolve(new Response(JSON.stringify(replies.status.body), { status: replies.status.status }));
    }
    if (typeof replies.analyze === "function") return replies.analyze();
    return Promise.resolve(new Response(JSON.stringify(replies.analyze.body), { status: replies.analyze.status }));
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panel(props: Partial<Parameters<typeof ChangeAnalyst>[0]> = {}) {
  const onViewChange = vi.fn();
  render(
    <ChangeAnalyst
      tool="docx"
      result={DOCX}
      seal="seal-from-the-server"
      changeCount={DOCX.changes.length}
      onViewChange={onViewChange}
      {...props}
    />,
  );
  return onViewChange;
}

async function analyse() {
  fireEvent.click(await screen.findByRole("button", { name: "Analyze Changes with AI" }));
  await screen.findByRole("heading", { name: "AI Change Summary" });
}

describe("before anything is sent", () => {
  it("shows nothing when the comparison found no changes", () => {
    const { container } = render(
      <ChangeAnalyst tool="docx" result={DOCX} seal="s" changeCount={0} onViewChange={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("offers analysis only after checking it is available, and says what would be sent", async () => {
    panel();
    const button = await screen.findByRole("button", { name: "Analyze Changes with AI" });
    expect(document.body.textContent).toContain(AI_DISCLOSURE);
    expect(document.body.textContent).toContain("It does not look for changes itself.");
    expect(requests.map((item) => item.url)).toEqual(["/api/ai/status"]);
    expect(button).toHaveProperty("disabled", false);
  });

  it("says plainly when AI analysis is unavailable, with no button", async () => {
    replies.status = { status: 200, body: { available: false } };
    panel();
    expect(await screen.findByText(/AI analysis isn.t available on this site right now/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Analyze/ })).toBeNull();
  });

  it("does not even ask when the result carries no seal", () => {
    panel({ seal: null });
    expect(screen.getByText(/AI analysis isn.t available on this site right now/)).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("has no chat, no question box and no free text of any kind", async () => {
    panel();
    await screen.findByRole("button", { name: "Analyze Changes with AI" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("textarea, input[type=text]")).toBeNull();
    expect((document.body.textContent ?? "").toLowerCase()).not.toMatch(/ask (ai|anything)|follow-up|chat/);
  });
});

describe("asking for analysis", () => {
  it("sends the sealed comparison — its changes and evidence — never files", async () => {
    panel();
    await analyse();
    const sent = requests.find((item) => item.url === "/api/ai/analyze")!;
    expect(sent.body).toEqual({ tool: "docx", seal: "seal-from-the-server", result: analysisPayload("docx", DOCX) });
  });

  it("shows progress, and a second click sends nothing more", async () => {
    let finish: (response: Response) => void = () => {};
    replies.analyze = () => new Promise<Response>((resolve) => (finish = resolve));
    panel();
    const button = await screen.findByRole("button", { name: "Analyze Changes with AI" });
    fireEvent.click(button);
    fireEvent.click(button);
    const running = await screen.findByRole("button", { name: "Analyzing…" });
    expect(running).toHaveProperty("disabled", true);
    expect(document.body.textContent).toContain("the comparison above stays as it is");
    expect(requests.filter((item) => item.url === "/api/ai/analyze")).toHaveLength(1);
    await act(async () => finish(new Response(JSON.stringify(ANALYSIS), { status: 200 })));
    expect(await screen.findByRole("heading", { name: "AI Change Summary" })).toBeTruthy();
  });
});

describe("the analysis", () => {
  it("has the five parts, in order", async () => {
    panel();
    await analyse();
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual([
      "AI Change Analyst",
      "AI Change Summary",
      "1. What changed",
      "2. Changes that may matter",
      "3. Change by change",
      "4. Limitations",
    ]);
  });

  it("states its coverage honestly, including what it withheld", async () => {
    panel();
    await analyse();
    const text = document.body.textContent ?? "";
    expect(text).toContain("AI analysis covered 10 of 11 detected changes.");
    expect(text).toContain("1 change has no AI explanation; it is still listed in the comparison.");
    expect(text).toContain("1 AI statement was not shown because it could not be matched to the comparison evidence.");
    expect(text).toContain(
      "AI Change Analyst explains changes detected by DiffNexa's deterministic comparison. It does not independently verify facts, determine legal meaning, or replace professional review.",
    );
    expect(text).not.toContain("better deal");
  });

  it("keeps the comparison's facts and the AI's words visibly apart", async () => {
    panel();
    await analyse();
    const card = screen.getByRole("article", { name: /Number changed, Table 1, row 2, column 2/ });
    expect(card.textContent).toContain("$10,000");
    expect(card.textContent).toContain("$12,000");
    expect(card.textContent).toContain("+2000 (+20%)");
    expect(card.textContent).toContain("Values above are from the comparison, not from AI.");
    expect(card.textContent).toContain("AI explanation");
    expect(card.textContent).toContain("In table 1, a value changes from $10,000 to $12,000, an increase of $2,000.");
    expect(card.textContent).toContain("Why it may matter");
    expect(card.textContent).toContain("Original · Table 1, row 2, column 2");
  });

  it("names significance in words, never by colour alone, and never as a score", async () => {
    panel();
    await analyse();
    const names = screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"));
    expect(names.filter((name) => name?.startsWith("Important change:"))).toHaveLength(4);
    const text = (document.body.textContent ?? "").toLowerCase();
    expect(text).not.toMatch(/\d+\s*\/\s*100|risk score|you should|recommend/);
  });

  it("lists what may matter, most important first, each linked to its change", async () => {
    const onViewChange = panel();
    await analyse();
    const section = screen.getByRole("heading", { name: "2. Changes that may matter" }).closest("section")!;
    const items = within(section).getAllByRole("listitem");
    expect(items[0].textContent).toMatch(/^Important change/);
    expect(items.at(-1)!.textContent).toMatch(/^Notable change/);
    fireEvent.click(within(items[0]).getByRole("button", { name: /^View change in the comparison/ }));
    expect(onViewChange).toHaveBeenCalledWith("c2");
  });

  it("links every summary sentence to the changes it is based on", async () => {
    const onViewChange = panel();
    await analyse();
    const section = screen.getByRole("heading", { name: "1. What changed" }).closest("section")!;
    const links = within(section).getAllByRole("button");
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      expect.stringContaining("Number changed"),
      expect.stringContaining("Date changed"),
      expect.stringContaining("Text added"),
      expect.stringContaining("Number changed, Table 1"),
    ]);
    fireEvent.click(links[1]);
    expect(onViewChange).toHaveBeenCalledWith("c3");
  });

  it("can be hidden and shown again without losing it", async () => {
    panel();
    await analyse();
    fireEvent.click(screen.getByRole("button", { name: "Hide AI analysis" }));
    expect(screen.queryByRole("heading", { name: "1. What changed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show AI analysis" }));
    expect(screen.getByRole("heading", { name: "1. What changed" })).toBeTruthy();
    expect(requests.filter((item) => item.url === "/api/ai/analyze")).toHaveLength(1);
  });
});

describe("when analysis fails", () => {
  it.each([
    ["ai_invalid", true],
    ["ai_timeout", true],
    ["ai_failed", true],
    ["ai_limit_reached", false],
    ["ai_unverified", false],
  ] as const)("says so in the shared words for %s, and that the comparison is untouched", async (code, retry) => {
    replies.analyze = { status: 502, body: { error: { code, message: AI_ERROR_MESSAGES[code], side: null } } };
    panel();
    fireEvent.click(await screen.findByRole("button", { name: "Analyze Changes with AI" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(AI_ERROR_MESSAGES[code]);
    expect(alert.textContent).toContain("The comparison above is complete and has not changed.");
    expect(Boolean(screen.queryByRole("button", { name: "Try AI analysis again" }))).toBe(retry);
  });

  it("survives a dropped connection", async () => {
    replies.analyze = () => Promise.reject(new TypeError("Failed to fetch"));
    panel();
    fireEvent.click(await screen.findByRole("button", { name: "Analyze Changes with AI" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The connection dropped");
  });
});

describe("in a report", () => {
  function docxReport() {
    render(
      <ReportWithAnalyst tool="docx" result={DOCX} seal="seal">
        {({ analyst, focus }) => <DocxReport result={DOCX} {...FILES} analyst={analyst} focus={focus} />}
      </ReportWithAnalyst>,
    );
  }

  it("sits between the summary and the list, and leaves every change in the list", async () => {
    docxReport();
    await analyse();
    const cards = screen
      .getAllByRole("article")
      .filter((card) => card.getAttribute("aria-label")?.startsWith("Change "));
    expect(cards).toHaveLength(DOCX.changes.length);
    const order = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(order.indexOf("AI Change Analyst")).toBeLessThan(order.indexOf("What changed"));
  });

  it("takes the reader to the change through the report's own navigation, clearing filters that hide it", async () => {
    docxReport();
    await analyse();
    fireEvent.click(screen.getByRole("button", { name: /^Tables/ })); // hides the payment-term changes
    const explained = screen.getByRole("article", { name: /Number changed, Paragraph 3/ });
    fireEvent.click(within(explained).getByRole("button", { name: /^View change in the comparison/ }));
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Change \d+ of 11/));
    expect(document.activeElement?.textContent).toContain("45");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(document.body.textContent).toMatch(/Change \d+ of 11/);
  });

  it("moves an Excel workspace to the change, in both workbooks", async () => {
    render(
      <ReportWithAnalyst tool="excel" result={EXCEL} seal="seal">
        {({ analyst, focus }) => (
          <>
            <ExcelWorkspace result={EXCEL} {...FILES} focus={focus} />
            {analyst}
          </>
        )}
      </ReportWithAnalyst>,
    );
    const excelAnalysis: ChangeAnalysis = {
      ...ANALYSIS,
      tool: "excel",
      summary: [],
      references: { c7: { type: "Date changed", location: "Pricing · F5 (was F4)" } },
      changes: [
        {
          ...ANALYSIS.changes[3],
          changeId: "c7",
          comparison: { ...ANALYSIS.changes[3].comparison, location: "Pricing · F5 (was F4)" },
        },
      ],
    };
    replies.analyze = { status: 200, body: excelAnalysis };
    await analyse();
    fireEvent.click(within(screen.getByRole("article", { name: /Pricing · F5/ })).getByRole("button", { name: /^View change/ }));
    const navigator = screen.getByRole("navigation", { name: "Differences" });
    await waitFor(() =>
      expect(within(navigator).getByRole("button", { name: /^Change 8:/ }).getAttribute("aria-current")).toBe("true"),
    );
    const revised = screen.getByRole("region", { name: "Revised spreadsheet" });
    expect(within(within(revised).getByRole("group", { name: "Sheets" })).getByRole("button", { pressed: true }).textContent).toContain(
      "Pricing",
    );
  });
});

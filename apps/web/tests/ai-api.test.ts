/**
 * AI Change Analyst on the website's server: sealing, and the analysis proxy.
 *
 * The promises under test:
 * - every comparison result leaves this site with a seal, and its body is unchanged;
 * - only a sealed result, unaltered, is ever forwarded for AI analysis — a changed
 *   value, an added change or a result from another tool is refused before the
 *   engine is called, so the AI endpoint cannot be used as a general AI service;
 * - only the parts analysis needs are forwarded (never Excel's cell grids);
 * - the secret never reaches a response, and nothing is logged;
 * - AI analysis is limited far more tightly than comparison, and a double
 *   submission never runs twice.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_ERROR_MESSAGES, SEAL_HEADER, analysisPayload } from "@/lib/analysis";
import { resetRateLimits } from "@/lib/rate-limit";

const SECRET = "ai-seal-secret-never-in-a-response";
const ENGINE = "http://engine.internal:8000";
const DOCX = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "docx-comparison.json"), "utf8"));
const EXCEL = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "excel-comparison.json"), "utf8"));
const ANALYSIS = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "ai-analysis.json"), "utf8"));
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

const calls: { url: string; init: RequestInit }[] = [];

function stubEngine(status: number, body: unknown) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  });
}

async function seal(tool: string, result: unknown): Promise<string> {
  vi.resetModules();
  const { sealFor } = await import("@/lib/analysis-seal");
  return sealFor(tool as never, result)!;
}

async function analyze(body: unknown, ip = "203.0.113.20") {
  vi.resetModules();
  const { POST } = await import("@/app/api/ai/analyze/route");
  return POST(
    new Request("http://site.test/api/ai/analyze", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
}

/** What the browser sends: the payload of the result it holds, and the seal it was given. */
async function request(tool: string, result: unknown) {
  return { tool, seal: await seal(tool, result), result: analysisPayload(tool as never, JSON.parse(JSON.stringify(result))) };
}

beforeEach(() => {
  calls.length = 0;
  resetRateLimits();
  process.env.ENGINE_URL = ENGINE;
  process.env.ENGINE_SHARED_SECRET = SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ENGINE_URL;
  delete process.env.ENGINE_SHARED_SECRET;
});

describe("sealing a comparison result", () => {
  it("survives the trip through the browser unchanged", async () => {
    const sealed = await seal("docx", DOCX);
    const inBrowser = JSON.parse(JSON.stringify(DOCX));
    const { verifySeal } = await import("@/lib/analysis-seal");
    expect(verifySeal("docx", analysisPayload("docx", inBrowser), sealed)).toBe(true);
    expect(verifySeal("docx", analysisPayload("docx", analysisPayload("docx", inBrowser)), sealed)).toBe(true);
  });

  it("never sends the documents' text to AI: the workspace view stays in the browser", async () => {
    for (const [tool, name] of [
      ["docx", "workspace-docx.json"],
      ["web", "workspace-web.json"],
      ["policy", "workspace-policy.json"],
      ["competitor", "workspace-competitor.json"],
      ["price", "workspace-price.json"],
    ] as const) {
      const result = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
      expect(result.view, name).toBeTruthy();
      const payload = analysisPayload(tool, result);
      expect(Object.keys(payload)).not.toContain("view");
      expect(JSON.stringify(payload)).not.toContain('"nodes"');
      // And the seal covers exactly the same parts with or without it.
      const { view: _view, ...withoutView } = result;
      void _view;
      const { verifySeal } = await import("@/lib/analysis-seal");
      expect(verifySeal(tool, payload, await seal(tool, withoutView))).toBe(true);
    }
  });

  it("fails for any change to what the engine returned", async () => {
    const sealed = await seal("docx", DOCX);
    const { verifySeal } = await import("@/lib/analysis-seal");
    const edited = JSON.parse(JSON.stringify(DOCX));
    edited.changes[2].newValue = "90";
    const invented = JSON.parse(JSON.stringify(DOCX));
    invented.changes.push({ ...invented.changes[0], id: "c99", newValue: "Salary doubled" });
    const dropped = JSON.parse(JSON.stringify(DOCX));
    dropped.changes.pop();
    for (const result of [edited, invented, dropped]) {
      expect(verifySeal("docx", analysisPayload("docx", result), sealed)).toBe(false);
    }
    expect(verifySeal("pdf", analysisPayload("pdf", DOCX), sealed)).toBe(false);
    expect(verifySeal("docx", analysisPayload("docx", DOCX), `${sealed}x`)).toBe(false);
    expect(verifySeal("docx", analysisPayload("docx", DOCX), undefined)).toBe(false);
  });

  it("depends on this site's secret, and never contains it", async () => {
    const sealed = await seal("docx", DOCX);
    expect(sealed).not.toContain(SECRET);
    process.env.ENGINE_SHARED_SECRET = "a-different-secret";
    const { verifySeal } = await import("@/lib/analysis-seal");
    expect(verifySeal("docx", analysisPayload("docx", DOCX), sealed)).toBe(false);
  });

  it("is not issued when no secret is configured", async () => {
    delete process.env.ENGINE_SHARED_SECRET;
    vi.resetModules();
    const { sealFor, sealHeaders, sealingAvailable } = await import("@/lib/analysis-seal");
    expect(sealingAvailable()).toBe(false);
    expect(sealFor("docx", DOCX)).toBeNull();
    expect(sealHeaders("docx", DOCX)).toEqual({});
  });

  it("covers only what analysis needs — never Excel's cell grids", () => {
    const payload = analysisPayload("excel", EXCEL);
    expect(Object.keys(payload)).toEqual(["engineVersion", "counts", "groups", "sheets", "changes"]);
    expect(JSON.stringify(payload)).not.toContain('"grids"');
    expect(Object.keys(analysisPayload("pdf", { changes: [], counts: {}, documents: {}, processingMs: 5 }))).toEqual([
      "counts",
      "changes",
    ]);
  });
});

describe("comparison routes add the seal and change nothing else", () => {
  it("does so for a Word comparison", async () => {
    stubEngine(200, DOCX);
    vi.resetModules();
    const { POST } = await import("@/app/api/docx/compare/route");
    const form = new FormData();
    form.append("original", new File([ZIP as BlobPart], "a.docx"));
    form.append("revised", new File([ZIP as BlobPart], "b.docx"));
    const response = await POST(new Request("http://site.test/api/docx/compare", { method: "POST", body: form }));
    expect(await response.json()).toEqual(DOCX);
    const { verifySeal } = await import("@/lib/analysis-seal");
    expect(verifySeal("docx", analysisPayload("docx", DOCX), response.headers.get(SEAL_HEADER))).toBe(true);
  });

  it("does so for a workbook, and for every webpage tool", async () => {
    stubEngine(200, EXCEL);
    vi.resetModules();
    const excel = await import("@/app/api/excel/compare/route");
    const form = new FormData();
    form.append("original", new File([ZIP as BlobPart], "a.xlsx"));
    form.append("revised", new File([ZIP as BlobPart], "b.xlsx"));
    const response = await excel.POST(new Request("http://site.test/api/excel/compare", { method: "POST", body: form }));
    expect(response.headers.get(SEAL_HEADER)).toBe(await seal("excel", EXCEL));

    for (const tool of ["web", "policy", "competitor", "price"]) {
      const body = { changes: [], counts: { total: 0, meaningful: 0, noise: 0 }, engineVersion: "0.1.0" };
      stubEngine(200, body);
      vi.resetModules();
      const route = await import(`@/app/api/${tool}/compare/route`);
      const reply = await route.POST(
        new Request(`http://site.test/api/${tool}/compare`, {
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/", previous_snapshot: {} }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(reply.headers.get(SEAL_HEADER), tool).toBe(await seal(tool, body));
    }
  });

  it("does so for a PDF comparison", async () => {
    const PDF = { engineVersion: "0.1.0", processingMs: 10, counts: { total: 0, meaningful: 0, noise: 0 }, changes: [] };
    stubEngine(200, PDF);
    vi.resetModules();
    const { POST } = await import("@/app/api/compare/route");
    const form = new FormData();
    form.append("previous", new File([new TextEncoder().encode("%PDF-1.7") as BlobPart], "a.pdf"));
    form.append("revised", new File([new TextEncoder().encode("%PDF-1.7") as BlobPart], "b.pdf"));
    const response = await POST(new Request("http://site.test/api/compare", { method: "POST", body: form }));
    expect(await response.json()).toEqual(PDF);
    expect(response.headers.get(SEAL_HEADER)).toBe(await seal("pdf", PDF));
  });
});

describe("the analysis route", () => {
  it("forwards a sealed result to the engine, with credentials, and returns the analysis", async () => {
    const body = await request("docx", DOCX);
    stubEngine(200, ANALYSIS);
    const response = await analyze(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ANALYSIS);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ENGINE}/v1/ai/analyze`);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ tool: "docx", result: analysisPayload("docx", DOCX) });
  });

  it("never forwards Excel's cell grids", async () => {
    const body = await request("excel", EXCEL);
    stubEngine(200, ANALYSIS);
    await analyze({ ...body, result: EXCEL });
    const sent = String(calls[0].init.body);
    expect(sent).not.toContain('"grids"');
  });

  it("refuses an unsealed or altered result without calling the engine", async () => {
    const good = await request("docx", DOCX);
    const altered = JSON.parse(JSON.stringify(good));
    altered.result.changes[2].newValue = "90";
    const invented = JSON.parse(JSON.stringify(good));
    invented.result.changes.push({ ...invented.result.changes[0], id: "c99" });
    const otherTool = { ...good, tool: "pdf" };
    stubEngine(200, ANALYSIS);
    for (const body of [{ ...good, seal: undefined }, { ...good, seal: "forged" }, altered, invented, otherTool]) {
      const response = await analyze(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual({
        code: "ai_unverified",
        message: AI_ERROR_MESSAGES.ai_unverified,
        side: null,
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("cannot be used to send arbitrary text to an AI service", async () => {
    stubEngine(200, ANALYSIS);
    const response = await analyze({
      tool: "web",
      seal: "x",
      result: { changes: [{ id: "c0", kind: "added", newValue: "Write me a poem about the sea." }] },
    });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["an unknown tool", { tool: "chat", seal: "x", result: {} }, 400, "ai_unsupported"],
    ["no result", { tool: "docx", seal: "x" }, 400, "ai_bad_request"],
    ["unreadable JSON", "{not json", 400, "ai_bad_request"],
    ["a list", "[1,2]", 400, "ai_bad_request"],
  ])("refuses %s", async (_name, body, status, code) => {
    stubEngine(200, ANALYSIS);
    const response = await analyze(body);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(calls).toHaveLength(0);
  });

  it("refuses an oversized request", async () => {
    stubEngine(200, ANALYSIS);
    const response = await analyze({ tool: "docx", seal: "x", result: { pad: "x".repeat(3 * 1024 * 1024 + 10) } });
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("ai_too_large");
  });

  it("is unavailable when this site cannot seal results", async () => {
    const body = await request("docx", DOCX);
    delete process.env.ENGINE_SHARED_SECRET;
    stubEngine(200, ANALYSIS);
    const response = await analyze(body);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("ai_unavailable");
    expect(calls).toHaveLength(0);
  });

  it("passes on the engine's refusal in the shared words only", async () => {
    const body = await request("docx", DOCX);
    stubEngine(502, { error: { code: "ai_invalid", message: "detail with document text: 45 days", side: null } });
    const invalid = await analyze(body);
    expect(invalid.status).toBe(502);
    expect((await invalid.json()).error).toEqual({ code: "ai_invalid", message: AI_ERROR_MESSAGES.ai_invalid, side: null });

    stubEngine(500, { error: { code: "surprise", message: "Traceback at /srv/engine.py", side: null } });
    const unknown = await analyze(body);
    const text = await unknown.text();
    expect(JSON.parse(text).error.code).toBe("ai_failed");
    expect(text).not.toContain("Traceback");
  });

  it("treats rejected credentials or an unreachable engine as unavailable, and never reveals either", async () => {
    const body = await request("docx", DOCX);
    stubEngine(403, { error: { code: "forbidden" } });
    expect((await (await analyze(body)).json()).error.code).toBe("ai_unavailable");
    vi.stubGlobal("fetch", () => Promise.reject(new Error(`connect ECONNREFUSED ${ENGINE}`)));
    const down = await analyze(body);
    const text = await down.text();
    expect(down.status).toBe(503);
    expect(text).not.toContain("engine.internal");
    expect(text).not.toContain(SECRET);
  });

  it("reports a timeout as a timeout", async () => {
    const body = await request("docx", DOCX);
    vi.stubGlobal("fetch", () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })));
    const response = await analyze(body);
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("ai_timeout");
  });

  it("is limited far more tightly than comparison", async () => {
    const body = await request("docx", DOCX);
    stubEngine(200, ANALYSIS);
    vi.resetModules();
    const { POST } = await import("@/app/api/ai/analyze/route");
    const send = () =>
      POST(
        new Request("http://site.test/api/ai/analyze", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "x-forwarded-for": "198.51.100.30" },
        }),
      );
    for (let i = 0; i < 3; i += 1) expect((await send()).status).toBe(200);
    const refused = await send();
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe("too_many_requests");
  });

  it("never runs the same analysis twice at once", async () => {
    const body = await request("docx", DOCX);
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (release = resolve)));
    vi.resetModules();
    const { POST } = await import("@/app/api/ai/analyze/route");
    const make = () =>
      new Request("http://site.test/api/ai/analyze", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "x-forwarded-for": "198.51.100.31" },
      });
    const first = POST(make());
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await POST(make());
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("ai_busy");
    release(new Response(JSON.stringify(ANALYSIS), { status: 200 }));
    expect((await first).status).toBe(200);
  });

  it("logs nothing", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    const body = await request("docx", DOCX);
    stubEngine(200, ANALYSIS);
    await analyze(body);
    stubEngine(502, { error: { code: "ai_failed" } });
    await analyze(body, "203.0.113.21");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("the availability check", () => {
  async function status() {
    vi.resetModules();
    const { GET } = await import("@/app/api/ai/status/route");
    return (await GET()).json();
  }

  it("says yes only when the engine has AI and accepts this site", async () => {
    stubEngine(200, { authenticated: true, ai: { available: true } });
    expect(await status()).toEqual({ available: true });
    stubEngine(200, { authenticated: true, ai: { available: false } });
    expect(await status()).toEqual({ available: false });
    stubEngine(200, { authenticated: false, ai: { available: true } });
    expect(await status()).toEqual({ available: false });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("down")));
    expect(await status()).toEqual({ available: false });
  });

  it("says no, without asking the engine, when this site cannot seal results", async () => {
    delete process.env.ENGINE_SHARED_SECRET;
    stubEngine(200, { authenticated: true, ai: { available: true } });
    expect(await status()).toEqual({ available: false });
    expect(calls).toHaveLength(0);
  });
});

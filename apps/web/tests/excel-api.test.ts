/**
 * The website's Excel Compare route.
 *
 * The browser sends two files to this site; this site sends them to the engine
 * with the shared secret, and passes back the result or a message from the
 * shared contract. The engine is stubbed, so these are about the proxy: what it
 * forwards, what it refuses without calling the engine, and what it never
 * reveals.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS, resetRateLimits } from "@/lib/rate-limit";
import { EXCEL_ERROR_MESSAGES } from "@/lib/validation";

const SECRET = "excel-secret-never-in-a-response";
const ENGINE = "http://engine.internal:8000";
const COMPARISON = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "excel-comparison.json"), "utf8"));

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

const calls: { url: string; init: RequestInit }[] = [];

function stubEngine(status: number, body: unknown) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
  });
}

function upload(files: Partial<Record<"original" | "revised", Uint8Array | string>>, ip = "203.0.113.7") {
  const form = new FormData();
  for (const [side, bytes] of Object.entries(files)) {
    if (typeof bytes === "string") form.append(side, bytes);
    else form.append(side, new File([bytes as BlobPart], `My Private ${side} Prices.xlsx`));
  }
  return new Request("http://site.test/api/excel/compare", {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": ip },
  });
}

async function post(files: Partial<Record<"original" | "revised", Uint8Array | string>>, ip?: string) {
  vi.resetModules();
  const { POST } = await import("@/app/api/excel/compare/route");
  return POST(upload(files, ip));
}

beforeEach(() => {
  calls.length = 0;
  resetRateLimits();
  process.env.ENGINE_URL = ENGINE;
  process.env.ENGINE_SHARED_SECRET = SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ENGINE_URL;
  delete process.env.ENGINE_SHARED_SECRET;
  delete process.env.DIFFNEXA_EXCEL_MAX_FILE_MB;
});

describe("comparing two Excel workbooks", () => {
  it("sends both files to the engine's Excel endpoint and returns its result", async () => {
    stubEngine(200, COMPARISON);
    const response = await post({ original: ZIP, revised: ZIP });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(COMPARISON);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ENGINE}/v1/excel/compare`);
    const sent = calls[0].init.body as FormData;
    expect((sent.get("original") as File).size).toBe(ZIP.length);
    expect((sent.get("revised") as File).size).toBe(ZIP.length);
  });

  it("never forwards the person's own filenames", async () => {
    stubEngine(200, COMPARISON);
    await post({ original: ZIP, revised: ZIP });
    const sent = calls[0].init.body as FormData;
    expect((sent.get("original") as File).name).toBe("original.xlsx");
    expect((sent.get("revised") as File).name).toBe("revised.xlsx");
  });

  it("authenticates to the engine on the server and never returns the secret or the address", async () => {
    stubEngine(200, COMPARISON);
    const response = await post({ original: ZIP, revised: ZIP });
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("engine.internal");
  });
});

describe("refusals", () => {
  it.each([
    ["no files", {}],
    ["only one file", { original: ZIP }],
    ["a text field instead of a file", { original: ZIP, revised: "not a file" }],
  ])("refuses %s without calling the engine", async (_name, files) => {
    stubEngine(200, COMPARISON);
    const response = await post(files);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });

  it("refuses an empty file, naming which one", async () => {
    stubEngine(200, COMPARISON);
    const response = await post({ original: ZIP, revised: new Uint8Array(0) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({
      code: "excel_empty_file",
      message: EXCEL_ERROR_MESSAGES.excel_empty_file,
      side: "revised",
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses an oversized file before calling the engine", async () => {
    process.env.DIFFNEXA_EXCEL_MAX_FILE_MB = "1";
    stubEngine(200, COMPARISON);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(ZIP);
    const response = await post({ original: big, revised: ZIP });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatchObject({ code: "excel_too_large", side: "original" });
    expect(calls).toHaveLength(0);
  });

  it("passes the engine's refusal on with the shared wording and the side", async () => {
    stubEngine(400, {
      error: { code: "excel_macro_enabled", message: "internal detail vbaProject.bin", side: "original" },
    });
    const response = await post({ original: ZIP, revised: ZIP });
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error).toEqual({
      code: "excel_macro_enabled",
      message: EXCEL_ERROR_MESSAGES.excel_macro_enabled,
      side: "original",
    });
  });

  it.each(["excel_legacy_xls", "excel_encrypted", "excel_too_complex", "excel_unsupported"])(
    "passes on the engine's %s refusal in the shared words",
    async (code) => {
      stubEngine(400, { error: { code, message: "detail from inside the workbook", side: "revised" } });
      const { error } = await (await post({ original: ZIP, revised: ZIP })).json();
      expect(error).toEqual({ code, message: EXCEL_ERROR_MESSAGES[code as keyof typeof EXCEL_ERROR_MESSAGES], side: "revised" });
    },
  );

  it("writes nothing about the workbooks to the server log", async () => {
    stubEngine(200, COMPARISON);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    await post({ original: ZIP, revised: ZIP });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });

  it("does not pass on wording that is not in the shared contract", async () => {
    stubEngine(500, { error: { code: "something_new", message: "Traceback at /srv/engine.py", side: null } });
    const text = await (await post({ original: ZIP, revised: ZIP })).text();
    expect(text).not.toContain("Traceback");
    expect(text).not.toContain("/srv/");
  });

  it("treats rejected credentials as the service being unavailable, not the person's fault", async () => {
    stubEngine(403, { error: { code: "forbidden", message: "bad credentials", side: null } });
    const response = await post({ original: ZIP, revised: ZIP });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("engine_unavailable");
  });

  it("reports an unreachable engine without revealing where it is", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error(`connect ECONNREFUSED ${ENGINE}`)));
    const response = await post({ original: ZIP, revised: ZIP });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("engine_unavailable");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("engine.internal");
  });
});

describe("rate limits", () => {
  it("has a bucket of its own, with the PDF comparison limits", () => {
    expect(LIMITS["excel-compare"]).toEqual(LIMITS["pdf-compare"]);
  });

  it("refuses a burst of comparisons from one visitor", async () => {
    stubEngine(200, COMPARISON);
    const { POST } = await import("@/app/api/excel/compare/route");
    const perMinute = LIMITS["excel-compare"][0].limit;
    for (let i = 0; i < perMinute; i += 1) {
      expect((await POST(upload({ original: ZIP, revised: ZIP }, "198.51.100.8"))).status).toBe(200);
    }
    const refused = await POST(upload({ original: ZIP, revised: ZIP }, "198.51.100.8"));
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe("too_many_requests");
  });
});

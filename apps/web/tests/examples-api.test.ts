/**
 * The routes behind "Try example" and the Ignore options.
 *
 * A web monitoring example asks the engine for its built-in example and sends
 * nothing else — no address is fetched and no file is read. The file
 * comparison routes pass Ignore options on to the engine only as an explicit
 * "true" or "false". The engine is stubbed; these are about the proxy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const SECRET = "examples-secret-never-in-a-response";
const ENGINE = "http://engine.internal:8000";

const calls: { url: string; init: RequestInit }[] = [];

function stubEngine(body: unknown = { changes: [], counts: { total: 0, meaningful: 0, noise: 0 } }) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  });
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
});

const TOOLS = ["web", "policy", "competitor", "price"] as const;

async function postJson(tool: (typeof TOOLS)[number], body: unknown) {
  vi.resetModules();
  const { POST } = await import(`@/app/api/${tool}/compare/route`);
  return POST(
    new Request(`http://site.test/api/${tool}/compare`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.50" },
    }),
  );
}

describe("Try example in the web monitoring tools", () => {
  it.each(TOOLS)("%s asks the engine for its example and sends nothing else", async (tool) => {
    stubEngine();
    const response = await postJson(tool, {
      example: true,
      url: "http://127.0.0.1/admin",
      previous_snapshot: { anything: "at all" },
    });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ENGINE}/v1/${tool}/compare`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ example: true });
  });

  it.each(TOOLS)("%s treats anything but a literal true as an ordinary check", async (tool) => {
    stubEngine();
    const response = await postJson(tool, { example: "true" });
    // An ordinary check needs an address, so this is refused before the engine is asked.
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each(TOOLS)("%s seals an example result like any other, so AI analysis can explain it", async (tool) => {
    stubEngine({ changes: [], counts: { total: 0, meaningful: 0, noise: 0 } });
    const response = await postJson(tool, { example: true });
    expect([...response.headers.keys()].some((key) => key.toLowerCase().includes("seal"))).toBe(true);
  });
});

async function postFiles(route: "compare" | "excel/compare", fields: Record<string, string>) {
  vi.resetModules();
  const { POST } = await import(`@/app/api/${route}/route`);
  const form = new FormData();
  const [a, b] = route === "compare" ? ["previous", "revised"] : ["original", "revised"];
  const bytes = route === "compare" ? [0x25, 0x50, 0x44, 0x46, 0x2d] : [0x50, 0x4b, 0x03, 0x04, 0x14];
  form.append(a, new File([new Uint8Array(bytes)], "a"), "a");
  form.append(b, new File([new Uint8Array(bytes)], "b"), "b");
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return POST(new Request(`http://site.test/api/${route}`, { method: "POST", body: form, headers: { "x-forwarded-for": "203.0.113.51" } }));
}

describe("Ignore options on the file comparison routes", () => {
  it("PDF Compare passes capitalisation and punctuation on under the engine's names", async () => {
    stubEngine();
    await postFiles("compare", { ignoreCase: "false", ignorePunctuation: "true" });
    const sent = calls[0].init.body as FormData;
    expect(sent.get("ignore_case")).toBe("false");
    expect(sent.get("ignore_punctuation")).toBe("true");
  });

  it("Excel Compare passes capitalisation and extra spaces on under the engine's names", async () => {
    stubEngine();
    await postFiles("excel/compare", { ignoreCase: "true", ignoreWhitespace: "true" });
    const sent = calls[0].init.body as FormData;
    expect(sent.get("ignore_case")).toBe("true");
    expect(sent.get("ignore_whitespace")).toBe("true");
  });

  it.each(["compare", "excel/compare"] as const)("%s passes on nothing but an explicit true or false", async (route) => {
    stubEngine();
    await postFiles(route, { ignoreCase: "yes", ignorePunctuation: "<b>", ignoreWhitespace: "1" });
    const sent = calls[0].init.body as FormData;
    for (const name of ["ignore_case", "ignore_punctuation", "ignore_whitespace"]) expect(sent.get(name)).toBeNull();
  });
});

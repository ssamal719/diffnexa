/**
 * The website's webpage-checking routes.
 *
 * These prove the boundary holds: the browser talks to this site, this site
 * talks to the engine, and the engine's address and shared secret never travel
 * in the other direction. The engine itself is stubbed, so these tests are
 * about the proxy's behaviour, not the comparison.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "w7-secret-never-in-a-response";
const ENGINE = "http://engine.internal:8000";

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

function stubEngine(status: number, body: unknown) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

function stubEngineFailure(error: Error) {
  vi.stubGlobal("fetch", () => Promise.reject(error));
}

async function post(route: "snapshot" | "compare", body: unknown, init: RequestInit = {}) {
  vi.resetModules();
  const handler = await import(`@/app/api/web/${route}/route`);
  return handler.POST(
    new Request(`http://site.test/api/web/${route}`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      ...init,
    }),
  );
}

const SNAPSHOT = { schema_version: "1", nodes: [], content_sha256: "a".repeat(64) };

const COMPARISON = {
  engineVersion: "0.1.0",
  processingMs: 120,
  documents: {
    previous: { url: "https://example.com/t", sha256: "a".repeat(64), nodeCount: 4 },
    revised: { url: "https://example.com/t", sha256: "b".repeat(64), nodeCount: 4 },
  },
  counts: { total: 1, meaningful: 1, noise: 0 },
  changes: [{ id: "c0", type: "NUMBER_CHANGED", oldValue: "50,000", newValue: "75,000" }],
  diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
};

beforeEach(() => {
  calls.length = 0;
  process.env.ENGINE_URL = ENGINE;
  process.env.ENGINE_SHARED_SECRET = SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ENGINE_URL;
  delete process.env.ENGINE_SHARED_SECRET;
});

// ---------------------------------------------------------------- happy paths

describe("capturing a page", () => {
  it("passes the address to the engine and returns the capture", async () => {
    stubEngine(200, { snapshot: SNAPSHOT });
    const response = await post("snapshot", { url: "  https://example.com/terms  " });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot: SNAPSHOT });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ENGINE}/v1/web/snapshot`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: "https://example.com/terms" });
  });
});

describe("comparing a page", () => {
  it("sends the address and the saved capture", async () => {
    stubEngine(200, COMPARISON);
    const response = await post("compare", {
      url: "https://example.com/terms",
      previous_snapshot: SNAPSHOT,
    });

    expect(response.status).toBe(200);
    expect((await response.json()).counts.meaningful).toBe(1);
    expect(calls[0].url).toBe(`${ENGINE}/v1/web/compare`);
    expect(JSON.parse(String(calls[0].init.body)).previous_snapshot).toEqual(SNAPSHOT);
  });

  it("accepts the camelCase spelling of the capture too", async () => {
    stubEngine(200, COMPARISON);
    await post("compare", { url: "https://example.com/t", previousSnapshot: SNAPSHOT });
    expect(JSON.parse(String(calls[0].init.body)).previous_snapshot).toEqual(SNAPSHOT);
  });
});

// ---------------------------------------------------------------- bad requests

describe("requests that cannot be served", () => {
  it.each([
    ["an empty body", ""],
    ["a body that is not JSON", "not json at all"],
    ["a JSON array", "[1,2,3]"],
  ])("refuses %s", async (_name, body) => {
    stubEngine(200, {});
    const response = await post("snapshot", body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });

  it.each([{}, { url: "" }, { url: "   " }, { url: 42 }])(
    "refuses a missing address without calling the engine",
    async (body) => {
      stubEngine(200, {});
      const response = await post("snapshot", body);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad_request");
      expect(calls).toHaveLength(0);
    },
  );

  it("refuses a comparison with no saved capture", async () => {
    stubEngine(200, {});
    const response = await post("compare", { url: "https://example.com/t" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("snapshot_unreadable");
    expect(calls).toHaveLength(0);
  });

  it("refuses an oversized body before parsing it", async () => {
    stubEngine(200, {});
    const huge = JSON.stringify({ url: "https://example.com/t", previous_snapshot: "x".repeat(11_000_000) });
    const response = await post("compare", huge);
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("page_too_large");
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- engine failures

describe("failures from the engine", () => {
  it.each([
    ["url_not_allowed", 400],
    ["url_unreachable", 400],
    ["url_not_html", 400],
    ["page_needs_javascript", 400],
    ["page_too_large", 413],
    ["snapshot_mismatch", 400],
    ["snapshot_unreadable", 400],
  ])("passes on %s with our own wording", async (code, status) => {
    stubEngine(status, { error: { code, message: "internal detail: /srv/app/engine.py line 42" } });
    const response = await post("snapshot", { url: "https://example.com/t" });
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
    expect(body.error.message).not.toContain("/srv/app");
    expect(body.error.message.length).toBeGreaterThan(20);
  });

  it("reports a timeout as a timeout", async () => {
    stubEngineFailure(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    const response = await post("snapshot", { url: "https://example.com/t" });
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe("fetch_timeout");
  });

  it("reports an unreachable engine without blaming the address", async () => {
    stubEngineFailure(new Error("ECONNREFUSED"));
    const response = await post("snapshot", { url: "https://example.com/t" });
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("engine_unavailable");
    expect(body.error.message).toContain("Nothing is wrong with the address");
  });

  it("treats an unreadable engine reply as a service failure", async () => {
    stubEngine(200, "this is not json");
    const response = await post("snapshot", { url: "https://example.com/t" });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("engine_unavailable");
  });
});

// ---------------------------------------------------------------- the boundary

describe("the browser never reaches the engine", () => {
  it("sends the shared secret to the engine", async () => {
    stubEngine(200, { snapshot: SNAPSHOT });
    await post("snapshot", { url: "https://example.com/t" });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("never returns the secret or the engine's address to the browser", async () => {
    const responses = [];
    stubEngine(200, { snapshot: SNAPSHOT });
    responses.push(await post("snapshot", { url: "https://example.com/t" }));
    stubEngine(200, COMPARISON);
    responses.push(await post("compare", { url: "https://example.com/t", previous_snapshot: SNAPSHOT }));
    stubEngine(400, { error: { code: "url_not_allowed", message: "blocked" } });
    responses.push(await post("snapshot", { url: "http://127.0.0.1/" }));
    stubEngineFailure(new Error("ECONNREFUSED"));
    responses.push(await post("snapshot", { url: "https://example.com/t" }));

    for (const response of responses) {
      const text = JSON.stringify(await response.json());
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("engine.internal");
      expect(text).not.toContain("Bearer");
    }
  });

  it("does not expose the secret under a NEXT_PUBLIC name", () => {
    const publicNames = Object.keys(process.env).filter((name) => name.startsWith("NEXT_PUBLIC_"));
    expect(publicNames).not.toContain("NEXT_PUBLIC_ENGINE_SHARED_SECRET");
    for (const name of publicNames) {
      expect(process.env[name]).not.toBe(SECRET);
    }
  });

  it("sends no Authorization header when no secret is configured", async () => {
    delete process.env.ENGINE_SHARED_SECRET;
    stubEngine(200, { snapshot: SNAPSHOT });
    await post("snapshot", { url: "https://example.com/t" });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

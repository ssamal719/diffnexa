/**
 * The website's Price Monitor routes.
 *
 * Same boundary as the other webpage routes: the browser talks to this site,
 * this site talks to the engine, and the engine's address and shared secret
 * never travel the other way. The engine is stubbed, so these are about the
 * proxy's behaviour rather than the comparison.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS, resetRateLimits } from "@/lib/rate-limit";

const SECRET = "price-secret-never-in-a-response";
const ENGINE = "http://engine.internal:8000";

const calls: { url: string; init: RequestInit }[] = [];

function stubEngine(status: number, body: unknown) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

async function post(route: "snapshot" | "compare", body: unknown, ip = "203.0.113.9") {
  vi.resetModules();
  const handler = await import(`@/app/api/price/${route}/route`);
  return handler.POST(
    new Request(`http://site.test/api/price/${route}`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    }),
  );
}

const SNAPSHOT = { schema_version: "1", nodes: [], content_sha256: "a".repeat(64) };

const COMPARISON = {
  engineVersion: "0.1.0",
  processingMs: 120,
  documents: {
    previous: { url: "https://acme.example.com/pricing", sha256: "a".repeat(64), nodeCount: 9 },
    revised: { url: "https://acme.example.com/pricing", sha256: "b".repeat(64), nodeCount: 9 },
  },
  counts: { total: 1, meaningful: 1, noise: 0 },
  changes: [
    {
      id: "c0",
      type: "NUMBER_CHANGED",
      oldValue: "$9",
      newValue: "$12",
      evidence: [{ side: "old", scope: "node", excerpt: "$9 per month" }],
      priceCategory: {
        category: "price",
        label: "Price",
        basis: "money",
        matchedText: "$12",
        reason: "“$12” is an amount with a currency",
      },
    },
  ],
  price: {
    rulesVersion: "2026.09.1",
    categories: [{ id: "price", label: "Price", changeCount: 1, changeIds: ["c0"] }],
    changedCategories: ["price"],
  },
  diagnostics: { notes: [], previousWarnings: [], revisedWarnings: [], needsJavascript: false },
};

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

describe("capturing a pricing page", () => {
  it("reuses the engine's webpage capture rather than a duplicate endpoint", async () => {
    stubEngine(200, { snapshot: SNAPSHOT });
    const response = await post("snapshot", { url: "  https://acme.example.com/pricing  " });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot: SNAPSHOT });
    expect(calls[0].url).toBe(`${ENGINE}/v1/web/snapshot`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: "https://acme.example.com/pricing" });
  });

  it("never forwards the product name or the page type", async () => {
    stubEngine(200, { snapshot: SNAPSHOT });
    await post("snapshot", {
      url: "https://acme.example.com/pricing",
      product: "GitHub Copilot",
      pageType: "saas_pricing",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: "https://acme.example.com/pricing" });
  });

  it("authenticates to the engine server-side and never returns the secret", async () => {
    stubEngine(200, { snapshot: SNAPSHOT });
    const response = await post("snapshot", { url: "https://acme.example.com/pricing" });
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(ENGINE);
  });
});

describe("checking a pricing page", () => {
  it("calls the price endpoint and returns the categories with the changes", async () => {
    stubEngine(200, COMPARISON);
    const response = await post("compare", {
      url: "https://acme.example.com/pricing",
      previous_snapshot: SNAPSHOT,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calls[0].url).toBe(`${ENGINE}/v1/price/compare`);
    expect(body.price.changedCategories).toEqual(["price"]);
    expect(body.changes[0].priceCategory.label).toBe("Price");
    expect(body.changes[0].evidence).toBeTruthy();
  });

  it("forwards only the address and the baseline", async () => {
    stubEngine(200, COMPARISON);
    await post("compare", {
      url: "https://acme.example.com/pricing",
      previous_snapshot: SNAPSHOT,
      product: "GitHub Copilot",
      pageType: "subscription_plan",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      url: "https://acme.example.com/pricing",
      previous_snapshot: SNAPSHOT,
    });
  });

  it("passes an engine refusal through with its own code", async () => {
    stubEngine(400, { error: { code: "snapshot_mismatch", message: "different page", side: null } });
    const response = await post("compare", {
      url: "https://acme.example.com/pricing",
      previous_snapshot: SNAPSHOT,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("snapshot_mismatch");
  });
});

describe("requests that cannot be served", () => {
  it.each([
    ["an empty body", ""],
    ["a body that is not JSON", "not json"],
    ["a JSON array", "[1,2]"],
  ])("refuses %s without calling the engine", async (_name, body) => {
    stubEngine(200, {});
    const response = await post("compare", body);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing address", async () => {
    stubEngine(200, {});
    const response = await post("snapshot", { url: "   " });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });

  it("refuses a comparison with no baseline", async () => {
    stubEngine(200, {});
    const response = await post("compare", { url: "https://acme.example.com/pricing" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("snapshot_unreadable");
    expect(calls).toHaveLength(0);
  });

  it("reports an unreachable engine without revealing where it is", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error(`connect ECONNREFUSED ${ENGINE}`)));
    const response = await post("snapshot", { url: "https://acme.example.com/pricing" });
    expect(response.status).toBeGreaterThanOrEqual(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("engine_unavailable");
    expect(text).not.toContain("engine.internal");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain(SECRET);
  });
});

describe("rate limits", () => {
  it("has buckets of its own, with the same limits as the other page tools", () => {
    expect(LIMITS["price-capture"]).toEqual(LIMITS["web-capture"]);
    expect(LIMITS["price-compare"]).toEqual(LIMITS["web-compare"]);
  });

  it("refuses a burst of checks from one visitor", async () => {
    stubEngine(200, COMPARISON);
    // One module instance throughout, so the limiter remembers each request.
    const { POST } = await import("@/app/api/price/compare/route");
    const send = () =>
      POST(
        new Request("http://site.test/api/price/compare", {
          method: "POST",
          body: JSON.stringify({ url: "https://acme.example.com/p", previous_snapshot: SNAPSHOT }),
          headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.4" },
        }),
      );
    const perMinute = LIMITS["price-compare"][0].limit;
    for (let i = 0; i < perMinute; i += 1) expect((await send()).status).toBe(200);
    const refused = await send();
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe("too_many_requests");
  });
});

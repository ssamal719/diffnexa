/**
 * The website's policy routes.
 *
 * Same boundary as the webpage routes: the browser talks to this site, this site
 * talks to the engine, and the engine's address and shared secret never travel
 * the other way. The engine is stubbed, so these are about the proxy's
 * behaviour rather than the comparison.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const SECRET = "p4-secret-never-in-a-response";
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

async function post(route: "snapshot" | "compare", body: unknown) {
  vi.resetModules();
  const handler = await import(`@/app/api/policy/${route}/route`);
  return handler.POST(
    new Request(`http://site.test/api/policy/${route}`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
    }),
  );
}

const SNAPSHOT = { schema_version: "1", nodes: [], content_sha256: "a".repeat(64) };

const COMPARISON = {
  engineVersion: "0.1.0",
  processingMs: 140,
  documents: {
    previous: { url: "https://example.com/terms", sha256: "a".repeat(64), nodeCount: 9 },
    revised: { url: "https://example.com/terms", sha256: "b".repeat(64), nodeCount: 9 },
  },
  counts: { total: 2, meaningful: 2, noise: 0 },
  changes: [
    {
      id: "c0",
      type: "NUMBER_CHANGED",
      oldValue: "12",
      newValue: "24",
      sections: ["Terms › Data retention"],
      evidence: [{ side: "old", scope: "node", excerpt: "retained for 12 months" }],
      policyTopics: [
        {
          topic: "data_retention",
          label: "Data retention",
          source: "heading",
          matchedText: "data retention",
          summary: "Touches Data retention",
        },
      ],
    },
    { id: "c1", type: "NUMBER_CHANGED", oldValue: "400", newValue: "520", policyTopics: [] },
  ],
  policy: {
    signalsVersion: "2026.09.1",
    topics: [
      { id: "data_retention", label: "Data retention", status: "changed", changeCount: 1 },
      { id: "governing_law", label: "Governing law", status: "present", changeCount: 0 },
      { id: "warranties", label: "Warranties", status: "not_found", changeCount: 0 },
    ],
    changedTopics: ["data_retention"],
    classifiedChanges: 1,
    unclassifiedChanges: 1,
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

// ---------------------------------------------------------------- capture

describe("capturing a policy page", () => {
  it("reuses the engine's webpage capture rather than a duplicate endpoint", async () => {
    stubEngine(200, { snapshot: SNAPSHOT });
    const response = await post("snapshot", { url: "  https://example.com/terms  " });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot: SNAPSHOT });
    expect(calls[0].url).toBe(`${ENGINE}/v1/web/snapshot`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: "https://example.com/terms" });
  });

  it("never forwards the person's policy label to the engine", async () => {
    stubEngine(200, { snapshot: SNAPSHOT });
    await post("snapshot", { url: "https://example.com/terms", policyType: "privacy_policy" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: "https://example.com/terms" });
  });
});

// ---------------------------------------------------------------- comparison

describe("checking a policy page", () => {
  it("calls the policy endpoint and returns the classification with the changes", async () => {
    stubEngine(200, COMPARISON);
    const response = await post("compare", {
      url: "https://example.com/terms",
      previous_snapshot: SNAPSHOT,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calls[0].url).toBe(`${ENGINE}/v1/policy/compare`);
    expect(body.policy.changedTopics).toEqual(["data_retention"]);
    expect(body.changes[0].policyTopics[0].summary).toBe("Touches Data retention");
  });

  it("passes changes through untouched, including unclassified ones", async () => {
    stubEngine(200, COMPARISON);
    const body = await (
      await post("compare", { url: "https://example.com/terms", previous_snapshot: SNAPSHOT })
    ).json();

    expect(body.changes).toHaveLength(2);
    expect(body.changes[1].policyTopics).toEqual([]);
    expect(body.counts.meaningful).toBe(2);
    expect(body.changes[0].evidence).toBeTruthy();
  });

  it("keeps the three topic statuses distinct", async () => {
    stubEngine(200, COMPARISON);
    const body = await (
      await post("compare", { url: "https://example.com/terms", previous_snapshot: SNAPSHOT })
    ).json();
    const statuses = Object.fromEntries(
      body.policy.topics.map((topic: { id: string; status: string }) => [topic.id, topic.status]),
    );
    expect(statuses).toEqual({
      data_retention: "changed",
      governing_law: "present",
      warranties: "not_found",
    });
  });

  it("accepts the camelCase spelling of the baseline", async () => {
    stubEngine(200, COMPARISON);
    await post("compare", { url: "https://example.com/t", previousSnapshot: SNAPSHOT });
    expect(JSON.parse(String(calls[0].init.body)).previous_snapshot).toEqual(SNAPSHOT);
  });
});

// ---------------------------------------------------------------- bad requests

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
    const response = await post("compare", { url: "https://example.com/terms" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("snapshot_unreadable");
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- engine failures

describe("failures from the engine", () => {
  it.each([
    ["url_not_allowed", 400],
    ["url_not_html", 400],
    ["page_needs_javascript", 400],
    ["snapshot_mismatch", 400],
    ["snapshot_unreadable", 400],
    ["page_too_large", 413],
  ])("passes on %s with our own wording", async (code, status) => {
    stubEngine(status, { error: { code, message: "internal: /srv/app/engine.py:42" } });
    const response = await post("compare", {
      url: "https://example.com/terms",
      previous_snapshot: SNAPSHOT,
    });
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
    expect(body.error.message).not.toContain("/srv/app");
  });

  it("reports an unreachable engine without blaming the address", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));
    const response = await post("compare", {
      url: "https://example.com/terms",
      previous_snapshot: SNAPSHOT,
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("engine_unavailable");
  });
});

// ---------------------------------------------------------------- limits and secrets

describe("abuse protection and the boundary", () => {
  // These import the handlers once and reuse them, because the limiter keeps its
  // counts in module scope. Reloading the module between calls, as the helper
  // above does, would hand each request a fresh empty bucket and prove nothing.
  it("limits policy checks", async () => {
    stubEngine(200, COMPARISON);
    vi.resetModules();
    const handler = await import("@/app/api/policy/compare/route");
    const request = () =>
      handler.POST(
        new Request("http://site.test/api/policy/compare", {
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/terms", previous_snapshot: SNAPSHOT }),
          headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.8" },
        }),
      );

    let refused = 0;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      if ((await request()).status === 429) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);
  });

  it("does not spend the webpage tool's allowance", async () => {
    stubEngine(200, COMPARISON);
    vi.resetModules();
    const policyHandler = await import("@/app/api/policy/compare/route");
    const webHandler = await import("@/app/api/web/compare/route");
    const body = JSON.stringify({ url: "https://example.com/t", previous_snapshot: SNAPSHOT });
    const headers = { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" };

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await policyHandler.POST(
        new Request("http://site.test/api/policy/compare", { method: "POST", body, headers }),
      );
    }
    const response = await webHandler.POST(
      new Request("http://site.test/api/web/compare", { method: "POST", body, headers }),
    );
    expect(response.status).not.toBe(429);
  });

  it("sends the shared secret to the engine and never to the browser", async () => {
    stubEngine(200, COMPARISON);
    const response = await post("compare", {
      url: "https://example.com/terms",
      previous_snapshot: SNAPSHOT,
    });

    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("engine.internal");
  });
});

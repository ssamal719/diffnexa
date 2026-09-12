import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  engineAuthHeaders,
  engineHealthTimeoutMs,
} from "@/lib/engine-config";

const SECRET = "correct-horse-battery-staple";

describe("health check timeout", () => {
  beforeEach(() => {
    delete process.env.ENGINE_HEALTH_TIMEOUT_MS;
  });

  it("is generous by default, so a sleeping engine is not called unavailable", () => {
    expect(engineHealthTimeoutMs()).toBe(60_000);
    expect(DEFAULT_HEALTH_TIMEOUT_MS).toBe(60_000);
  });

  it("can be changed in hosting settings", () => {
    process.env.ENGINE_HEALTH_TIMEOUT_MS = "5000";
    expect(engineHealthTimeoutMs()).toBe(5_000);
  });

  it("is read on each call, so no redeploy is needed after changing it", () => {
    process.env.ENGINE_HEALTH_TIMEOUT_MS = "1000";
    expect(engineHealthTimeoutMs()).toBe(1_000);
    process.env.ENGINE_HEALTH_TIMEOUT_MS = "2000";
    expect(engineHealthTimeoutMs()).toBe(2_000);
  });

  it.each(["", "   ", "not-a-number", "0", "-1"])(
    "falls back to the default for the unusable value %j",
    (value) => {
      process.env.ENGINE_HEALTH_TIMEOUT_MS = value;
      expect(engineHealthTimeoutMs()).toBe(DEFAULT_HEALTH_TIMEOUT_MS);
    },
  );
});

describe("engine credentials", () => {
  beforeEach(() => {
    delete process.env.ENGINE_SHARED_SECRET;
  });

  it("sends nothing when no secret is configured", () => {
    expect(engineAuthHeaders()).toEqual({});
  });

  it("sends a bearer token when a secret is configured", () => {
    process.env.ENGINE_SHARED_SECRET = SECRET;
    expect(engineAuthHeaders()).toEqual({ Authorization: `Bearer ${SECRET}` });
  });

  it("ignores surrounding whitespace from a pasted value", () => {
    process.env.ENGINE_SHARED_SECRET = `  ${SECRET}  `;
    expect(engineAuthHeaders()).toEqual({ Authorization: `Bearer ${SECRET}` });
  });

  it("treats a blank secret as not configured", () => {
    process.env.ENGINE_SHARED_SECRET = "   ";
    expect(engineAuthHeaders()).toEqual({});
  });

  it("is never exposed under a NEXT_PUBLIC_ name", () => {
    // NEXT_PUBLIC_ variables are inlined into the browser bundle. The engine
    // secret must never be one.
    const publicNames = Object.keys(process.env).filter((name) =>
      name.startsWith("NEXT_PUBLIC_"),
    );
    expect(publicNames).not.toContain("NEXT_PUBLIC_ENGINE_SHARED_SECRET");
    expect(publicNames.some((name) => /SECRET|TOKEN|KEY/i.test(name))).toBe(false);
  });
});

describe("the API routes actually send the credentials", () => {
  const calls: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.ENGINE_SHARED_SECRET = SECRET;
    process.env.ENGINE_URL = "http://engine.test";
    // ENGINE_URL is a module-level constant, read once when the module first
    // loads. That is correct in production, where the variable is set before
    // the server starts, but a test changing it afterwards must reload the
    // module for the new value to be picked up.
    vi.resetModules();
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ok",
            engine_version: "0.1.0",
            limits: {},
            requires_auth: true,
            authenticated: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ENGINE_SHARED_SECRET;
    delete process.env.ENGINE_URL;
  });

  function authorizationOf(init: RequestInit): string | undefined {
    return (init.headers as Record<string, string> | undefined)?.Authorization;
  }

  it("the status route sends the bearer token to /healthz", async () => {
    const { GET } = await import("@/app/api/engine-status/route");
    const response = await GET();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://engine.test/healthz");
    expect(authorizationOf(calls[0].init)).toBe(`Bearer ${SECRET}`);

    // The reply to the browser keeps its existing shape, and leaks nothing.
    const body = await response.json();
    expect(body).toEqual({ available: true, engineVersion: "0.1.0", limits: {} });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain("engine.test");
  });

  it("the compare route sends the bearer token to /v1/compare", async () => {
    const { POST } = await import("@/app/api/compare/route");

    const form = new FormData();
    form.append("previous", new File([new Uint8Array([1, 2, 3])], "a.pdf"), "a.pdf");
    form.append("revised", new File([new Uint8Array([4, 5, 6])], "b.pdf"), "b.pdf");

    await POST(new Request("http://site.test/api/compare", { method: "POST", body: form }));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://engine.test/v1/compare");
    expect(authorizationOf(calls[0].init)).toBe(`Bearer ${SECRET}`);
    expect(calls[0].init.method).toBe("POST");
  });

  it("reports the engine as unavailable when our credentials are rejected", async () => {
    // A reachable engine is not proof the secret matches: the health endpoint
    // is public so the hosting platform can poll it.
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ok",
            engine_version: "0.1.0",
            limits: {},
            requires_auth: true,
            authenticated: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    vi.resetModules();
    const { GET } = await import("@/app/api/engine-status/route");
    expect(await (await GET()).json()).toEqual({ available: false });
  });

  it("sends no Authorization header when no secret is configured", async () => {
    delete process.env.ENGINE_SHARED_SECRET;
    vi.resetModules();
    const { GET } = await import("@/app/api/engine-status/route");
    await GET();
    expect(authorizationOf(calls[0].init)).toBeUndefined();
  });
});

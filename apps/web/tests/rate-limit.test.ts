/**
 * Rate limiting on the expensive operations.
 *
 * These check both halves of the promise: that abuse is stopped, and that
 * ordinary use is not. A limit that gets in a real user's way would be worse
 * than no limit at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LIMITS,
  TOO_MANY_REQUESTS_MESSAGE,
  checkRateLimit,
  clientKey,
  resetRateLimits,
} from "@/lib/rate-limit";

beforeEach(() => resetRateLimits());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the limits themselves", () => {
  it("cover every expensive operation", () => {
    expect(Object.keys(LIMITS).sort()).toEqual([
      "competitor-capture",
      "competitor-compare",
      "pdf-compare",
      "policy-capture",
      "policy-compare",
      "web-capture",
      "web-compare",
    ]);
    for (const rules of Object.values(LIMITS)) {
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.limit).toBeGreaterThan(0);
        expect(rule.windowMs).toBeGreaterThan(0);
      }
    }
  });

  it("allow enough for real use", () => {
    // Ten comparisons a minute is brisk for a person working through documents.
    const perMinute = LIMITS["pdf-compare"]!.find((rule) => rule.windowMs === 60_000);
    expect(perMinute!.limit).toBeGreaterThanOrEqual(10);
  });
});

describe("enforcement", () => {
  it("allows requests up to the limit and then refuses", () => {
    const rule = LIMITS["pdf-compare"]![0]!;
    for (let index = 0; index < rule.limit; index += 1) {
      expect(checkRateLimit("pdf-compare", "1.2.3.4").allowed).toBe(true);
    }
    const refused = checkRateLimit("pdf-compare", "1.2.3.4");
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("limits each client separately", () => {
    const rule = LIMITS["web-capture"]![0]!;
    for (let index = 0; index < rule.limit; index += 1) checkRateLimit("web-capture", "1.1.1.1");
    expect(checkRateLimit("web-capture", "1.1.1.1").allowed).toBe(false);
    expect(checkRateLimit("web-capture", "2.2.2.2").allowed).toBe(true);
  });

  it("limits each operation separately", () => {
    const rule = LIMITS["web-capture"]![0]!;
    for (let index = 0; index < rule.limit; index += 1) checkRateLimit("web-capture", "3.3.3.3");
    expect(checkRateLimit("web-capture", "3.3.3.3").allowed).toBe(false);
    expect(checkRateLimit("pdf-compare", "3.3.3.3").allowed).toBe(true);
  });

  it("lets a client through again once the window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const rule = LIMITS["pdf-compare"]![0]!;
    for (let index = 0; index < rule.limit; index += 1) checkRateLimit("pdf-compare", "4.4.4.4");
    expect(checkRateLimit("pdf-compare", "4.4.4.4").allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:01:30Z"));
    expect(checkRateLimit("pdf-compare", "4.4.4.4").allowed).toBe(true);
  });

  it("still holds the hourly ceiling after the minute window resets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const hourly = LIMITS["web-capture"]!.find((rule) => rule.windowMs > 60_000)!;

    let allowed = 0;
    for (let minute = 0; minute < 40; minute += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, minute, 0)));
      for (let index = 0; index < 5; index += 1) {
        if (checkRateLimit("web-capture", "5.5.5.5").allowed) allowed += 1;
      }
    }
    expect(allowed).toBe(hourly.limit);
  });

  it("does not limit an operation it does not know about", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(checkRateLimit("something-cheap", "6.6.6.6").allowed).toBe(true);
    }
  });
});

describe("identifying the client", () => {
  it("uses the address the proxy reports", () => {
    const request = new Request("http://site.test/", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientKey(request)).toBe("203.0.113.9");
  });

  it("falls back to the real-ip header", () => {
    const request = new Request("http://site.test/", { headers: { "x-real-ip": "203.0.113.5" } });
    expect(clientKey(request)).toBe("203.0.113.5");
  });

  it("limits everyone together rather than nobody when there is no address", () => {
    expect(clientKey(new Request("http://site.test/"))).toBe("unknown-client");
  });
});

describe("the message shown when a limit is hit", () => {
  it("explains what happened without jargon", () => {
    expect(TOO_MANY_REQUESTS_MESSAGE).toContain("wait a moment");
    expect(TOO_MANY_REQUESTS_MESSAGE).not.toMatch(/rate|429|throttle|quota/i);
  });
});

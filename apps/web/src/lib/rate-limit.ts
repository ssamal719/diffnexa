/**
 * Rate limiting for the operations that cost real money and time.
 *
 * Comparing two PDFs and fetching a web page are both expensive: they occupy a
 * worker for seconds and, in the web case, make our server reach out to
 * somewhere else. Without a limit one script can occupy the service all day, and
 * the web endpoints could be turned into a way to send traffic at a third party
 * from our address.
 *
 * The design is deliberately small. There is no database and no accounts, and
 * adding either to solve this would be the wrong trade for a product with no
 * users yet. So this is an in-memory sliding window, per client address, in the
 * Next.js process.
 *
 * What that honestly buys, and what it does not:
 *
 * * It stops casual abuse and accidental loops, which is what actually happens.
 * * It resets when the process restarts or is redeployed.
 * * It is per process, so it would not hold if the site were ever run as several
 *   processes behind a load balancer.
 * * It is keyed on the address the proxy reports, which a determined attacker
 *   can vary.
 *
 * A determined attacker needs network-level protection, which belongs to the
 * host rather than to application code. This is the sensible minimum, and saying
 * plainly what it does not cover is part of it being sensible.
 */

export type RateLimit = { limit: number; windowMs: number };

/**
 * The limits, and the reasoning.
 *
 * A person comparing documents does a handful in a sitting; ten a minute is
 * already brisk. Page captures are lighter than comparisons but reach outside,
 * so they are limited more tightly than the maths alone would suggest — being a
 * polite visitor to other people's sites matters as much as protecting our own
 * service. The hourly ceilings stop a slow drip adding up to a large bill.
 */
export const LIMITS: Record<string, RateLimit[]> = {
  "pdf-compare": [
    { limit: 10, windowMs: 60_000 },
    { limit: 60, windowMs: 60 * 60_000 },
  ],
  "web-capture": [
    { limit: 10, windowMs: 60_000 },
    { limit: 100, windowMs: 60 * 60_000 },
  ],
  "web-compare": [
    { limit: 10, windowMs: 60_000 },
    { limit: 100, windowMs: 60 * 60_000 },
  ],
  // Policy operations do the same work as the webpage ones — fetch a page and
  // compare it — so they carry the same limits. Separate buckets mean checking
  // a policy does not consume someone's allowance for checking a page.
  "policy-capture": [
    { limit: 10, windowMs: 60_000 },
    { limit: 100, windowMs: 60 * 60_000 },
  ],
  "policy-compare": [
    { limit: 10, windowMs: 60_000 },
    { limit: 100, windowMs: 60 * 60_000 },
  ],
};

type Hit = { at: number };

const buckets = new Map<string, Hit[]>();
let lastSweep = 0;

/** Drops expired entries so an idle process does not grow forever. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  const longest = Math.max(...Object.values(LIMITS).flat().map((rule) => rule.windowMs));
  for (const [key, hits] of buckets) {
    const kept = hits.filter((hit) => now - hit.at < longest);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
  }
}

/**
 * The client's address, as the hosting proxy reports it.
 *
 * Falls back to a single shared bucket when no address is available, which
 * limits everyone together rather than limiting nobody.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown-client";
}

export type RateDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(operation: keyof typeof LIMITS | string, key: string): RateDecision {
  const rules = LIMITS[operation];
  if (!rules) return { allowed: true };

  const now = Date.now();
  sweep(now);

  const bucketKey = `${operation}:${key}`;
  const hits = (buckets.get(bucketKey) ?? []).filter(
    (hit) => now - hit.at < Math.max(...rules.map((rule) => rule.windowMs)),
  );

  for (const rule of rules) {
    const inWindow = hits.filter((hit) => now - hit.at < rule.windowMs);
    if (inWindow.length >= rule.limit) {
      const oldest = Math.min(...inWindow.map((hit) => hit.at));
      const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000));
      buckets.set(bucketKey, hits);
      return { allowed: false, retryAfterSeconds };
    }
  }

  hits.push({ at: now });
  buckets.set(bucketKey, hits);
  return { allowed: true };
}

/** Used by tests so one case cannot leak into the next. */
export function resetRateLimits() {
  buckets.clear();
  lastSweep = 0;
}

export const TOO_MANY_REQUESTS_MESSAGE =
  "You've made a lot of requests in a short time. Please wait a moment and try again.";

/**
 * Where the comparison engine lives, and how long we wait for it.
 *
 * Server-side only. The engine's address is never sent to the browser: the
 * browser talks to this site's own API routes, which call the engine. That
 * keeps the engine off the public internet and means one place to add
 * authentication later.
 */

export const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8000";

/** Comparison of a large document legitimately takes a while. */
export const COMPARE_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS ?? 120_000);

/** A health check should answer immediately or be treated as unavailable. */
export const HEALTH_TIMEOUT_MS = 2_500;

/** Matches the engine's own ceiling; the engine re-checks it regardless. */
export const MAX_UPLOAD_BYTES =
  Number(process.env.DIFFNEXA_MAX_FILE_MB ?? 50) * 1024 * 1024;

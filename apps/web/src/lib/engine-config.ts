/**
 * Where the comparison engine lives, how long we wait for it, and how we
 * prove to it that a request came from this site.
 *
 * Server-side only. The engine's address and shared secret are never sent to
 * the browser: the browser talks to this site's own API routes, which call the
 * engine. Nothing here may be imported into a client component, and none of
 * these variables is prefixed NEXT_PUBLIC_, so none is bundled for the browser.
 */

export const ENGINE_URL = process.env.ENGINE_URL ?? "http://127.0.0.1:8000";

/** Comparison of a large document legitimately takes a while. */
export const COMPARE_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS ?? 120_000);

/** Matches the engine's own ceiling; the engine re-checks it regardless. */
export const MAX_UPLOAD_BYTES = Number(process.env.DIFFNEXA_MAX_FILE_MB ?? 50) * 1024 * 1024;

/** The Word document ceiling. Matches the engine's DIFFNEXA_DOCX_MAX_FILE_MB. */
export const DOCX_MAX_UPLOAD_BYTES =
  Number(process.env.DIFFNEXA_DOCX_MAX_FILE_MB ?? 20) * 1024 * 1024;

/**
 * How long to wait for the engine's health check.
 *
 * The default is generous on purpose. When the engine is hosted on a plan that
 * puts idle instances to sleep, the first request after a quiet spell has to
 * wait for it to start again, which can take the better part of a minute. A
 * short timeout would report a perfectly healthy engine as unavailable and
 * disable the Compare button for the first visitor of the day.
 *
 * Read on each call rather than once at module load, so the value can be
 * changed in hosting settings without redeploying.
 */
export const DEFAULT_HEALTH_TIMEOUT_MS = 60_000;

export function engineHealthTimeoutMs(): number {
  const raw = process.env.ENGINE_HEALTH_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_HEALTH_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_HEALTH_TIMEOUT_MS;
}

/** The header the engine checks. Standard bearer-token form. */
export const ENGINE_AUTH_HEADER = "authorization";

/**
 * Credentials for the engine, if a shared secret is configured.
 *
 * When ENGINE_SHARED_SECRET is unset (local development), no header is sent and
 * the engine accepts the request. Once it is set on both sides, the engine
 * rejects anything without it.
 */
export function engineAuthHeaders(): Record<string, string> {
  const secret = process.env.ENGINE_SHARED_SECRET;
  if (!secret || secret.trim() === "") return {};
  return { Authorization: `Bearer ${secret.trim()}` };
}

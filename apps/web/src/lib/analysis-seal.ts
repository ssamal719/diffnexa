/**
 * Sealing comparison results, so AI analysis only ever sees DiffNexa's own output.
 *
 * Server-side only. Nothing here may be imported into a client component.
 *
 * When this site's server passes a comparison result from the engine to the
 * browser, it adds a seal: an HMAC of the part AI analysis would use, keyed by a
 * value derived from the engine's shared secret. When the browser later asks
 * for AI analysis, it sends that part and the seal back, and the server checks
 * the seal before anything is forwarded. So:
 *
 * * AI Change Analyst receives only results the deterministic engine produced —
 *   a changed value, an invented change or any other text fails the check;
 * * the analysis endpoint cannot be used as a general-purpose AI service.
 *
 * Nothing is stored: the seal travels with the result. The key never leaves the
 * server, and it is not the shared secret itself.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { SEAL_HEADER, analysisPayload, type AnalysisTool } from "@/lib/analysis";
import { engineSecret } from "@/lib/engine-config";

function sealKey(): Buffer | null {
  const secret = engineSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update("diffnexa/ai-analysis-seal/v1").digest();
}

/** Whether results can be sealed here (the shared secret is configured). */
export function sealingAvailable(): boolean {
  return engineSecret() !== null;
}

export function sealFor(tool: AnalysisTool, result: unknown): string | null {
  const key = sealKey();
  if (!key) return null;
  const payload = JSON.stringify(analysisPayload(tool, result));
  return createHmac("sha256", key).update(`${tool}\n${payload}`).digest("base64url");
}

export function verifySeal(tool: AnalysisTool, result: unknown, seal: unknown): boolean {
  if (typeof seal !== "string" || seal.length === 0 || seal.length > 128) return false;
  const expected = sealFor(tool, result);
  if (!expected) return false;
  const given = Buffer.from(seal);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** The header that carries a result's seal, or none when sealing is off. */
export function sealHeaders(tool: AnalysisTool, result: unknown): Record<string, string> {
  const seal = sealFor(tool, result);
  return seal ? { [SEAL_HEADER]: seal } : {};
}

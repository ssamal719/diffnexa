/**
 * Talking to the comparison engine from this site's own server.
 *
 * The browser never holds the engine's address or its shared secret, and never
 * reaches the engine directly: it calls a route on this site, and the route
 * makes the request. That keeps the engine off the public internet and leaves
 * one place to add authentication, limits or logging later.
 *
 * Server-side only. Nothing here may be imported into a client component.
 */

import { NextResponse } from "next/server";

import type { AnalysisTool } from "@/lib/analysis";
import { sealHeaders } from "@/lib/analysis-seal";
import { COMPARE_TIMEOUT_MS, ENGINE_URL, engineAuthHeaders } from "@/lib/engine-config";
import { webErrorMessage } from "@/lib/validation";

/** Matches the engine's own ceiling; the engine re-checks it regardless. */
export const MAX_JSON_BYTES = 10 * 1024 * 1024;

export type EngineFailure = { code: string; message: string; side?: string | null };

export function failure(status: number, code: string, message: string): NextResponse {
  const headers = status === 429 ? { "Retry-After": "60" } : undefined;
  return NextResponse.json({ error: { code, message, side: null } }, { status, headers });
}

/**
 * Reads a JSON request body, refusing anything oversized or malformed.
 *
 * The body may carry an uploaded capture, so it is untrusted and is size-checked
 * before it is parsed rather than after.
 */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_JSON_BYTES) {
    return {
      ok: false,
      response: failure(413, "page_too_large", webErrorMessage("page_too_large")!),
    };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: failure(400, "bad_request", webErrorMessage("bad_request")!) };
  }

  if (raw.length > MAX_JSON_BYTES) {
    return {
      ok: false,
      response: failure(413, "page_too_large", webErrorMessage("page_too_large")!),
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: failure(400, "bad_request", webErrorMessage("bad_request")!) };
  }
}

/**
 * Forwards a request to the engine and returns its reply.
 *
 * The engine's address, the shared secret and any internal detail in a failure
 * stay on this side; the browser sees a code and a sentence.
 *
 * A comparison result is returned with a seal for `sealAs`, so it can be sent
 * for AI analysis later (see analysis-seal.ts).
 */
export async function callEngine(path: string, payload: unknown, sealAs?: AnalysisTool): Promise<NextResponse> {
  let response: Response;
  try {
    response = await fetch(`${ENGINE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...engineAuthHeaders() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(COMPARE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return timedOut
      ? failure(504, "fetch_timeout", webErrorMessage("fetch_timeout")!)
      : failure(503, "engine_unavailable", webErrorMessage("engine_unavailable")!);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const engineError = (body as { error?: EngineFailure } | null)?.error;
    const code = engineError?.code ?? "engine_unavailable";
    const message =
      webErrorMessage(code) ??
      engineError?.message ??
      webErrorMessage("engine_unavailable")!;
    return failure(response.status, code, message);
  }

  if (body === null || typeof body !== "object") {
    // A reply we cannot read is a service failure, not a result to pass on.
    return failure(502, "engine_unavailable", webErrorMessage("engine_unavailable")!);
  }

  return NextResponse.json(body, { status: 200, headers: sealAs ? sealHeaders(sealAs, body) : undefined });
}

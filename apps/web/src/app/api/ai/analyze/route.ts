import { NextResponse } from "next/server";

import { aiErrorMessage, analysisPayload, isAnalysisTool, type AIErrorCode } from "@/lib/analysis";
import { sealingAvailable, verifySeal } from "@/lib/analysis-seal";
import { AI_TIMEOUT_MS, ENGINE_URL, engineAuthHeaders } from "@/lib/engine-config";
import { TOO_MANY_REQUESTS_MESSAGE, checkRateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A comparison result without Excel's cell grids is far smaller than this. */
export const MAX_ANALYSIS_BYTES = 3 * 1024 * 1024;

/** Analyses in progress, by visitor and result, so a double click never pays twice. */
const running = new Set<string>();

function failure(status: number, code: AIErrorCode | "too_many_requests", retryAfter?: number): NextResponse {
  const message = code === "too_many_requests" ? TOO_MANY_REQUESTS_MESSAGE : aiErrorMessage(code)!;
  return NextResponse.json(
    { error: { code, message, side: null } },
    { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined },
  );
}

/**
 * AI Change Analyst: explains a comparison the person already has.
 *
 * Accepts only a result this site sealed when the engine returned it (see
 * analysis-seal.ts), so what reaches the AI service is always DiffNexa's own
 * deterministic output — its changes and evidence, never the person's files.
 * Nothing is stored and nothing is logged. A failure here never touches the
 * comparison on the person's screen.
 */
export async function POST(request: Request) {
  const decision = checkRateLimit("ai-analyze", clientKey(request));
  if (!decision.allowed) return failure(429, "too_many_requests", decision.retryAfterSeconds);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_ANALYSIS_BYTES) return failure(413, "ai_too_large");

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return failure(400, "ai_bad_request");
  }
  if (raw.length > MAX_ANALYSIS_BYTES) return failure(413, "ai_too_large");

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return failure(400, "ai_bad_request");
  }

  const tool = body.tool;
  if (!isAnalysisTool(tool)) return failure(400, "ai_unsupported");
  if (!sealingAvailable()) return failure(503, "ai_unavailable");
  if (typeof body.result !== "object" || body.result === null) return failure(400, "ai_bad_request");

  const payload = analysisPayload(tool, body.result);
  if (!verifySeal(tool, payload, body.seal)) return failure(400, "ai_unverified");

  const key = `${clientKey(request)}:${body.seal as string}`;
  if (running.has(key)) return failure(409, "ai_busy");
  running.add(key);
  try {
    let response: Response;
    try {
      response = await fetch(`${ENGINE_URL}/v1/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...engineAuthHeaders() },
        body: JSON.stringify({ tool, result: payload }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return timedOut ? failure(504, "ai_timeout") : failure(503, "ai_unavailable");
    }

    let reply: unknown = null;
    try {
      reply = await response.json();
    } catch {
      reply = null;
    }

    if (response.status === 401 || response.status === 403) return failure(503, "ai_unavailable");
    if (!response.ok) {
      const code = (reply as { error?: { code?: string } } | null)?.error?.code ?? "";
      // Only wording from the shared contract reaches the browser.
      return aiErrorMessage(code) ? failure(response.status, code as AIErrorCode) : failure(502, "ai_failed");
    }
    if (reply === null || typeof reply !== "object") return failure(502, "ai_failed");
    return NextResponse.json(reply, { status: 200 });
  } finally {
    running.delete(key);
  }
}

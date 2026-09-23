import { NextResponse } from "next/server";

import { sealHeaders } from "@/lib/analysis-seal";
import {
  COMPARE_TIMEOUT_MS,
  DOCX_MAX_UPLOAD_BYTES,
  ENGINE_URL,
  engineAuthHeaders,
} from "@/lib/engine-config";
import { TOO_MANY_REQUESTS_MESSAGE, checkRateLimit, clientKey } from "@/lib/rate-limit";
import { DOCX_ERROR_MESSAGES, docxErrorMessage, webErrorMessage } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Side = "original" | "revised";
type EngineFailure = { code: string; message: string; side?: string | null };

function failure(status: number, code: string, message: string, side?: Side | null): NextResponse {
  return NextResponse.json({ error: { code, message, side: side ?? null } }, { status });
}

/**
 * Compares two Word documents by passing both to the engine.
 *
 * The files are held in memory for the length of this request and forwarded;
 * nothing is written to disk and nothing is logged. The engine repeats every
 * check below on the actual bytes and then reads the documents without running
 * macros or following links, so these checks are a fast refusal, not the
 * security boundary.
 */
export async function POST(request: Request) {
  // A comparison occupies a worker, so it is limited before the body is read.
  const decision = checkRateLimit("docx-compare", clientKey(request));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: { code: "too_many_requests", message: TOO_MANY_REQUESTS_MESSAGE, side: null } },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > DOCX_MAX_UPLOAD_BYTES * 2 + 1024 * 1024) {
    return failure(413, "docx_too_large", DOCX_ERROR_MESSAGES.docx_too_large);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(400, "bad_request", "The upload could not be read. Please try again.");
  }

  const original = form.get("original");
  const revised = form.get("revised");
  if (!(original instanceof File) || !(revised instanceof File)) {
    return failure(400, "bad_request", "Choose both an original and a revised Word document before comparing.");
  }

  for (const [side, file] of [
    ["original", original],
    ["revised", revised],
  ] as const) {
    if (file.size === 0) return failure(400, "docx_empty_file", DOCX_ERROR_MESSAGES.docx_empty_file, side);
    if (file.size > DOCX_MAX_UPLOAD_BYTES) {
      return failure(413, "docx_too_large", DOCX_ERROR_MESSAGES.docx_too_large, side);
    }
  }

  // Fixed names: the person's own filenames never leave this server.
  const outgoing = new FormData();
  outgoing.append("original", original, "original.docx");
  outgoing.append("revised", revised, "revised.docx");

  let response: Response;
  try {
    response = await fetch(`${ENGINE_URL}/v1/docx/compare`, {
      method: "POST",
      headers: engineAuthHeaders(),
      body: outgoing,
      signal: AbortSignal.timeout(COMPARE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return timedOut
      ? failure(504, "timeout", "The comparison took longer than expected. Try again, or use shorter documents.")
      : failure(503, "engine_unavailable", webErrorMessage("engine_unavailable")!);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 401 || response.status === 403) {
    // A credentials mismatch between this site and the engine is a service
    // fault, not something the person uploading can fix.
    return failure(503, "engine_unavailable", webErrorMessage("engine_unavailable")!);
  }

  if (!response.ok) {
    const engineError = (body as { error?: EngineFailure } | null)?.error;
    const code = engineError?.code ?? "comparison_failed";
    const side = engineError?.side === "original" || engineError?.side === "revised" ? engineError.side : null;
    // Only wording from the shared contract reaches the browser.
    const message = docxErrorMessage(code) ?? "The comparison could not be completed. Please try again.";
    return failure(response.status, code, message, side);
  }

  if (body === null || typeof body !== "object") {
    return failure(502, "engine_unavailable", webErrorMessage("engine_unavailable")!);
  }

  // The seal lets this result be sent for AI analysis later, and nothing else.
  return NextResponse.json(body, { status: 200, headers: sealHeaders("docx", body) });
}

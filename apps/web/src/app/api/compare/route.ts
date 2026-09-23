import { NextResponse } from "next/server";

import { sealHeaders } from "@/lib/analysis-seal";
import {
  COMPARE_TIMEOUT_MS,
  ENGINE_URL,
  engineAuthHeaders,
  MAX_UPLOAD_BYTES,
} from "@/lib/engine-config";
import { TOO_MANY_REQUESTS_MESSAGE, checkRateLimit, clientKey } from "@/lib/rate-limit";
import { ERROR_MESSAGES, type ErrorCode } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Failure = { code: string; message: string; side?: string | null };

function failure(status: number, code: string, message: string, side?: string): NextResponse {
  return NextResponse.json({ error: { code, message, side: side ?? null } }, { status });
}

function friendly(code: string): string | null {
  return code in ERROR_MESSAGES ? ERROR_MESSAGES[code as ErrorCode] : null;
}

/**
 * Runs a real comparison by passing both PDFs to the engine.
 *
 * The files are streamed straight through and never written to disk here. The
 * engine repeats every validation check on the actual bytes, so the checks
 * below are a fast rejection, not the security boundary.
 */
export async function POST(request: Request) {
  // Comparison occupies a worker for seconds, so it is limited before the body
  // is read rather than after the work has already been paid for.
  const decision = checkRateLimit("pdf-compare", clientKey(request));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: { code: "too_many_requests", message: TOO_MANY_REQUESTS_MESSAGE, side: null } },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(400, "bad_request", "The upload could not be read. Please try again.");
  }

  const previous = form.get("previous");
  const revised = form.get("revised");

  if (!(previous instanceof File) || !(revised instanceof File)) {
    return failure(400, "bad_request", "Choose both a previous and a new PDF before comparing.");
  }

  for (const [side, file] of [
    ["previous", previous],
    ["revised", revised],
  ] as const) {
    if (file.size === 0) {
      return failure(400, "empty_file", ERROR_MESSAGES.empty_file, side);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return failure(413, "file_too_large", ERROR_MESSAGES.file_too_large, side);
    }
  }

  if (previous.size + revised.size > MAX_UPLOAD_BYTES * 2) {
    return failure(413, "file_too_large", ERROR_MESSAGES.file_too_large, undefined);
  }

  const outgoing = new FormData();
  outgoing.append("previous", previous, "previous.pdf");
  outgoing.append("revised", revised, "revised.pdf");

  let response: Response;
  try {
    response = await fetch(`${ENGINE_URL}/v1/compare`, {
      method: "POST",
      headers: engineAuthHeaders(),
      body: outgoing,
      signal: AbortSignal.timeout(COMPARE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return timedOut
      ? failure(
          504,
          "timeout",
          "The comparison took longer than expected. Try again, or use shorter documents.",
        )
      : failure(
          503,
          "engine_unavailable",
          "The comparison engine isn't running, so no comparison can be made right now.",
        );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: Failure } | null;
    const code = body?.error?.code ?? "comparison_failed";
    const message =
      friendly(code) ??
      body?.error?.message ??
      "The comparison could not be completed. Please try again.";
    return failure(response.status, code, message, body?.error?.side ?? undefined);
  }

  const body = await response.json();
  // The seal lets this result be sent for AI analysis later, and nothing else.
  return NextResponse.json(body, { status: 200, headers: sealHeaders("pdf", body) });
}

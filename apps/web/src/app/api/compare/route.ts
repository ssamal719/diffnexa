import { NextResponse } from "next/server";

import { COMPARE_TIMEOUT_MS, ENGINE_URL, MAX_UPLOAD_BYTES } from "@/lib/engine-config";
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

  const outgoing = new FormData();
  outgoing.append("previous", previous, "previous.pdf");
  outgoing.append("revised", revised, "revised.pdf");

  let response: Response;
  try {
    response = await fetch(`${ENGINE_URL}/v1/compare`, {
      method: "POST",
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

  return NextResponse.json(await response.json(), { status: 200 });
}

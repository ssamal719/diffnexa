import { callEngine, failure, readJsonBody } from "@/lib/engine-request";
import { TOO_MANY_REQUESTS_MESSAGE, checkRateLimit, clientKey } from "@/lib/rate-limit";
import { webErrorMessage } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads a page now and compares it with a capture taken earlier.
 *
 * The uploaded capture is passed straight to the engine, which validates it
 * strictly. Nothing here interprets it: an untrusted file should be parsed in
 * exactly one place, by the code that knows what a valid capture looks like.
 */
export async function POST(request: Request) {
  // Fetching a page reaches outside our own service, so the limit protects other
  // people's sites as much as ours.
  const decision = checkRateLimit("web-compare", clientKey(request));
  if (!decision.allowed) {
    return failure(429, "too_many_requests", TOO_MANY_REQUESTS_MESSAGE);
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const url = parsed.body.url;
  if (typeof url !== "string" || url.trim() === "") {
    return failure(400, "bad_request", webErrorMessage("bad_request")!);
  }

  const previous = parsed.body.previous_snapshot ?? parsed.body.previousSnapshot;
  if (previous === undefined || previous === null) {
    return failure(400, "snapshot_unreadable", webErrorMessage("snapshot_unreadable")!);
  }

  return callEngine("/v1/web/compare", { url: url.trim(), previous_snapshot: previous });
}

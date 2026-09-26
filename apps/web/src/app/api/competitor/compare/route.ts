import { callEngine, failure, readJsonBody } from "@/lib/engine-request";
import { TOO_MANY_REQUESTS_MESSAGE, checkRateLimit, clientKey } from "@/lib/rate-limit";
import { webErrorMessage } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads a competitor's page now and compares it with a baseline the person kept.
 *
 * The response is the same deterministic comparison Website Change Detector
 * produces, with one signal on each change. The baseline is passed straight to
 * the engine, which validates it strictly: an untrusted file is parsed in
 * exactly one place, by the code that knows what a valid capture looks like.
 *
 * Only the address and the baseline are forwarded — never the competitor's
 * name or the page type, whatever the browser sends.
 */
export async function POST(request: Request) {
  const decision = checkRateLimit("competitor-compare", clientKey(request));
  if (!decision.allowed) {
    return failure(429, "too_many_requests", TOO_MANY_REQUESTS_MESSAGE);
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  // "Try example": the engine compares its own two saved versions of a
  // fictional page. Nothing is fetched, and nothing else in the request is sent.
  if (parsed.body.example === true) {
    return callEngine("/v1/competitor/compare", { example: true }, "competitor");
  }

  const url = parsed.body.url;
  if (typeof url !== "string" || url.trim() === "") {
    return failure(400, "bad_request", webErrorMessage("bad_request")!);
  }

  const previous = parsed.body.previous_snapshot ?? parsed.body.previousSnapshot;
  if (previous === undefined || previous === null) {
    return failure(400, "snapshot_unreadable", webErrorMessage("snapshot_unreadable")!);
  }

  return callEngine("/v1/competitor/compare", { url: url.trim(), previous_snapshot: previous }, "competitor");
}

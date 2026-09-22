import { callEngine, failure, readJsonBody } from "@/lib/engine-request";
import { TOO_MANY_REQUESTS_MESSAGE, checkRateLimit, clientKey } from "@/lib/rate-limit";
import { webErrorMessage } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Captures a competitor's page as it reads today, for the person to keep.
 *
 * Capturing a competitor's page is the same operation as capturing any page, so
 * this forwards to the engine's existing webpage capture — with its address
 * rules, fetch limits and robots.txt handling — rather than a duplicate.
 *
 * Only the address is forwarded. The competitor's name and the page type are
 * the person's own labels, kept in their baseline file in the browser; they are
 * never sent to the engine and cannot change how the page is read.
 */
export async function POST(request: Request) {
  const decision = checkRateLimit("competitor-capture", clientKey(request));
  if (!decision.allowed) {
    return failure(429, "too_many_requests", TOO_MANY_REQUESTS_MESSAGE);
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const url = parsed.body.url;
  if (typeof url !== "string" || url.trim() === "") {
    return failure(400, "bad_request", webErrorMessage("bad_request")!);
  }

  return callEngine("/v1/web/snapshot", { url: url.trim() });
}

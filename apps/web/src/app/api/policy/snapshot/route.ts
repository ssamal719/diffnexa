import { callEngine, failure, readJsonBody } from "@/lib/engine-request";
import { TOO_MANY_REQUESTS_MESSAGE, checkRateLimit, clientKey } from "@/lib/rate-limit";
import { webErrorMessage } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Captures a policy page as it reads today, for the person to keep.
 *
 * Capturing a policy page is the same operation as capturing any page, so this
 * forwards to the engine's existing webpage capture rather than a duplicate
 * endpoint. What the policy product adds happens at comparison time.
 *
 * The policy type is the person's own label for the page. It is returned with
 * the capture and never sent to the engine, because it has no effect on how the
 * page is read and the engine has no use for it.
 */
export async function POST(request: Request) {
  const decision = checkRateLimit("policy-capture", clientKey(request));
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

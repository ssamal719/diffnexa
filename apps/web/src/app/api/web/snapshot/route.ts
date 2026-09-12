import { callEngine, failure, readJsonBody } from "@/lib/engine-request";
import { webErrorMessage } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Captures what a public web page says right now, for the person to keep. */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const url = parsed.body.url;
  if (typeof url !== "string" || url.trim() === "") {
    return failure(400, "bad_request", webErrorMessage("bad_request")!);
  }

  return callEngine("/v1/web/snapshot", { url: url.trim() });
}

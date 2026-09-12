import { NextResponse } from "next/server";

import { ENGINE_URL, engineAuthHeaders, engineHealthTimeoutMs } from "@/lib/engine-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports whether the comparison engine is reachable.
 *
 * The upload page asks this before enabling "Compare PDFs", so the button is
 * only offered when it will actually work. The engine's address is never
 * included in the reply.
 */
export async function GET() {
  try {
    const response = await fetch(`${ENGINE_URL}/healthz`, {
      headers: engineAuthHeaders(),
      signal: AbortSignal.timeout(engineHealthTimeoutMs()),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ available: false }, { status: 200 });
    }
    const body = await response.json();

    // The health endpoint is public so the hosting platform can poll it, which
    // means a reachable engine is not proof that our credentials are right.
    // Ask it, and treat a rejected secret as unavailable rather than letting
    // the Compare button fail on every attempt.
    if (body.requires_auth === true && body.authenticated !== true) {
      console.warn(
        "Engine reachable but rejected our credentials. " +
          "ENGINE_SHARED_SECRET does not match the value set on the engine.",
      );
      return NextResponse.json({ available: false }, { status: 200 });
    }

    return NextResponse.json(
      {
        available: true,
        engineVersion: body.engine_version ?? null,
        limits: body.limits ?? null,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ available: false }, { status: 200 });
  }
}

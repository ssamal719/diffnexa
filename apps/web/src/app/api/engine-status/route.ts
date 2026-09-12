import { NextResponse } from "next/server";

import { ENGINE_URL, HEALTH_TIMEOUT_MS } from "@/lib/engine-config";

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
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ available: false }, { status: 200 });
    }
    const body = await response.json();
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

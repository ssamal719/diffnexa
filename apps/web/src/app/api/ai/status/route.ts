import { NextResponse } from "next/server";

import { sealingAvailable } from "@/lib/analysis-seal";
import { ENGINE_URL, engineAuthHeaders, engineHealthTimeoutMs } from "@/lib/engine-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether AI Change Analyst can be offered right now.
 *
 * True only when the engine has an AI provider configured, accepts this site's
 * credentials, and this site can seal results. The page never offers "Analyze
 * Changes with AI" unless this says yes. Which provider is used is not
 * revealed here.
 */
export async function GET() {
  if (!sealingAvailable()) return NextResponse.json({ available: false }, { status: 200 });
  try {
    const response = await fetch(`${ENGINE_URL}/healthz`, {
      headers: engineAuthHeaders(),
      signal: AbortSignal.timeout(engineHealthTimeoutMs()),
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ available: false }, { status: 200 });
    const body = await response.json();
    const available = body?.authenticated === true && body?.ai?.available === true;
    return NextResponse.json({ available }, { status: 200 });
  } catch {
    return NextResponse.json({ available: false }, { status: 200 });
  }
}

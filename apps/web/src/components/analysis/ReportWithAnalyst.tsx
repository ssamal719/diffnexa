"use client";

import { useState, type ReactNode } from "react";

import { ChangeAnalyst } from "@/components/analysis/ChangeAnalyst";
import type { AnalysisTool, ChangeAnalysis } from "@/lib/analysis";
import type { FocusRequest } from "@/lib/use-change-focus";

/** The changes a person can see in a result, as the tool counts them (noise aside). */
export function visibleChangeCount(result: unknown): number {
  const body = (result ?? {}) as { counts?: { meaningful?: number }; changes?: unknown[] };
  if (typeof body.counts?.meaningful === "number") return body.counts.meaningful;
  return Array.isArray(body.changes) ? body.changes.length : 0;
}

/**
 * A finished comparison with AI Change Analyst attached.
 *
 * Mounted once per result, so a "View change" request can only ever refer to
 * this result. The tool's own report is drawn by `children`, which receives the
 * panel to place, the change the reader asked to see, and the analysis once it
 * has arrived (so each explanation can sit beside its evidence).
 */
export function ReportWithAnalyst({
  tool,
  result,
  seal,
  children,
}: {
  tool: AnalysisTool;
  result: unknown;
  seal: string | null;
  children: (parts: { analyst: ReactNode; focus: FocusRequest; analysis: ChangeAnalysis | null }) => ReactNode;
}) {
  const [focus, setFocus] = useState<FocusRequest>(null);
  const [analysis, setAnalysis] = useState<ChangeAnalysis | null>(null);
  const analyst = (
    <ChangeAnalyst
      tool={tool}
      result={result}
      seal={seal}
      changeCount={visibleChangeCount(result)}
      onViewChange={(id) => setFocus((current) => ({ id, token: (current?.token ?? 0) + 1 }))}
      onAnalysis={setAnalysis}
    />
  );
  return <>{children({ analyst, focus, analysis })}</>;
}

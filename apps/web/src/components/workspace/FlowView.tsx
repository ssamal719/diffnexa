"use client";

import type { ReactNode } from "react";

import type { WorkspaceContext } from "@/components/workspace/ComparisonWorkspace";
import { DocumentFlowPane } from "@/components/workspace/DocumentFlowPane";
import { EvidenceQuote, MarkedContext } from "@/components/workspace/EvidenceBits";
import { SideBySide, preferredSide } from "@/components/workspace/SideBySide";
import { FIELD_LABELS, type ContentView, type Side } from "@/lib/content-view";

/** Both versions of a Word document or webpage, side by side, each moving to the active change. */
export function FlowView({
  context,
  view,
  headings,
}: {
  context: WorkspaceContext;
  view: ContentView;
  headings: Record<Side, { title: string; detail?: ReactNode }>;
}) {
  const active = context.active;
  return (
    <SideBySide
      activation={context.activation}
      prefer={preferredSide(active?.kind)}
      headings={headings}
      render={(side, reveal) => (
        <DocumentFlowPane
          side={side}
          view={view}
          label={headings[side].title}
          activeId={active?.id ?? null}
          activeKind={active?.kind ?? null}
          activeNumber={active?.number ?? null}
          activation={context.activation}
          reveal={reveal}
        />
      )}
    />
  );
}

export type CitedEvidence = {
  side: "old" | "new";
  nodeId: string | null;
  field: string | null;
  excerpt: string | null;
  /** Where it is, in the tool's own words: a heading path, "Table 1, row 2, column 2". */
  where: string;
};

/**
 * Each piece of evidence for one change: where it is, and — when the result
 * carries the documents' content — the whole passage it sits in with the
 * cited words marked. Without that content, the excerpt the engine quoted.
 */
export function CitedPassages({
  changeId,
  evidence,
  view,
}: {
  changeId: string;
  evidence: CitedEvidence[];
  view: ContentView | null;
}) {
  const seen = new Set<string>();
  const items = evidence.filter((item) => {
    const key = `${item.side}|${item.nodeId ?? item.field ?? item.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const shown = items.slice(0, 6);
  return (
    <>
      {shown.map((item, index) => {
        const side: Side = item.side === "old" ? "original" : "revised";
        const where = item.field ? (FIELD_LABELS[item.field] ?? item.where) : item.where;
        const inView = view && item.nodeId && view[side].nodes.some((node) => node.id === item.nodeId);
        return (
          <EvidenceQuote key={`${side}-${index}`} side={side} where={where}>
            {inView ? (
              <MarkedContext view={view} side={side} nodeId={item.nodeId!} changeId={changeId} />
            ) : item.excerpt ? (
              `“${item.excerpt}”`
            ) : (
              <span className="text-ink-soft">No wording to quote.</span>
            )}
          </EvidenceQuote>
        );
      })}
      {items.length > shown.length && (
        <p className="mt-1 text-[0.75rem] text-ink-soft">
          And {items.length - shown.length} more cited place{items.length - shown.length === 1 ? "" : "s"}, highlighted in
          the side-by-side view.
        </p>
      )}
    </>
  );
}

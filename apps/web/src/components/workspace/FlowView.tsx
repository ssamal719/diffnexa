"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";

import type { WorkspaceContext } from "@/components/workspace/ComparisonWorkspace";
import { DocumentFlowPane } from "@/components/workspace/DocumentFlowPane";
import { EvidenceQuote, MarkedContext } from "@/components/workspace/EvidenceBits";
import { SideBySide, preferredSide } from "@/components/workspace/SideBySide";
import { FIELD_LABELS, type ContentView, type Side } from "@/lib/content-view";
import { anchorPairs, mapScroll } from "@/lib/linked-scroll";

/**
 * Both versions of a Word document or webpage, side by side, each moving to
 * the active change. With linked scrolling on (the workspace's Linked
 * control), scrolling one version keeps the other at the matching paragraph.
 */
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
  const sync = useLinkedScroll(view, context.linked, context.activation);
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
          onContainer={(element) => sync.register(side, element)}
          onScroll={() => sync.scrolled(side)}
        />
      )}
    />
  );
}

const OTHER: Record<Side, Side> = { original: "revised", revised: "original" };

/**
 * Scroll one pane, and the other follows to the matching paragraph.
 *
 * Choosing a change moves both panes by itself, so for a moment after that
 * the panes are left alone rather than chasing each other. A pane that is
 * hidden (one version at a time, on a phone) is never moved.
 */
function useLinkedScroll(view: ContentView, linked: boolean, activation: number) {
  const anchors = useMemo(() => anchorPairs(view), [view]);
  const panes = useRef<Record<Side, HTMLDivElement | null>>({ original: null, revised: null });
  const quietUntil = useRef(0);
  const expected = useRef<Record<Side, number | null>>({ original: null, revised: null });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    quietUntil.current = performance.now() + 400;
  }, [activation]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function tops(container: HTMLDivElement, ids: string[]): (number | null)[] {
    const box = container.getBoundingClientRect();
    return ids.map((id) => {
      const element = container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
      return element ? element.getBoundingClientRect().top - box.top + container.scrollTop : null;
    });
  }

  function follow(from: Side) {
    const source = panes.current[from];
    const target = panes.current[OTHER[from]];
    if (!source || !target || source.clientHeight === 0 || target.clientHeight === 0) return;
    const fromTops = tops(source, anchors.map((anchor) => anchor[from]));
    const toTops = tops(target, anchors.map((anchor) => anchor[OTHER[from]]));
    const a: number[] = [];
    const b: number[] = [];
    fromTops.forEach((top, index) => {
      const other = toTops[index];
      if (top !== null && other !== null) {
        a.push(top);
        b.push(other);
      }
    });
    const limit = target.scrollHeight - target.clientHeight;
    const next = Math.round(Math.max(0, Math.min(limit, mapScroll(source.scrollTop, a, b))));
    if (Math.abs(next - target.scrollTop) < 1) return;
    expected.current[OTHER[from]] = next;
    target.scrollTop = next;
  }

  return {
    register(side: Side, element: HTMLDivElement | null) {
      panes.current[side] = element;
    },
    scrolled(side: Side) {
      const pane = panes.current[side];
      const wanted = expected.current[side];
      if (pane && wanted !== null && Math.abs(pane.scrollTop - wanted) < 2) {
        expected.current[side] = null; // this pane moved because the other one did
        return;
      }
      if (!linked || performance.now() < quietUntil.current) return;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        follow(side);
      });
    },
  };
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

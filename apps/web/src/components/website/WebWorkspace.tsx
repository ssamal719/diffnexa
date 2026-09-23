"use client";

import { useMemo, type ReactNode } from "react";

import { Alert } from "@/components/ui/Alert";
import { WebChangeCard } from "@/components/website/WebChangeCard";
import { ChangeList } from "@/components/workspace/ChangeList";
import { ComparisonWorkspace, type WorkspaceContext } from "@/components/workspace/ComparisonWorkspace";
import { DetectedValues } from "@/components/workspace/EvidenceBits";
import { CitedPassages, FlowView } from "@/components/workspace/FlowView";
import type { ChangeAnalysis } from "@/lib/analysis";
import { readView } from "@/lib/content-view";
import type { FocusRequest } from "@/lib/use-change-focus";
import { webPlace, type WebChange, type WebComparison } from "@/lib/web-report";
import type { FilterGroup, WorkspaceChange } from "@/lib/workspace";

/**
 * The Comparison Workspace for a webpage — shared by Website Change Detector,
 * Policy Monitor, Competitor Monitor and Price Monitor, which all compare a
 * page with a saved baseline and differ only in how they describe the changes.
 *
 * Side by side shows the baseline and the page now as DiffNexa read them, with
 * each change's words marked; there are no page numbers, because a webpage has
 * none — places are the page's own headings. List shows every change as a card.
 */
export function WebWorkspace({
  tool,
  result,
  headline,
  summary,
  emptyNote,
  facts,
  changes,
  filters,
  overview,
  overviewTitle,
  footer,
  cardFooter,
  sectionOf,
  baselineDetail,
  analyst,
  analysis = null,
  focus = null,
}: {
  tool: string;
  result: WebComparison;
  headline: string;
  summary: { label: string; count: number }[];
  emptyNote: ReactNode;
  facts: { label: string; value: ReactNode }[];
  changes: WorkspaceChange[];
  filters: FilterGroup[];
  overview?: (context: WorkspaceContext) => ReactNode;
  overviewTitle?: string;
  footer: ReactNode;
  /** Tool-specific detail for a change — its policy topics, competitor signal or price category. */
  cardFooter?: (change: WebChange) => ReactNode;
  sectionOf?: (change: WorkspaceChange) => { key: string; title: string; blurb?: string };
  baselineDetail?: ReactNode;
  analyst?: ReactNode;
  analysis?: ChangeAnalysis | null;
  focus?: FocusRequest;
}) {
  const view = useMemo(() => readView(result.view), [result]);
  const byId = useMemo(() => new Map(result.changes.map((change) => [change.id, change])), [result]);
  const modes = view
    ? [
        { id: "page", label: "Side by side" },
        { id: "list", label: "List" },
      ]
    : [{ id: "list", label: "List" }];
  const notes = result.diagnostics.notes;

  return (
    <ComparisonWorkspace
      tool={tool}
      headline={headline}
      summary={summary}
      emptyNote={emptyNote}
      facts={facts}
      changes={changes}
      modes={modes}
      initialMode={modes[0].id}
      filters={filters}
      overview={overview}
      overviewTitle={overviewTitle}
      minorLabel="unimportant difference"
      notes={
        notes.length > 0 ? (
          <div className="space-y-1 border-b border-rule px-3 py-2">
            {notes.map((note) => (
              <Alert key={note} tone="planned" title="Worth knowing">
                {note}
              </Alert>
            ))}
          </div>
        ) : null
      }
      footer={footer}
      renderMain={(context) =>
        context.mode === "page" && view ? (
          <FlowView
            context={context}
            view={view}
            headings={{
              original: { title: "Baseline capture", detail: baselineDetail },
              revised: { title: "The page now" },
            }}
          />
        ) : (
          <ChangeList
            context={context}
            sectionOf={sectionOf}
            renderCard={(item, props) => {
              const change = byId.get(item.id)!;
              return (
                <WebChangeCard
                  change={change}
                  index={props.index}
                  total={props.total}
                  isCurrent={props.isCurrent}
                  onFocus={props.onFocus}
                  footer={cardFooter?.(change)}
                />
              );
            }}
          />
        )
      }
      renderEvidence={(context) => {
        const change = context.active ? byId.get(context.active.id) : undefined;
        if (!change) return null;
        return (
          <div className="space-y-1">
            <DetectedValues
              before={change.oldValue}
              after={change.newValue}
              difference={change.delta}
              quoted={{
                original: change.evidence.filter((item) => item.side === "old" && item.nodeId).map((item) => item.excerpt),
                revised: change.evidence.filter((item) => item.side === "new" && item.nodeId).map((item) => item.excerpt),
              }}
            />
            <CitedPassages
              changeId={change.id}
              view={view}
              evidence={change.evidence.map((item) => ({
                side: item.side,
                nodeId: item.nodeId,
                field: item.field,
                excerpt: item.excerpt,
                where: item.sectionPath.length > 0 ? item.sectionPath.join(" › ") : webPlace(change, view),
              }))}
            />
            {cardFooter?.(change)}
            {change.noiseReason && (
              <p className="text-[0.8rem] text-ink-soft">Set aside as unimportant because: {change.noiseReason}</p>
            )}
          </div>
        );
      }}
      analyst={analyst}
      analysis={analysis}
      focus={focus}
    />
  );
}

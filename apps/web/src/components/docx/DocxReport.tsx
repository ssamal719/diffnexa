"use client";

import { useMemo, type ReactNode } from "react";

import { DocxChangeCard } from "@/components/docx/DocxChangeCard";
import { Alert } from "@/components/ui/Alert";
import { ChangeList } from "@/components/workspace/ChangeList";
import { ComparisonWorkspace, type WorkspaceContext } from "@/components/workspace/ComparisonWorkspace";
import { DetectedValues } from "@/components/workspace/EvidenceBits";
import { CitedPassages, FlowView } from "@/components/workspace/FlowView";
import type { ChangeAnalysis } from "@/lib/analysis";
import { readView } from "@/lib/content-view";
import {
  NO_CHANGES_SENTENCE,
  docxFilters,
  docxPlace,
  docxWorkspaceChanges,
  headline,
  readingNotes,
  type DocxComparison,
} from "@/lib/docx-report";
import type { FocusRequest } from "@/lib/use-change-focus";
import { formatFileSize } from "@/lib/validation";

type FileSummary = { name: string; sizeBytes: number };

/**
 * DOCX Compare in the Comparison Workspace.
 *
 * Side by side shows both documents' text as the comparison read it —
 * headings, paragraphs, lists and tables in reading order — with every change
 * marked in place. Places are the document's own headings; the paragraph or
 * table position Word would use is a labelled secondary detail. There are no
 * page numbers, because a Word file does not have fixed pages.
 */
export function DocxReport({
  result,
  original,
  revised,
  analyst,
  analysis = null,
  focus = null,
}: {
  result: DocxComparison;
  original: FileSummary;
  revised: FileSummary;
  /** AI Change Analyst, shown under the workspace. */
  analyst?: ReactNode;
  analysis?: ChangeAnalysis | null;
  /** A change to show, asked for from outside the report ("View change"). */
  focus?: FocusRequest;
}) {
  const view = useMemo(() => readView(result.view), [result]);
  const changes = useMemo(() => docxWorkspaceChanges(result), [result]);
  const filters = useMemo(() => docxFilters(result, changes), [result, changes]);
  const byId = useMemo(() => new Map(result.changes.map((change) => [change.id, change])), [result]);
  const notes = readingNotes(result);
  const modes = view
    ? [
        { id: "document", label: "Side by side" },
        { id: "list", label: "List" },
      ]
    : [{ id: "list", label: "List" }];

  return (
    <ComparisonWorkspace
      tool="DOCX Compare"
      headline={headline(result.changes.length)}
      summary={result.groups.filter((item) => item.changeCount > 0).map((item) => ({ label: item.label, count: item.changeCount }))}
      emptyNote={NO_CHANGES_SENTENCE}
      facts={[
        { label: "Original document", value: `${original.name} · ${formatFileSize(original.sizeBytes)}` },
        { label: "Revised document", value: `${revised.name} · ${formatFileSize(revised.sizeBytes)}` },
      ]}
      changes={changes}
      modes={modes}
      initialMode={modes[0].id}
      filters={filters}
      overviewTitle="Kinds of change"
      overview={(context) => <GroupSummary result={result} context={context} />}
      notes={
        notes.length > 0 ? (
          <div className="space-y-1 border-b border-rule px-3 py-2">
            {notes.map((note) => (
              <Alert key={`${note.title}-${note.text}`} tone="note" title={note.title}>
                {note.text}
              </Alert>
            ))}
          </div>
        ) : null
      }
      footer="Every change was found by comparing the text and structure of the two documents, and points to where it is in each. Visual formatting, images, headers, footers, footnotes and comments are not compared. No AI was used in the comparison."
      renderMain={(context) =>
        context.mode === "document" && view ? (
          <FlowView
            context={context}
            view={view}
            headings={{
              original: { title: "Original document", detail: original.name },
              revised: { title: "Revised document", detail: revised.name },
            }}
          />
        ) : (
          <ChangeList
            context={context}
            renderCard={(item, props) => (
              <DocxChangeCard
                change={byId.get(item.id)!}
                index={props.index}
                total={props.total}
                isCurrent={props.isCurrent}
                onFocus={props.onFocus}
              />
            )}
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
                where:
                  item.scope === "document"
                    ? "Document properties"
                    : `${item.sectionPath.length > 0 ? item.sectionPath.join(" › ") : docxPlace(change, view)} · ${item.location}`,
              }))}
            />
          </div>
        );
      }}
      analyst={analyst}
      analysis={analysis}
      focus={focus}
    />
  );
}

/** How many changes of each kind, each a toggle that narrows the navigator and list to that kind. */
function GroupSummary({ result, context }: { result: DocxComparison; context: WorkspaceContext }) {
  const groups = result.groups.filter((item) => item.changeCount > 0);
  const selected = context.filters.group?.[0] ?? null;
  return (
    <section aria-labelledby="docx-groups-heading">
      <h3 id="docx-groups-heading" className="text-[0.9rem] font-medium">
        Where the changes are
      </h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={selected === item.id}
              onClick={() => context.setFilter("group", selected === item.id ? [] : [item.id])}
              className={[
                "w-full rounded-[var(--radius-panel)] border p-3 text-left",
                selected === item.id ? "border-signal bg-signal-soft" : "border-rule bg-paper hover:border-rule-strong",
              ].join(" ")}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{item.label}</span>
                <span className="tabular text-[0.85rem] text-ink-soft">
                  <span className="sr-only">: </span>
                  {item.changeCount}
                  <span className="sr-only"> change{item.changeCount === 1 ? "" : "s"}.</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.78rem] text-ink-soft">
        Each change is in one group, by the kind of content that changed. Select a group to show only its changes.
      </p>
    </section>
  );
}

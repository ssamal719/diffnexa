"use client";

import { useMemo, useState, type ReactNode } from "react";

import { ChangeCard } from "@/components/results/ChangeCard";
import { PageMap } from "@/components/results/PageMap";
import { Alert } from "@/components/ui/Alert";
import { ChangeList } from "@/components/workspace/ChangeList";
import { ComparisonWorkspace, type WorkspaceContext } from "@/components/workspace/ComparisonWorkspace";
import { DetectedValues, EvidenceQuote } from "@/components/workspace/EvidenceBits";
import { PdfPagePane, type PaneFollow, type PdfBox, type ScrollFollow, type Zoom } from "@/components/workspace/PdfPagePane";
import type { WorkspaceControls } from "@/components/workspace/WorkspaceControls";
import { SideBySide, preferredSide } from "@/components/workspace/SideBySide";
import type { ChangeAnalysis } from "@/lib/analysis";
import type { Change, ComparisonResponse } from "@/lib/comparison";
import { summarize } from "@/lib/comparison";
import {
  CATEGORIES,
  buildReport,
  categoryOf,
  describePageDelta,
  pageBuckets,
  toWorkspaceChanges,
  workspaceFilters,
} from "@/lib/report";
import { counterpartPage } from "@/lib/pdf-links";
import type { FocusRequest } from "@/lib/use-change-focus";

type Files = { original: File | null; revised: File | null };

type Side = "original" | "revised";

/**
 * PDF Compare in the Comparison Workspace.
 *
 * Pages shows both PDFs side by side, drawn from the person's own files in
 * their browser, with every change outlined where the engine found it; choosing
 * a change turns both to the page its evidence is on. List shows every change
 * as a card. The evidence panel quotes both versions and gives the page each
 * quotation came from — a page number is only ever one the engine recorded.
 */
export function ComparisonReport({
  result,
  files = null,
  names,
  analyst,
  analysis = null,
  focus = null,
  controls,
}: {
  result: ComparisonResponse;
  /** The two PDFs the person chose, still in their browser, for drawing pages. */
  files?: Files | null;
  names?: { original: string; revised: string };
  /** AI Change Analyst, shown under the workspace. */
  analyst?: ReactNode;
  analysis?: ChangeAnalysis | null;
  /** A change to show, asked for from outside the report ("View change"). */
  focus?: FocusRequest;
  /** Ignore options, Export and Reverse, passed in by the page that can compare again. */
  controls?: WorkspaceControls;
}) {
  const report = useMemo(() => buildReport(result), [result]);
  const changes = useMemo(() => toWorkspaceChanges(result), [result]);
  const filters = useMemo(() => workspaceFilters(changes), [changes]);
  const byId = useMemo(() => new Map(result.changes.map((change) => [change.id, change])), [result]);
  const numbers = useMemo(() => new Map(changes.map((change) => [change.id, change.number])), [changes]);
  const modes = files ? [{ id: "pages", label: "Pages" }, { id: "list", label: "List" }] : [{ id: "list", label: "List" }];
  const { previous, revised } = result.documents;

  return (
    <ComparisonWorkspace
      tool="PDF Compare"
      headline={summarize(report.totalMeaningful)}
      summary={report.categories.filter((item) => item.count > 0).map((item) => ({ label: item.label, count: item.count }))}
      emptyNote="These two documents contain the same text, figures and dates. DiffNexa found nothing to report."
      facts={[
        { label: "Original", value: `${names?.original ?? "Previous version"} · ${pages(previous.pageCount)}` },
        { label: "Revised", value: `${names?.revised ?? "New version"} · ${pages(revised.pageCount)}` },
        { label: "Length", value: describePageDelta(report) },
      ]}
      changes={changes}
      modes={modes}
      initialMode={modes[0].id}
      linkable={["pages"]}
      linkedUnit="page"
      controls={controls}
      filters={filters}
      overviewTitle="Page map"
      overview={(context) => (
        <PageMap
          pages={pageBuckets(report.changes, revised.pageCount)}
          selected={(context.filters.page ?? []).map(Number)}
          onToggle={(page) => context.toggleFilter("page", String(page))}
        />
      )}
      notes={
        report.notes.length > 0 ? (
          <div className="space-y-1 border-b border-rule px-3 py-2">
            {report.notes.map((note) => (
              <Alert key={note} tone="planned" title="Worth knowing">
                {note}
              </Alert>
            ))}
          </div>
        ) : null
      }
      minorLabel="minor difference"
      footer="Every change was found by comparing the two documents directly, and each one points back to the page it came from. No AI was used in the comparison."
      renderMain={(context) =>
        context.mode === "pages" && files ? (
          <PagesView context={context} result={result} files={files} byId={byId} numbers={numbers} />
        ) : (
          <ChangeList
            context={context}
            renderCard={(item, props) => {
              const change = byId.get(item.id)!;
              return (
                <ChangeCard
                  change={change}
                  index={props.index}
                  total={props.total}
                  isCurrent={props.isCurrent}
                  onFocus={props.onFocus}
                />
              );
            }}
          />
        )
      }
      renderEvidence={(context) => {
        const change = context.active ? byId.get(context.active.id) : undefined;
        return change ? <PdfEvidence change={change} /> : null;
      }}
      analyst={analyst}
      analysis={analysis}
      focus={focus}
    />
  );
}

function pages(count: number): string {
  return `${count} page${count === 1 ? "" : "s"}`;
}

function PagesView({
  context,
  result,
  files,
  byId,
  numbers,
}: {
  context: WorkspaceContext;
  result: ComparisonResponse;
  files: Files;
  byId: Map<string, Change>;
  numbers: Map<string, number>;
}) {
  const change = context.active ? (byId.get(context.active.id) ?? null) : null;
  const boxes = useMemo(() => {
    const out: Record<"original" | "revised", PdfBox[]> = { original: [], revised: [] };
    for (const item of context.visible) {
      const source = byId.get(item.id);
      if (!source) continue;
      for (const evidence of source.evidence) {
        if (!evidence.bbox || evidence.page === null) continue;
        out[evidence.side === "old" ? "original" : "revised"].push({
          changeId: source.id,
          number: numbers.get(source.id) ?? 0,
          page: evidence.page,
          bbox: evidence.bbox,
        });
      }
    }
    return out;
  }, [context.visible, byId, numbers]);

  // Linked: turning a page, zooming or scrolling one version moves the other to match.
  const [follow, setFollow] = useState<Record<Side, PaneFollow | null>>({ original: null, revised: null });
  const [scrollFollow, setScrollFollow] = useState<Record<Side, ScrollFollow | null>>({ original: null, revised: null });
  const [token, setToken] = useState(0);
  const counts: Record<Side, number> = {
    original: result.documents.previous.pageCount,
    revised: result.documents.revised.pageCount,
  };

  function navigated(side: Side, page: number, zoom: Zoom) {
    if (!context.linked) return;
    const other: Side = side === "original" ? "revised" : "original";
    const next = token + 1;
    setToken(next);
    setFollow((current) => ({
      ...current,
      [other]: { page: counterpartPage(result.pageLinks, side, page, counts[other]), zoom, token: next },
    }));
  }

  function scrolled(side: Side, top: number, left: number) {
    if (!context.linked) return;
    const other: Side = side === "original" ? "revised" : "original";
    const next = token + 1;
    setToken(next);
    setScrollFollow((current) => ({ ...current, [other]: { top, left, token: next } }));
  }

  return (
    <SideBySide
      activation={context.activation}
      prefer={preferredSide(context.active?.kind)}
      headings={{
        original: { title: "Original document" },
        revised: { title: "Revised document" },
      }}
      render={(side, reveal) => (
        <PdfPagePane
          side={side}
          file={files[side]}
          pageCount={counts[side]}
          boxes={boxes[side]}
          activeId={change?.id ?? null}
          activePage={change ? pageOn(change, side) : null}
          activeKind={context.active?.kind ?? null}
          activation={context.activation}
          reveal={reveal}
          follow={follow[side]}
          onNavigate={(page, zoom) => navigated(side, page, zoom)}
          scrollFollow={scrollFollow[side]}
          onScrolled={(top, left) => scrolled(side, top, left)}
        />
      )}
    />
  );
}

/** The page a change's evidence is on in one version, as the engine recorded it. */
function pageOn(change: Change, side: "original" | "revised"): number | null {
  const wanted = side === "original" ? "old" : "new";
  const withBox = change.evidence.find((item) => item.side === wanted && item.page !== null && item.bbox);
  if (withBox) return withBox.page;
  const pagesOnSide = side === "original" ? change.oldPages : change.newPages;
  return pagesOnSide[0] ?? null;
}

function PdfEvidence({ change }: { change: Change }) {
  const category = categoryOf(change);
  const quotes = (side: "old" | "new") => {
    const seen = new Set<string>();
    return change.evidence.filter((item) => {
      if (item.side !== side || !item.excerpt) return false;
      const key = `${item.page}|${item.excerpt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const original = quotes("old");
  const revised = quotes("new");
  return (
    <div className="space-y-1">
      <p className="text-[0.75rem] font-medium text-ink-soft">
        What was detected · {CATEGORIES.find((item) => item.id === category)?.label}
      </p>
      <DetectedValues
        before={change.oldValue}
        after={change.newValue}
        difference={change.delta}
        quoted={{ original: original.map((item) => item.excerpt), revised: revised.map((item) => item.excerpt) }}
      />
      {original.slice(0, 3).map((item, index) => (
        <EvidenceQuote key={`o${index}`} side="original" where={item.page !== null ? `page ${item.page}` : "page not recorded"}>
          “{item.excerpt}”
        </EvidenceQuote>
      ))}
      {revised.slice(0, 3).map((item, index) => (
        <EvidenceQuote key={`r${index}`} side="revised" where={item.page !== null ? `page ${item.page}` : "page not recorded"}>
          “{item.excerpt}”
        </EvidenceQuote>
      ))}
      {original.length + revised.length > 6 && (
        <p className="text-[0.75rem] text-ink-soft">
          And {original.length + revised.length - 6} more quotation{original.length + revised.length - 6 === 1 ? "" : "s"}{" "}
          on the same pages.
        </p>
      )}
      {change.noiseReason && <p className="text-[0.8rem] text-ink-soft">Set aside as minor because: {change.noiseReason}</p>}
    </div>
  );
}

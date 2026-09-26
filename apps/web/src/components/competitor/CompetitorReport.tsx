"use client";

import { useMemo, type ReactNode } from "react";

import { SignalSummary } from "@/components/competitor/SignalSummary";
import { WebWorkspace } from "@/components/website/WebWorkspace";
import type { ChangeAnalysis } from "@/lib/analysis";
import { readView } from "@/lib/content-view";
import {
  NO_CHANGES_SENTENCE,
  changedSignals,
  groupBySignal,
  headline,
  pageTypeLabel,
  signalOf,
  type CompetitorChange,
  type CompetitorComparison,
} from "@/lib/competitor-report";
import type { FocusRequest } from "@/lib/use-change-focus";
import {
  buildWebReport,
  formatCapturedAt,
  webFilters,
  webWorkspaceChanges,
  type WebChange,
  type WebComparison,
} from "@/lib/web-report";
import { filterGroup } from "@/lib/workspace";

/**
 * Competitor Monitor in the Comparison Workspace.
 *
 * The changes are exactly those the engine returned, grouped by the one signal
 * each carries — in the navigator and in the list — with the reason for the
 * group on every change. Every change is in exactly one group; nothing is
 * hidden, ranked or scored, and no wording says whether a change is good, bad
 * or significant.
 */
export function CompetitorReport({
  result,
  url,
  competitor,
  pageType,
  baselineCapturedAt,
  analyst,
  analysis = null,
  focus = null,
}: {
  result: CompetitorComparison;
  url: string;
  competitor: string;
  pageType: string;
  baselineCapturedAt: string | null;
  /** AI Change Analyst, shown under the workspace. */
  analyst?: ReactNode;
  analysis?: ChangeAnalysis | null;
  /** A change to show, asked for from outside the report ("View change"). */
  focus?: FocusRequest;
}) {
  const report = useMemo(() => buildWebReport(result as unknown as WebComparison), [result]);
  const { changes, groups } = useMemo(() => {
    const meaningful = result.changes.filter((change) => !change.isNoise).sort((a, b) => a.seq - b.seq);
    const minor = result.changes.filter((change) => change.isNoise).sort((a, b) => a.seq - b.seq);
    const grouped = groupBySignal(result, meaningful);
    const ordered = [...grouped.flatMap((group) => group.changes), ...minor];
    return {
      groups: new Map(grouped.map((group) => [group.id as string, group])),
      changes: webWorkspaceChanges(ordered as WebChange[], {
        view: readView(result.view),
        groupOf: (change) => {
          const signal = signalOf(change as CompetitorChange);
          return { key: `signal:${signal?.signal ?? "other"}`, label: signal?.label ?? "Other" };
        },
        tags: (change) => ({ signal: [signalOf(change as CompetitorChange)?.signal ?? "other"] }),
        searchWords: (change) => {
          const signal = signalOf(change as CompetitorChange);
          return [signal?.label, signal?.summary];
        },
      }),
    };
  }, [result]);
  const filters = useMemo(
    () => [
      ...webFilters(changes),
      filterGroup(
        "signal",
        "Where on the page",
        changes,
        result.competitor.signals.map(({ id, label }) => ({ id, label })),
        { inBar: false },
      ),
    ],
    [changes, result],
  );

  return (
    <WebWorkspace
      tool="Competitor Monitor"
      result={result as unknown as WebComparison}
      headline={headline(report.total)}
      summary={changedSignals(result).map((signal) => ({ label: signal.label, count: signal.changeCount }))}
      emptyNote={NO_CHANGES_SENTENCE}
      facts={[
        { label: "Competitor", value: competitor },
        { label: "Page", value: <span className="break-all">{url}</span> },
        { label: "Page type", value: pageTypeLabel(pageType) },
        ...(baselineCapturedAt ? [{ label: "Baseline", value: formatCapturedAt(baselineCapturedAt) }] : []),
      ]}
      baselineDetail={baselineCapturedAt ? formatCapturedAt(baselineCapturedAt) : undefined}
      changes={changes}
      filters={filters}
      overviewTitle="Where the changes are"
      overview={(context) => (
        <SignalSummary
          result={result}
          selected={context.filters.signal?.[0] ?? null}
          onSelect={(signal) => context.setFilter("signal", signal ? [signal] : [])}
        />
      )}
      sectionOf={(change) => {
        const id = change.tags?.signal?.[0] ?? "other";
        const group = groups.get(id);
        return change.minor
          ? { key: "minor", title: "Set aside as unimportant" }
          : { key: id, title: group?.label ?? "Other", blurb: group?.blurb };
      }}
      cardFooter={(change) => <SignalTag change={change as CompetitorChange} />}
      footer="Every change was found by comparing this page with your baseline, and points back to the wording it came from. Groups describe where on the page a change sits, not what it means. No AI was used in the comparison."
      analyst={analyst}
      analysis={analysis}
      focus={focus}
      exportPage={{ url, baseline: baselineCapturedAt ? formatCapturedAt(baselineCapturedAt) : null }}
      exportLabel={(change) => (change as CompetitorChange).competitorSignal?.label ?? null}
    />
  );
}

/** The group a change is in, and why — so a reader can check it and disagree. */
function SignalTag({ change }: { change: CompetitorChange }) {
  const signal = signalOf(change);
  if (!signal) return null;
  return (
    <p className="mt-3 text-[0.8rem]">
      <span className="rounded-full border border-rule bg-surface px-2.5 py-0.5 font-medium">{signal.summary}</span>
      <span className="text-ink-soft"> — {signal.reason}</span>
    </p>
  );
}

"use client";

import { useMemo, type ReactNode } from "react";

import { TopicSummary } from "@/components/policy/TopicSummary";
import { SectionMap } from "@/components/website/SectionMap";
import { WebWorkspace } from "@/components/website/WebWorkspace";
import type { ChangeAnalysis } from "@/lib/analysis";
import { readView } from "@/lib/content-view";
import {
  changedTopics,
  describeSignalSource,
  policyTypeLabel,
  topicsOf,
  type PolicyChange,
  type PolicyComparison,
} from "@/lib/policy-report";
import type { FocusRequest } from "@/lib/use-change-focus";
import {
  buildWebReport,
  formatCapturedAt,
  inWorkspaceOrder,
  webFilters,
  webWorkspaceChanges,
  type WebChange,
  type WebComparison,
} from "@/lib/web-report";
import { filterGroup } from "@/lib/workspace";

/**
 * Policy and Terms Monitor in the Comparison Workspace.
 *
 * The changes are exactly those the engine returned. What the policy product
 * adds is which part of the agreement each change sits in — its topics, each
 * with the phrase that placed it there — and the summary of which parts moved,
 * which did not, and which were not found. Nothing is ranked or scored, and
 * nothing says whether a change is good or bad for the reader.
 */
export function PolicyReport({
  result,
  url,
  policyType,
  baselineCapturedAt,
  analyst,
  analysis = null,
  focus = null,
}: {
  result: PolicyComparison;
  url: string;
  policyType: string | null;
  baselineCapturedAt: string | null;
  /** AI Change Analyst, shown under the workspace. */
  analyst?: ReactNode;
  analysis?: ChangeAnalysis | null;
  /** A change to show, asked for from outside the report ("View change"). */
  focus?: FocusRequest;
}) {
  const report = useMemo(() => buildWebReport(result as unknown as WebComparison), [result]);
  const changes = useMemo(
    () =>
      webWorkspaceChanges(inWorkspaceOrder(result.changes) as WebChange[], {
        view: readView(result.view),
        categoryLabel: (change) => topicsOf(change as PolicyChange)[0]?.label ?? "No named part",
        tags: (change) => ({ topic: topicsOf(change as PolicyChange).map((signal) => signal.topic) }),
        searchWords: (change) => topicsOf(change as PolicyChange).flatMap((signal) => [signal.label, signal.summary]),
      }),
    [result],
  );
  const filters = useMemo(
    () => [
      ...webFilters(changes),
      filterGroup(
        "topic",
        "Part of the document",
        changes,
        result.policy.topics.map(({ id, label }) => ({ id, label })),
        { inBar: false },
      ),
    ],
    [changes, result],
  );
  const total = report.total;
  const touched = changedTopics(result).length;

  return (
    <WebWorkspace
      tool="Policy and Terms Monitor"
      result={result as unknown as WebComparison}
      headline={total === 0 ? "No changes found" : `${total} change${total === 1 ? "" : "s"} detected`}
      summary={touched > 0 ? [{ label: `part${touched === 1 ? "" : "s"} of the document touched`, count: touched }] : []}
      emptyNote="This page says the same as it did when you captured your baseline."
      facts={[
        { label: "Document", value: policyTypeLabel(policyType) },
        { label: "Address", value: <span className="break-all">{url}</span> },
        ...(baselineCapturedAt ? [{ label: "Baseline", value: formatCapturedAt(baselineCapturedAt) }] : []),
      ]}
      baselineDetail={baselineCapturedAt ? formatCapturedAt(baselineCapturedAt) : undefined}
      changes={changes}
      filters={filters}
      overviewTitle="Parts of the document"
      overview={(context) => (
        <div className="space-y-5">
          <TopicSummary
            result={result}
            selected={context.filters.topic?.[0] ?? null}
            onSelect={(topic) => context.setFilter("topic", topic ? [topic] : [])}
          />
          <SectionMap
            sections={report.sections}
            selected={context.filters.section ?? []}
            onToggle={(path) => context.toggleFilter("section", path)}
          />
        </div>
      )}
      cardFooter={(change) => <TopicTags change={change as PolicyChange} />}
      footer="Every change was found by comparing this page with your baseline, and points back to the wording it came from. DiffNexa reports what changed, not what it means — it does not give legal advice. No AI was used in the comparison."
      analyst={analyst}
      analysis={analysis}
      focus={focus}
      exportPage={{ url, baseline: baselineCapturedAt ? formatCapturedAt(baselineCapturedAt) : null }}
      exportLabel={(change) => topicsOf(change as PolicyChange).map((topic) => topic.label).join(", ") || null}
    />
  );
}

/**
 * The parts of the agreement a change touches.
 *
 * Each tag carries the phrase that produced it, so a reader can see why it was
 * suggested and disagree with it. A change with no tags simply has none.
 */
function TopicTags({ change }: { change: PolicyChange }) {
  const signals = topicsOf(change);
  if (signals.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {signals.map((signal) => (
        <li key={signal.topic} className="rounded-full border border-rule bg-surface px-2.5 py-0.5 text-[0.8rem]">
          <span className="font-medium">{signal.summary}</span>
          <span className="text-ink-soft"> — {describeSignalSource(signal)}</span>
        </li>
      ))}
    </ul>
  );
}

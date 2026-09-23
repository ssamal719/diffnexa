"use client";

import { useMemo, type ReactNode } from "react";

import { CategorySummary } from "@/components/price/CategorySummary";
import { WebWorkspace } from "@/components/website/WebWorkspace";
import type { ChangeAnalysis } from "@/lib/analysis";
import { readView } from "@/lib/content-view";
import {
  NO_CHANGES_SENTENCE,
  categoryOf,
  changedCategories,
  groupByCategory,
  headline,
  pageTypeLabel,
  type PriceChange,
  type PriceComparison,
} from "@/lib/price-report";
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
 * Price Monitor in the Comparison Workspace.
 *
 * The changes are exactly those the engine returned, grouped by the one price
 * category each carries — "Other Changes" holds everything that is not about
 * pricing, in full — with the reason for the category on every change.
 * Nothing is hidden, ranked or scored, and no wording says whether a price is
 * good, bad, high or low.
 */
export function PriceReport({
  result,
  url,
  product,
  pageType,
  baselineCapturedAt,
  analyst,
  analysis = null,
  focus = null,
}: {
  result: PriceComparison;
  url: string;
  product: string;
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
    const grouped = groupByCategory(result, meaningful);
    const ordered = [...grouped.flatMap((group) => group.changes), ...minor];
    return {
      groups: new Map(grouped.map((group) => [group.id as string, group])),
      changes: webWorkspaceChanges(ordered as WebChange[], {
        view: readView(result.view),
        groupOf: (change) => {
          const found = categoryOf(change as PriceChange);
          return { key: `price:${found?.category ?? "other"}`, label: found?.label ?? "Other Changes" };
        },
        tags: (change) => ({ price: [categoryOf(change as PriceChange)?.category ?? "other"] }),
        searchWords: (change) => [categoryOf(change as PriceChange)?.label],
      }),
    };
  }, [result]);
  const filters = useMemo(
    () => [
      ...webFilters(changes),
      filterGroup(
        "price",
        "Kind of price change",
        changes,
        result.price.categories.map(({ id, label }) => ({ id, label })),
        { inBar: false },
      ),
    ],
    [changes, result],
  );

  return (
    <WebWorkspace
      tool="Price Monitor"
      result={result as unknown as WebComparison}
      headline={headline(report.total)}
      summary={changedCategories(result).map((category) => ({ label: category.label, count: category.changeCount }))}
      emptyNote={NO_CHANGES_SENTENCE}
      facts={[
        { label: "Product / service", value: product },
        { label: "Page", value: <span className="break-all">{url}</span> },
        { label: "Page type", value: pageTypeLabel(pageType) },
        ...(baselineCapturedAt ? [{ label: "Baseline", value: formatCapturedAt(baselineCapturedAt) }] : []),
      ]}
      baselineDetail={baselineCapturedAt ? formatCapturedAt(baselineCapturedAt) : undefined}
      changes={changes}
      filters={filters}
      overviewTitle="Kinds of change"
      overview={(context) => (
        <CategorySummary
          result={result}
          selected={context.filters.price?.[0] ?? null}
          onSelect={(category) => context.setFilter("price", category ? [category] : [])}
        />
      )}
      sectionOf={(change) => {
        const id = change.tags?.price?.[0] ?? "other";
        const group = groups.get(id);
        return change.minor
          ? { key: "minor", title: "Set aside as unimportant" }
          : { key: id, title: group?.label ?? "Other Changes", blurb: group?.blurb };
      }}
      cardFooter={(change) => <CategoryTag change={change as PriceChange} />}
      footer="Every change was found by comparing this page with your baseline, and points back to the wording it came from. Groups describe what kind of change it is, not whether it is good or bad. No AI was used in the comparison."
      analyst={analyst}
      analysis={analysis}
      focus={focus}
    />
  );
}

/** The group a change is in, and why — so a reader can check it and disagree. */
function CategoryTag({ change }: { change: PriceChange }) {
  const found = categoryOf(change);
  if (!found) return null;
  return (
    <p className="mt-3 text-[0.8rem]">
      <span className="rounded-full border border-rule bg-surface px-2.5 py-0.5 font-medium">{found.label}</span>
      <span className="text-ink-soft"> — {found.reason}</span>
    </p>
  );
}

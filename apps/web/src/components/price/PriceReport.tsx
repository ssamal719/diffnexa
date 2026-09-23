"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { CategorySummary } from "@/components/price/CategorySummary";
import { Alert } from "@/components/ui/Alert";
import { WebChangeCard } from "@/components/website/WebChangeCard";
import {
  NO_CHANGES_SENTENCE,
  categoryOf,
  groupByCategory,
  headline,
  pageTypeLabel,
  type PriceChange,
  type PriceComparison,
} from "@/lib/price-report";
import {
  NO_WEB_FILTERS,
  applyWebFilters,
  buildWebReport,
  formatCapturedAt,
  type WebComparison,
} from "@/lib/web-report";

import { useChangeFocus, type FocusRequest } from "@/lib/use-change-focus";
/**
 * The result of checking a pricing or product page.
 *
 * The changes are exactly those the engine returned, shown with the same cards
 * Website Change Detector uses and grouped by the one price category each
 * carries. Every change appears in exactly one group — "Other Changes" holds
 * everything that is not about pricing, in full. Nothing is hidden, ranked or
 * scored, and no wording says whether a price is good, bad, high or low.
 */
export function PriceReport({
  result,
  url,
  product,
  pageType,
  baselineCapturedAt,
  analyst,
  focus = null,
}: {
  result: PriceComparison;
  url: string;
  product: string;
  pageType: string;
  baselineCapturedAt: string | null;
  /** AI Change Analyst, shown between the summary and the list of changes. */
  analyst?: ReactNode;
  /** A change to show, asked for from outside the report ("View change"). */
  focus?: FocusRequest;
}) {
  const report = useMemo(() => buildWebReport(result as unknown as WebComparison), [result]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  const groups = useMemo(() => {
    const byText = applyWebFilters(report, { ...NO_WEB_FILTERS, query }) as PriceChange[];
    // A search for "availability" should find the availability changes, even
    // where the word itself is not in the changed text.
    const needle = query.trim().toLowerCase();
    const byCategory = needle
      ? (report.changes as PriceChange[]).filter((change) =>
          (categoryOf(change)?.label ?? "").toLowerCase().includes(needle),
        )
      : [];
    const found = new Set([...byText, ...byCategory].map((change) => change.id));
    const matching = (report.changes as PriceChange[]).filter(
      (change) =>
        found.has(change.id) &&
        (category === null || (categoryOf(change)?.category ?? "other") === category),
    );
    return groupByCategory(result, matching);
  }, [report, query, category, result]);

  const flat = groups.flatMap((group) => group.changes);
  const indexOf = new Map(flat.map((change, index) => [change.id, index]));
  const total = report.total;
  const filtering = query.trim() !== "" || category !== null;

  function chooseCategory(next: string | null) {
    setCategory(next);
    setCurrent(0);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: "start" }));
  }

  useChangeFocus(
    focus,
    (id) => flat.findIndex((change) => change.id === id),
    () => {
      setQuery("");
      setCategory(null);
      setCurrent(0);
    },
    cardRefs,
  );

  function goTo(index: number) {
    if (index < 0 || index >= flat.length) return;
    setCurrent(index);
    cardRefs.current[index]?.focus();
    cardRefs.current[index]?.scrollIntoView({ block: "center" });
  }

  return (
    <section aria-labelledby="price-report-heading" className="mt-6 space-y-4">
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <header className="border-b border-rule p-4 md:p-5">
          <p className="text-[0.82rem] font-medium text-added">Check complete</p>
          <h2
            id="price-report-heading"
            className="mt-1 text-[1.5rem] leading-tight font-semibold md:text-[1.75rem]"
          >
            {headline(total)}
          </h2>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[0.88rem] sm:grid-cols-[9.5rem_1fr]">
            <dt className="text-ink-soft">Product / service</dt>
            <dd className="break-words">{product}</dd>
            <dt className="text-ink-soft">Page</dt>
            <dd className="break-all">{url}</dd>
            <dt className="text-ink-soft">Page type</dt>
            <dd>{pageTypeLabel(pageType)}</dd>
            {baselineCapturedAt && (
              <>
                <dt className="text-ink-soft">Baseline</dt>
                <dd>{formatCapturedAt(baselineCapturedAt)}</dd>
              </>
            )}
          </dl>
        </header>

        <div className="space-y-5 p-4 md:p-5">
          {total === 0 ? (
            <p>
              {NO_CHANGES_SENTENCE}
              {report.minor.length > 0 &&
                ` ${report.minor.length} difference${report.minor.length === 1 ? "" : "s"} such as timestamps were ignored.`}
            </p>
          ) : (
            <CategorySummary result={result} selected={category} onSelect={chooseCategory} />
          )}
        </div>
      </div>

      {report.notes.map((note) => (
        <Alert key={note} tone="planned" title="Worth knowing">
          {note}
        </Alert>
      ))}

      {analyst}

      {total > 0 && (
        <div ref={listRef} className="rounded-[var(--radius-panel)] border border-rule bg-paper">
          <div className="flex flex-wrap items-center gap-3 border-b border-rule p-3 md:p-4">
            <h2 className="mr-auto text-[1.05rem] font-semibold">What changed</h2>
            <label className="min-w-[12rem] flex-1">
              <span className="sr-only">Search the changes</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCurrent(0);
                }}
                placeholder="Search prices, wording or sections"
                className="w-full rounded-[3px] border border-rule bg-paper px-3 py-1.5 text-[0.9rem]"
              />
            </label>
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory(null);
                  setCurrent(0);
                }}
                className="rounded-[3px] border border-rule-strong px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"
              >
                Clear filters
              </button>
            )}
          </div>

          {flat.length > 1 && (
            <div className="flex items-center justify-between gap-3 border-b border-rule bg-surface px-3 py-2 md:px-4">
              <p className="tabular text-[0.85rem] text-ink-soft" role="status" aria-live="polite">
                Change {Math.min(current + 1, flat.length)} of {flat.length}
                {filtering && ` · filtered from ${total}`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Previous change"
                  disabled={current === 0}
                  onClick={() => goTo(current - 1)}
                  className="rounded-[3px] border border-rule-strong bg-paper px-3 py-1 hover:bg-surface disabled:text-rule-strong"
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="Next change"
                  disabled={current >= flat.length - 1}
                  onClick={() => goTo(current + 1)}
                  className="rounded-[3px] border border-rule-strong bg-paper px-3 py-1 hover:bg-surface disabled:text-rule-strong"
                >
                  →
                </button>
              </div>
            </div>
          )}

          {flat.length === 0 ? (
            <p className="p-4 text-ink-soft md:p-5">
              Nothing matches these filters. Clear them to see all {total} changes.
            </p>
          ) : (
            <div className="space-y-6 p-3 md:p-4">
              {groups.map((group) => (
                <section key={group.id} aria-labelledby={`group-${group.id}`}>
                  <h3 id={`group-${group.id}`} className="text-[1rem] font-semibold">
                    {group.label}{" "}
                    <span className="tabular text-[0.85rem] font-normal text-ink-soft">
                      · {group.changes.length} change{group.changes.length === 1 ? "" : "s"}
                    </span>
                  </h3>
                  <p className="mt-0.5 text-[0.82rem] text-ink-soft">{group.blurb}</p>
                  <div className="mt-2 space-y-3">
                    {group.changes.map((change) => {
                      const index = indexOf.get(change.id) ?? 0;
                      return (
                        <WebChangeCard
                          key={change.id}
                          ref={(element) => {
                            cardRefs.current[index] = element;
                          }}
                          change={change}
                          index={index}
                          total={flat.length}
                          isCurrent={index === current}
                          onFocus={() => setCurrent(index)}
                          footer={<CategoryTag change={change} />}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          <footer className="border-t border-rule p-3 text-[0.78rem] text-ink-soft md:p-4">
            Every change above was found by comparing this page with your baseline, and points
            back to the wording it came from. Groups describe what kind of change it is, not
            whether it is good or bad. No AI was used.
          </footer>
        </div>
      )}
    </section>
  );
}

/**
 * The group a change is in, and why — so a reader can check it and disagree.
 */
function CategoryTag({ change }: { change: PriceChange }) {
  const found = categoryOf(change);
  if (!found) return null;
  return (
    <p className="mt-3 text-[0.8rem]">
      <span className="rounded-full border border-rule bg-surface px-2.5 py-0.5 font-medium">
        {found.label}
      </span>
      <span className="text-ink-soft"> — {found.reason}</span>
    </p>
  );
}

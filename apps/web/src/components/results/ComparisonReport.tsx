"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { CategoryTiles } from "@/components/results/CategoryTiles";
import { ChangeCard } from "@/components/results/ChangeCard";
import { ChangeMix } from "@/components/results/ChangeMix";
import { PageGroupCard } from "@/components/results/PageGroupCard";
import { PageMap } from "@/components/results/PageMap";
import { Alert } from "@/components/ui/Alert";
import type { ComparisonResponse } from "@/lib/comparison";
import {
  NO_FILTERS,
  applyFilters,
  buildReport,
  describePageDelta,
  describeScope,
  formatDuration,
  groupIntoItems,
  hasActiveFilters,
  toggle,
  type CategoryId,
  type EditKind,
  type Filters,
} from "@/lib/report";
import { useChangeFocus, type FocusRequest } from "@/lib/use-change-focus";

/**
 * The comparison result, as a report a person can explore.
 *
 * The summary is the navigation: every number in it is a control that narrows
 * the list beneath. The list is a pure function of the filter state, so what a
 * person sees always matches what they clicked.
 */
export function ComparisonReport({
  result,
  analyst,
  focus = null,
}: {
  result: ComparisonResponse;
  /** AI Change Analyst, shown between the summary and the list of changes. */
  analyst?: ReactNode;
  /** A change to show, asked for from outside the report ("View change"). */
  focus?: FocusRequest;
}) {
  const report = useMemo(() => buildReport(result), [result]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Filtering runs on the underlying changes, then the survivors are grouped.
  // That order matters: a search hit inside a whole new page keeps its group,
  // rather than the group disappearing because its page record did not match.
  const visible = useMemo(() => applyFilters(report, filters), [report, filters]);
  const items = useMemo(() => groupIntoItems(visible), [visible]);
  const searching = filters.query.trim() !== "";
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  /** Any filter change restarts change-by-change navigation from the top. */
  function setFiltersAndReset(next: Filters) {
    setFilters(next);
    setCurrentIndex(0);
  }

  function update(next: Partial<Filters>) {
    setFiltersAndReset({ ...filters, ...next });
    // Move focus to the results so a click in the summary has a visible effect
    // on small screens, where the list is below the fold.
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: "start" }));
  }

  function goTo(index: number) {
    if (index < 0 || index >= items.length) return;
    setCurrentIndex(index);
    cardRefs.current[index]?.focus();
    cardRefs.current[index]?.scrollIntoView({ block: "center" });
  }

  useChangeFocus(
    focus,
    (id) =>
      items.findIndex((item) =>
        item.type === "change" ? item.change.id === id : item.members.some((member) => member.id === id),
      ),
    () => setFiltersAndReset(NO_FILTERS),
    cardRefs,
  );

  const empty = report.totalMeaningful === 0;

  return (
    <section aria-labelledby="report-heading" className="mt-6 space-y-4">
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <header className="border-b border-rule p-4 md:p-5">
          <p className="text-[0.82rem] font-medium tracking-wide text-added">Comparison complete</p>
          <h2 id="report-heading" className="mt-1 text-[1.5rem] leading-tight font-semibold md:text-[1.75rem]">
            {describeScope(report)}
          </h2>
          <p className="tabular mt-1 text-[0.9rem] text-ink-soft">
            {describePageDelta(report)} · compared in {formatDuration(result.processingMs)}
          </p>
        </header>

        {empty ? (
          <div className="p-4 md:p-5">
            <p className="text-ink">
              These two documents contain the same text, figures and dates. DiffNexa found nothing
              to report.
            </p>
            {report.minor.length > 0 && (
              <p className="mt-2 text-[0.9rem] text-ink-soft">
                {report.minor.length} difference{report.minor.length === 1 ? "" : "s"} in page
                numbering or repeated headers {report.minor.length === 1 ? "was" : "were"} ignored.
                You can review {report.minor.length === 1 ? "it" : "them"} below.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5 p-4 md:p-5">
            <ChangeMix
              mix={report.mix}
              total={report.totalMeaningful}
              selected={filters.kinds}
              onToggle={(kind: EditKind) => update({ kinds: toggle(filters.kinds, kind) })}
            />
            <CategoryTiles
              categories={report.categories}
              selected={filters.categories}
              onToggle={(id: CategoryId) => update({ categories: toggle(filters.categories, id) })}
            />
            <PageMap
              pages={report.pages}
              selected={filters.pages}
              onToggle={(page: number) => update({ pages: toggle(filters.pages, page) })}
            />
          </div>
        )}
      </div>

      {report.notes.map((note) => (
        <Alert key={note} tone="planned" title="Worth knowing">
          {note}
        </Alert>
      ))}

      {analyst}

      <div ref={listRef} className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <div className="flex flex-wrap items-center gap-3 border-b border-rule p-3 md:p-4">
          <label className="flex-1 min-w-[12rem]">
            <span className="sr-only">Search the changes</span>
            <input
              type="search"
              value={filters.query}
              onChange={(event) => setFiltersAndReset({ ...filters, query: event.target.value })}
              placeholder="Search values, wording or evidence"
              className="w-full rounded-[3px] border border-rule bg-paper px-3 py-1.5 text-[0.9rem] placeholder:text-ink-soft"
            />
          </label>

          {report.minor.length > 0 && (
            <label className="flex items-center gap-2 text-[0.85rem]">
              <input
                type="checkbox"
                checked={filters.includeMinor}
                onChange={(event) => update({ includeMinor: event.target.checked })}
                className="h-4 w-4"
              />
              <span>
                Include {report.minor.length} minor difference{report.minor.length === 1 ? "" : "s"}
              </span>
            </label>
          )}

          {hasActiveFilters(filters) && (
            <button
              type="button"
              onClick={() =>
                setFiltersAndReset({ ...NO_FILTERS, includeMinor: filters.includeMinor })
              }
              className="rounded-[3px] border border-rule-strong px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"
            >
              Clear filters
            </button>
          )}
        </div>

        {items.length > 1 && (
          <div className="flex items-center justify-between gap-3 border-b border-rule bg-surface px-3 py-2 md:px-4">
            <p className="tabular text-[0.85rem] text-ink-soft" role="status" aria-live="polite">
              Result {Math.min(currentIndex + 1, items.length)} of {items.length}
              {items.length !== visible.length && ` · ${visible.length} changes`}
              {hasActiveFilters(filters) && ` · filtered from ${report.totalMeaningful}`}
            </p>
            <div className="flex gap-2">
              <NavButton
                label="Previous result"
                disabled={currentIndex === 0}
                onClick={() => goTo(currentIndex - 1)}
              >
                ←
              </NavButton>
              <NavButton
                label="Next result"
                disabled={currentIndex >= items.length - 1}
                onClick={() => goTo(currentIndex + 1)}
              >
                →
              </NavButton>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <p className="p-4 text-ink-soft md:p-5">
            Nothing matches these filters. Clear them to see all {report.totalMeaningful} changes.
          </p>
        ) : (
          <div className="space-y-3 p-3 md:p-4">
            {items.map((item, index) =>
              item.type === "page-group" ? (
                <PageGroupCard
                  key={item.key}
                  ref={(element) => {
                    cardRefs.current[index] = element;
                  }}
                  group={item}
                  index={index}
                  total={items.length}
                  isCurrent={index === currentIndex}
                  onFocus={() => setCurrentIndex(index)}
                  forceOpen={searching}
                />
              ) : (
                <ChangeCard
                  key={item.key}
                  ref={(element) => {
                    cardRefs.current[index] = element;
                  }}
                  change={item.change}
                  index={index}
                  total={items.length}
                  isCurrent={index === currentIndex}
                  onFocus={() => setCurrentIndex(index)}
                />
              ),
            )}
          </div>
        )}

        <footer className="border-t border-rule p-3 text-[0.78rem] text-ink-soft md:p-4">
          Every change above was found by comparing the two documents directly, and each one points
          back to the page it came from. No AI was used.
        </footer>
      </div>
    </section>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-[3px] border border-rule-strong bg-paper px-3 py-1 text-[0.9rem] hover:bg-surface disabled:cursor-not-allowed disabled:text-rule-strong"
    >
      {children}
    </button>
  );
}

"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { SectionMap } from "@/components/website/SectionMap";
import { WebChangeCard } from "@/components/website/WebChangeCard";
import { Alert } from "@/components/ui/Alert";
import {
  EDIT_LABEL,
  EDIT_MARK,
  NO_WEB_FILTERS,
  applyWebFilters,
  buildWebReport,
  hasWebFilters,
  summariseWeb,
  toggleValue,
  type EditKind,
  type WebCategoryId,
  type WebComparison,
  type WebFilters,
} from "@/lib/web-report";
import { useChangeFocus, type FocusRequest } from "@/lib/use-change-focus";

/**
 * The comparison result, as a report about a webpage.
 *
 * Same shape as PDF Compare because it works — summary, where, what, evidence —
 * but everything below "where" is website-native: sections and headings rather
 * than pages, and links, tables and page details rather than images and layout.
 */
export function WebReport({
  result,
  url,
  analyst,
  focus = null,
}: {
  result: WebComparison;
  url: string;
  /** AI Change Analyst, shown between the summary and the list of changes. */
  analyst?: ReactNode;
  /** A change to show, asked for from outside the report ("View change"). */
  focus?: FocusRequest;
}) {
  const report = useMemo(() => buildWebReport(result), [result]);
  const [filters, setFilters] = useState<WebFilters>(NO_WEB_FILTERS);
  const [current, setCurrent] = useState(0);

  const visible = useMemo(() => applyWebFilters(report, filters), [report, filters]);
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  function update(next: Partial<WebFilters>) {
    setFilters({ ...filters, ...next });
    setCurrent(0);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: "start" }));
  }

  useChangeFocus(
    focus,
    (id) => visible.findIndex((change) => change.id === id),
    () => {
      setFilters({ ...NO_WEB_FILTERS, includeMinor: true });
      setCurrent(0);
    },
    cardRefs,
  );

  function goTo(index: number) {
    if (index < 0 || index >= visible.length) return;
    setCurrent(index);
    cardRefs.current[index]?.focus();
    cardRefs.current[index]?.scrollIntoView({ block: "center" });
  }

  const empty = report.total === 0;

  return (
    <section aria-labelledby="web-report-heading" className="mt-6 space-y-4">
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <header className="border-b border-rule p-4 md:p-5">
          <p className="text-[0.82rem] font-medium text-added">Check complete</p>
          <h2 id="web-report-heading" className="mt-1 text-[1.5rem] leading-tight font-semibold md:text-[1.75rem]">
            {summariseWeb(report)}
          </h2>
          <p className="mt-1 break-all text-[0.9rem] text-ink-soft">{url}</p>
        </header>

        {empty ? (
          <div className="p-4 md:p-5">
            <p>This page says the same as it did when you captured your baseline.</p>
            {report.minor.length > 0 && (
              <p className="mt-2 text-[0.9rem] text-ink-soft">
                {report.minor.length} difference{report.minor.length === 1 ? "" : "s"} such as
                timestamps or counters {report.minor.length === 1 ? "was" : "were"} ignored. You can
                review {report.minor.length === 1 ? "it" : "them"} below.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5 p-4 md:p-5">
            <ul className="flex flex-wrap gap-2">
              {report.mix.map((entry) => {
                const active = filters.kinds.includes(entry.kind);
                return (
                  <li key={entry.kind}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => update({ kinds: toggleValue(filters.kinds, entry.kind as EditKind) })}
                      className={[
                        "flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-[0.85rem]",
                        active ? "border-signal bg-signal-soft text-ink" : "border-rule bg-paper text-ink-soft",
                      ].join(" ")}
                    >
                      <span aria-hidden="true">{EDIT_MARK[entry.kind]}</span>
                      <span className="tabular font-medium text-ink">{entry.count}</span>
                      <span>{EDIT_LABEL[entry.kind].toLowerCase()}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {report.categories.map((category) => {
                const active = filters.categories.includes(category.id);
                const none = category.count === 0;
                return (
                  <li key={category.id}>
                    <button
                      type="button"
                      disabled={none}
                      aria-pressed={active}
                      onClick={() => update({ categories: toggleValue(filters.categories, category.id as WebCategoryId) })}
                      className={[
                        "h-full w-full rounded-[var(--radius-panel)] border p-3 text-left",
                        none
                          ? "cursor-default border-rule bg-surface text-ink-soft"
                          : active
                            ? "border-signal bg-signal-soft"
                            : "border-rule bg-paper hover:border-rule-strong",
                      ].join(" ")}
                    >
                      <span className="tabular block text-[1.5rem] leading-none font-semibold">
                        {category.count}
                      </span>
                      <span className="mt-1 block text-[0.9rem] font-medium">{category.label}</span>
                      <span className="mt-0.5 block text-[0.78rem] leading-snug text-ink-soft">
                        {none ? "No changes" : category.blurb}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <SectionMap
              sections={report.sections}
              selected={filters.sections}
              onToggle={(path) => update({ sections: toggleValue(filters.sections, path) })}
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
          <label className="min-w-[12rem] flex-1">
            <span className="sr-only">Search the changes</span>
            <input
              type="search"
              value={filters.query}
              onChange={(event) => {
                setFilters({ ...filters, query: event.target.value });
                setCurrent(0);
              }}
              placeholder="Search wording, numbers or sections"
              className="w-full rounded-[3px] border border-rule bg-paper px-3 py-1.5 text-[0.9rem]"
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
                Include {report.minor.length} unimportant difference
                {report.minor.length === 1 ? "" : "s"}
              </span>
            </label>
          )}

          {hasWebFilters(filters) && (
            <button
              type="button"
              onClick={() => {
                setFilters({ ...NO_WEB_FILTERS, includeMinor: filters.includeMinor });
                setCurrent(0);
              }}
              className="rounded-[3px] border border-rule-strong px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"
            >
              Clear filters
            </button>
          )}
        </div>

        {visible.length > 1 && (
          <div className="flex items-center justify-between gap-3 border-b border-rule bg-surface px-3 py-2 md:px-4">
            <p className="tabular text-[0.85rem] text-ink-soft" role="status" aria-live="polite">
              Change {Math.min(current + 1, visible.length)} of {visible.length}
              {hasWebFilters(filters) && ` · filtered from ${report.total}`}
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
                disabled={current >= visible.length - 1}
                onClick={() => goTo(current + 1)}
                className="rounded-[3px] border border-rule-strong bg-paper px-3 py-1 hover:bg-surface disabled:text-rule-strong"
              >
                →
              </button>
            </div>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="p-4 text-ink-soft md:p-5">
            Nothing matches these filters. Clear them to see all {report.total} changes.
          </p>
        ) : (
          <div className="space-y-3 p-3 md:p-4">
            {visible.map((change, index) => (
              <WebChangeCard
                key={change.id}
                ref={(element) => {
                  cardRefs.current[index] = element;
                }}
                change={change}
                index={index}
                total={visible.length}
                isCurrent={index === current}
                onFocus={() => setCurrent(index)}
              />
            ))}
          </div>
        )}

        <footer className="border-t border-rule p-3 text-[0.78rem] text-ink-soft md:p-4">
          Every change above was found by reading the page directly and comparing it with your
          baseline. No AI was used.
        </footer>
      </div>
    </section>
  );
}

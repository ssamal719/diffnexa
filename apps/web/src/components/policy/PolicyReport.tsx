"use client";

import { useMemo, useRef, useState } from "react";

import { SectionMap } from "@/components/website/SectionMap";
import { WebChangeCard } from "@/components/website/WebChangeCard";
import { Alert } from "@/components/ui/Alert";
import { TopicSummary } from "@/components/policy/TopicSummary";
import {
  changesForTopic,
  describeSignalSource,
  policyTypeLabel,
  topicsOf,
  type PolicyChange,
  type PolicyComparison,
} from "@/lib/policy-report";
import {
  NO_WEB_FILTERS,
  applyWebFilters,
  buildWebReport,
  formatCapturedAt,
  hasWebFilters,
  toggleValue,
  type WebComparison,
  type WebFilters,
} from "@/lib/web-report";

/**
 * The result of checking a policy page.
 *
 * The changes are exactly those the engine returned, shown with the same cards
 * Website Change Detector uses. What the policy product adds is the panel above
 * them — which parts of the agreement moved — and a line on each card naming the
 * part it belongs to.
 *
 * A change with no topic is shown like any other. Nothing is hidden, ranked or
 * scored, and no wording here says whether a change is good or bad for the
 * reader.
 */
export function PolicyReport({
  result,
  url,
  policyType,
  baselineCapturedAt,
}: {
  result: PolicyComparison;
  url: string;
  policyType: string | null;
  baselineCapturedAt: string | null;
}) {
  const report = useMemo(() => buildWebReport(result as unknown as WebComparison), [result]);
  const [filters, setFilters] = useState<WebFilters>(NO_WEB_FILTERS);
  const [topic, setTopic] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  const visible = useMemo(() => {
    const byFilters = applyWebFilters(report, filters) as PolicyChange[];
    if (!topic) return byFilters;
    const allowed = new Set(changesForTopic(result, topic).map((change) => change.id));
    return byFilters.filter((change) => allowed.has(change.id));
  }, [report, filters, topic, result]);

  function chooseTopic(next: string | null) {
    setTopic(next);
    setCurrent(0);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: "start" }));
  }

  function goTo(index: number) {
    if (index < 0 || index >= visible.length) return;
    setCurrent(index);
    cardRefs.current[index]?.focus();
    cardRefs.current[index]?.scrollIntoView({ block: "center" });
  }

  const total = report.total;
  const filtering = hasWebFilters(filters) || topic !== null;

  return (
    <section aria-labelledby="policy-report-heading" className="mt-6 space-y-4">
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <header className="border-b border-rule p-4 md:p-5">
          <p className="text-[0.82rem] font-medium text-added">Check complete</p>
          <h2
            id="policy-report-heading"
            className="mt-1 text-[1.5rem] leading-tight font-semibold md:text-[1.75rem]"
          >
            {total === 0
              ? "No changes found"
              : `${total} change${total === 1 ? "" : "s"} detected`}
          </h2>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[0.88rem] sm:grid-cols-[7rem_1fr]">
            <dt className="text-ink-soft">Document</dt>
            <dd>{policyTypeLabel(policyType)}</dd>
            <dt className="text-ink-soft">Address</dt>
            <dd className="break-all">{url}</dd>
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
              This page says the same as it did when you captured your baseline.
              {report.minor.length > 0 &&
                ` ${report.minor.length} difference${report.minor.length === 1 ? "" : "s"} such as timestamps were ignored.`}
            </p>
          ) : (
            <>
              <TopicSummary result={result} selected={topic} onSelect={chooseTopic} />
              <SectionMap
                sections={report.sections}
                selected={filters.sections}
                onToggle={(path) => {
                  setFilters({ ...filters, sections: toggleValue(filters.sections, path) });
                  setCurrent(0);
                }}
              />
            </>
          )}
        </div>
      </div>

      {report.notes.map((note) => (
        <Alert key={note} tone="planned" title="Worth knowing">
          {note}
        </Alert>
      ))}

      {total > 0 && (
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

            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setFilters(NO_WEB_FILTERS);
                  setTopic(null);
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
              Nothing matches these filters. Clear them to see all {total} changes.
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
                  footer={<TopicTags change={change} />}
                />
              ))}
            </div>
          )}

          <footer className="border-t border-rule p-3 text-[0.78rem] text-ink-soft md:p-4">
            Every change above was found by comparing this page with your baseline, and points
            back to the wording it came from. DiffNexa reports what changed, not what it means —
            it does not give legal advice. No AI was used.
          </footer>
        </div>
      )}
    </section>
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
        <li
          key={signal.topic}
          className="rounded-full border border-rule bg-surface px-2.5 py-0.5 text-[0.8rem]"
        >
          <span className="font-medium">{signal.summary}</span>
          <span className="text-ink-soft"> — {describeSignalSource(signal)}</span>
        </li>
      ))}
    </ul>
  );
}

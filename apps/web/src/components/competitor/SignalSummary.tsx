"use client";

import { changedSignals, type CompetitorComparison } from "@/lib/competitor-report";

/**
 * The kinds of content that changed, with how many changes each.
 *
 * Each is a toggle that narrows the list below to that kind. Only kinds with at
 * least one change are shown: this is a summary of what was found, and listing
 * the empty ones would read like a verdict about the rest of the page.
 */
export function SignalSummary({
  result,
  selected,
  onSelect,
}: {
  result: CompetitorComparison;
  selected: string | null;
  onSelect: (signalId: string | null) => void;
}) {
  const signals = changedSignals(result);
  if (signals.length === 0) return null;

  return (
    <section aria-labelledby="signals-heading">
      <h3 id="signals-heading" className="text-[0.9rem] font-medium">
        Where the changes are
      </h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {signals.map((signal) => (
          <li key={signal.id}>
            <button
              type="button"
              aria-pressed={selected === signal.id}
              onClick={() => onSelect(selected === signal.id ? null : signal.id)}
              className={[
                "w-full rounded-[var(--radius-panel)] border p-3 text-left",
                selected === signal.id
                  ? "border-signal bg-signal-soft"
                  : "border-rule bg-paper hover:border-rule-strong",
              ].join(" ")}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{signal.label}</span>
                <span className="tabular text-[0.85rem] text-ink-soft">
                  <span className="sr-only">: </span>
                  {signal.changeCount}
                  <span className="sr-only">
                    {" "}
                    change{signal.changeCount === 1 ? "" : "s"}.{" "}
                  </span>
                </span>
              </span>
              <span className="mt-0.5 block text-[0.8rem] text-ink-soft">{signal.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.78rem] text-ink-soft">
        Each change is placed in one group, using the page&apos;s own headings, tables and links.
        Select a group to show only its changes.
      </p>
    </section>
  );
}

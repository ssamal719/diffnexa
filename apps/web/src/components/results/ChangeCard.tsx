"use client";

import { forwardRef, useState } from "react";

import type { Change } from "@/lib/comparison";
import {
  EDIT_KIND_MARK,
  categoryOf,
  describeLocation,
  editKindOf,
  headlineFor,
} from "@/lib/report";

const TONE = {
  added: "text-added",
  removed: "text-removed",
  changed: "text-signal",
  moved: "text-ink-soft",
} as const;

/**
 * One detected change.
 *
 * The headline is plain language ("Value changed"), not the engine's internal
 * name. The old and new values sit side by side because that comparison is the
 * whole point. Evidence is one click away rather than always open, so a list of
 * twenty changes stays scannable.
 *
 * Nothing here is computed: values, differences, pages and quotations all come
 * from the comparison result.
 */
export const ChangeCard = forwardRef<
  HTMLElement,
  { change: Change; index: number; total: number; isCurrent: boolean; onFocus: () => void }
>(function ChangeCard({ change, index, total, isCurrent, onFocus }, ref) {
  const [showEvidence, setShowEvidence] = useState(false);
  const kind = editKindOf(change);
  const category = categoryOf(change);
  const oldEvidence = change.evidence.find((item) => item.side === "old" && item.excerpt);
  const newEvidence = change.evidence.find((item) => item.side === "new" && item.excerpt);

  return (
    <article
      ref={ref}
      tabIndex={-1}
      onFocus={onFocus}
      aria-label={`Change ${index + 1} of ${total}: ${headlineFor(change)}, ${describeLocation(change)}`}
      className={[
        "scroll-mt-24 rounded-[var(--radius-panel)] border bg-paper p-4 transition-colors",
        isCurrent ? "border-signal ring-1 ring-signal/20" : "border-rule",
      ].join(" ")}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          <span aria-hidden="true" className={`${TONE[kind]} mr-1.5`}>
            {EDIT_KIND_MARK[kind]}
          </span>
          {headlineFor(change)}
        </h3>
        {change.label && <p className="text-ink-soft">{change.label}</p>}
        <p className="tabular ml-auto text-[0.82rem] text-ink-soft">{describeLocation(change)}</p>
      </header>

      {category === "values" || category === "dates" ? (
        <ValueComparison change={change} />
      ) : (
        <TextComparison change={change} />
      )}

      {(oldEvidence || newEvidence) && (
        <div className="mt-3 border-t border-rule pt-2">
          <button
            type="button"
            onClick={() => setShowEvidence((open) => !open)}
            aria-expanded={showEvidence}
            className="text-[0.85rem] font-medium text-signal hover:underline"
          >
            {showEvidence ? "Hide evidence" : "View evidence"}
          </button>

          {showEvidence && (
            <div className="mt-2 space-y-2 text-[0.85rem]">
              <p className="text-ink-soft">
                Taken directly from the documents. This is the surrounding text DiffNexa read.
              </p>
              {oldEvidence && (
                <Quote label="Previous document" page={oldEvidence.page} text={oldEvidence.excerpt!} />
              )}
              {newEvidence && (
                <Quote label="New document" page={newEvidence.page} text={newEvidence.excerpt!} />
              )}
              {change.noiseReason && (
                <p className="text-ink-soft">Marked minor because: {change.noiseReason}</p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
});

function Quote({ label, page, text }: { label: string; page: number | null; text: string }) {
  return (
    <figure className="border-l-2 border-rule pl-3">
      <figcaption className="text-[0.78rem] font-medium text-ink-soft">
        {label}
        {page !== null && <span className="tabular"> · page {page}</span>}
      </figcaption>
      <blockquote className="mt-0.5 text-ink">“{text}”</blockquote>
    </figure>
  );
}

/** Figures and dates: the two values, and the difference the engine calculated. */
function ValueComparison({ change }: { change: Change }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="tabular rounded-[3px] bg-[#fdf0f0] px-2 py-1 line-through decoration-removed/60">
        {change.oldValue}
      </span>
      <span aria-hidden="true" className="text-ink-soft">
        →
      </span>
      <span className="tabular rounded-[3px] bg-[#f1f7f3] px-2 py-1 font-medium">
        {change.newValue}
      </span>
      {change.delta && (
        <span className="tabular rounded-full border border-rule px-2 py-0.5 text-[0.82rem] font-medium">
          {change.delta}
        </span>
      )}
    </div>
  );
}

/** Wording: before and after, stacked on small screens, side by side on wide ones. */
function TextComparison({ change }: { change: Change }) {
  const both = change.oldValue && change.newValue;
  return (
    <div className={`mt-3 grid gap-3 ${both ? "md:grid-cols-2" : ""}`}>
      {change.oldValue && (
        <Side label="Previous" tone="removed" text={change.oldValue} />
      )}
      {change.newValue && <Side label="New" tone="added" text={change.newValue} />}
    </div>
  );
}

function Side({ label, tone, text }: { label: string; tone: "added" | "removed"; text: string }) {
  const styles =
    tone === "added"
      ? "border-added/30 bg-[#f1f7f3]"
      : "border-removed/30 bg-[#fdf0f0]";
  return (
    <div className={`rounded-[3px] border ${styles} p-2`}>
      <p className="text-[0.78rem] font-medium text-ink-soft">{label}</p>
      <p className="mt-0.5 break-words">{text}</p>
    </div>
  );
}

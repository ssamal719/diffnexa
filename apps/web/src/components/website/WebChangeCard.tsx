"use client";

import { forwardRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import {
  EDIT_MARK,
  categoryOf,
  editKindOf,
  headlineFor,
  locationOf,
  type WebChange,
} from "@/lib/web-report";

const TONE = {
  added: "text-added",
  removed: "text-removed",
  changed: "text-signal",
  moved: "text-ink-soft",
} as const;

/**
 * One change, described the way a reader would describe it.
 *
 * The headline is plain language; the engine's internal names never appear.
 * Numbers, dates and table values show before and after side by side because
 * that comparison is the point. Evidence is one click away rather than always
 * open, so a long list stays readable.
 */
export const WebChangeCard = forwardRef<
  HTMLElement,
  { change: WebChange; index: number; total: number; isCurrent: boolean; onFocus: () => void }
>(function WebChangeCard({ change, index, total, isCurrent, onFocus }, ref) {
  const [showEvidence, setShowEvidence] = useState(false);
  const kind = editKindOf(change);
  const category = categoryOf(change);
  const where = locationOf(change);
  const before = change.evidence.find((item) => item.side === "old" && item.excerpt);
  const after = change.evidence.find((item) => item.side === "new" && item.excerpt);
  const inline = category === "values" || category === "dates" || category === "tables";

  return (
    <article
      ref={ref}
      tabIndex={-1}
      onFocus={onFocus}
      aria-label={`Change ${index + 1} of ${total}: ${headlineFor(change)}${where ? `, in ${where}` : ""}`}
      className={[
        "scroll-mt-24 rounded-[var(--radius-panel)] border bg-paper p-4 transition-colors",
        isCurrent ? "border-signal ring-1 ring-signal/20" : "border-rule",
      ].join(" ")}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          <span aria-hidden="true" className={`${TONE[kind]} mr-1.5`}>
            {EDIT_MARK[kind]}
          </span>
          {headlineFor(change)}
        </h3>
        {change.label && category !== "details" && (
          <p className="text-ink-soft">{change.label}</p>
        )}
        {where && <p className="ml-auto text-[0.82rem] text-ink-soft">{where}</p>}
        {change.isNoise && <Badge tone="neutral">Probably not important</Badge>}
      </header>

      {inline ? (
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
      ) : (
        <div className={`mt-3 grid gap-3 ${change.oldValue && change.newValue ? "md:grid-cols-2" : ""}`}>
          {change.oldValue && <Side label="Before" tone="removed" text={change.oldValue} />}
          {change.newValue && <Side label="After" tone="added" text={change.newValue} />}
        </div>
      )}

      {(before || after) && (
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
                Taken directly from the page. This is the surrounding text DiffNexa read.
              </p>
              {before && <Quote label="Baseline capture" item={before} />}
              {after && <Quote label="The page now" item={after} />}
              {change.noiseReason && (
                <p className="text-ink-soft">Marked unimportant because: {change.noiseReason}</p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
});

function Quote({
  label,
  item,
}: {
  label: string;
  item: { excerpt: string | null; sectionPath: string[]; field: string | null };
}) {
  const where = item.sectionPath.length > 0 ? item.sectionPath.join(" › ") : null;
  return (
    <figure className="border-l-2 border-rule pl-3">
      <figcaption className="text-[0.78rem] font-medium text-ink-soft">
        {label}
        {where && <span> · {where}</span>}
        {item.field && <span> · {item.field.replace("metadata.", "")}</span>}
      </figcaption>
      <blockquote className="mt-0.5 text-ink">“{item.excerpt}”</blockquote>
    </figure>
  );
}

function Side({ label, tone, text }: { label: string; tone: "added" | "removed"; text: string }) {
  const styles = tone === "added" ? "border-added/30 bg-[#f1f7f3]" : "border-removed/30 bg-[#fdf0f0]";
  return (
    <div className={`rounded-[3px] border ${styles} p-2`}>
      <p className="text-[0.78rem] font-medium text-ink-soft">{label}</p>
      <p className="mt-0.5 break-words">{text}</p>
    </div>
  );
}

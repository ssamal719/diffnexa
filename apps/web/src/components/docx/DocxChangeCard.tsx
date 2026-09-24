"use client";

import { forwardRef, useState } from "react";

import {
  EDIT_MARK,
  editKindOf,
  headlineFor,
  locationOf,
  showsValuesInline,
  type DocxChange,
  type DocxEvidence,
} from "@/lib/docx-report";

const TONE = {
  added: "text-added",
  removed: "text-removed",
  changed: "text-signal",
  moved: "text-ink-soft",
} as const;

/**
 * One change between the two Word documents.
 *
 * A plain-language headline, the value before and after, and where it is in
 * Word's own terms. The evidence — the exact words quoted from each document
 * and where they sit — is one click away. No label on the card says whether a
 * change matters; that is for the reader to decide.
 */
export const DocxChangeCard = forwardRef<
  HTMLElement,
  { change: DocxChange; index: number; total: number; isCurrent: boolean; onFocus: () => void }
>(function DocxChangeCard({ change, index, total, isCurrent, onFocus }, ref) {
  const [showEvidence, setShowEvidence] = useState(false);
  const kind = editKindOf(change);
  const title = headlineFor(change);
  const where = locationOf(change);
  const original = change.evidence.filter((item) => item.side === "old");
  const revised = change.evidence.filter((item) => item.side === "new");

  return (
    <article
      ref={ref}
      tabIndex={-1}
      onFocus={onFocus}
      aria-label={`Change ${index + 1} of ${total}: ${title}${where ? `, ${where}` : ""}`}
      className={[
        "scroll-mt-24 rounded-[var(--radius-panel)] border bg-paper p-4 transition-colors",
        isCurrent ? "border-signal ring-1 ring-signal/20" : "border-rule",
      ].join(" ")}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-semibold wrap-anywhere">
          <span aria-hidden="true" className={`${TONE[kind]} mr-1.5`}>
            {EDIT_MARK[kind]}
          </span>
          {title}
        </h3>
        {where && <p className="ml-auto text-[0.82rem] text-ink-soft">{where}</p>}
      </header>
      {change.sections.length > 0 && (
        <p className="mt-0.5 text-[0.82rem] text-ink-soft">Under: {change.sections[0]}</p>
      )}

      {showsValuesInline(change) && change.oldValue && change.newValue ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="tabular min-w-0 rounded-[3px] bg-[#fdf0f0] px-2 py-1 line-through decoration-removed/60 wrap-anywhere">
            <span className="sr-only">Before: </span>
            {change.oldValue}
          </span>
          <span aria-hidden="true" className="text-ink-soft">
            →
          </span>
          <span className="tabular min-w-0 rounded-[3px] bg-[#f1f7f3] px-2 py-1 font-medium wrap-anywhere">
            <span className="sr-only">After: </span>
            {change.newValue}
          </span>
          {change.delta && (
            <span className="tabular rounded-full border border-rule px-2 py-0.5 text-[0.82rem] font-medium">
              <span className="sr-only">Difference: </span>
              {change.delta}
            </span>
          )}
        </div>
      ) : (
        <div className={`mt-3 grid grid-cols-1 gap-3 ${change.oldValue && change.newValue ? "md:grid-cols-2" : ""}`}>
          {change.oldValue && <Value label="Before" tone="removed" text={change.oldValue} />}
          {change.newValue && <Value label="After" tone="added" text={change.newValue} />}
        </div>
      )}

      {change.evidence.length > 0 && (
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
              <p className="text-ink-soft">Quoted exactly from each document, with where to find it.</p>
              {original.length > 0 && <Quotes label="Original document" items={original} />}
              {revised.length > 0 && <Quotes label="Revised document" items={revised} />}
            </div>
          )}
        </div>
      )}
    </article>
  );
});

function Quotes({ label, items }: { label: string; items: DocxEvidence[] }) {
  return (
    <figure className="border-l-2 border-rule pl-3">
      <figcaption className="text-[0.78rem] font-medium text-ink-soft">{label}</figcaption>
      <ul className="mt-0.5 space-y-1">
        {items.map((item, index) => (
          <li key={`${item.nodeId ?? item.field}-${index}`}>
            <span className="text-[0.78rem] text-ink-soft">{item.location}: </span>
            <q className="text-ink">{item.excerpt}</q>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Value({ label, tone, text }: { label: string; tone: "added" | "removed"; text: string }) {
  const styles = tone === "added" ? "border-added/30 bg-[#f1f7f3]" : "border-removed/30 bg-[#fdf0f0]";
  return (
    <div className={`min-w-0 rounded-[3px] border ${styles} p-2`}>
      <p className="text-[0.78rem] font-medium text-ink-soft">{label}</p>
      <p className="mt-0.5 wrap-anywhere">{text}</p>
    </div>
  );
}

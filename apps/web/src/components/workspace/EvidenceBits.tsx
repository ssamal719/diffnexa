"use client";

import type { ReactNode } from "react";

import { segmentsOf, type ContentView, type Side } from "@/lib/content-view";

/**
 * The pieces every tool's evidence is built from, so evidence reads the same
 * in every tool: what DiffNexa detected (the values before and after, and the
 * difference it calculated), then where each version says it, quoted.
 */

export function DetectedValues({
  before,
  after,
  difference,
  quoted,
}: {
  before: string | null;
  after: string | null;
  difference?: string | null;
  /** Passages quoted in full below; a long passage that is one of them is not printed twice. */
  quoted?: { original: (string | null)[]; revised: (string | null)[] };
}) {
  if (!before && !after) return null;
  const again = <span className="text-ink-soft">the passage quoted below</span>;
  // Short values — a price, a date — are always shown, even when the quotation is the same words.
  const beforeQuoted = before !== null && before.length > 60 && (quoted?.original ?? []).includes(before);
  const afterQuoted = after !== null && after.length > 60 && (quoted?.revised ?? []).includes(after);
  return (
    <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[0.85rem]">
      <dt className="text-ink-soft">Original</dt>
      <dd className="min-w-0 wrap-anywhere">
        {beforeQuoted ? (
          again
        ) : before ? (
          <span className="rounded-[2px] bg-[#fdf0f0] px-1 line-through decoration-removed/60">{before}</span>
        ) : (
          <span className="text-ink-soft">— not in the original</span>
        )}
      </dd>
      <dt className="text-ink-soft">Revised</dt>
      <dd className="min-w-0 wrap-anywhere">
        {afterQuoted ? (
          again
        ) : after ? (
          <span className="rounded-[2px] bg-[#eef7f1] px-1 font-medium">{after}</span>
        ) : (
          <span className="text-ink-soft">— not in the revised version</span>
        )}
      </dd>
      {difference && (
        <>
          <dt className="text-ink-soft">Difference</dt>
          <dd className="tabular font-semibold">{difference}</dd>
        </>
      )}
    </dl>
  );
}

/** One version's evidence: where it is, and the words quoted from it. */
export function EvidenceQuote({
  side,
  where,
  children,
}: {
  side: Side;
  where: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className={`mt-2 border-l-2 pl-2 ${side === "original" ? "border-removed/50" : "border-added/50"}`}>
      <figcaption className="text-[0.75rem] font-medium text-ink-soft">
        {side === "original" ? "Original" : "Revised"} · {where}
      </figcaption>
      <blockquote className="mt-0.5 text-[0.85rem] wrap-anywhere">{children}</blockquote>
    </figure>
  );
}

/**
 * The whole block a piece of evidence sits in, with the cited words marked —
 * the surrounding text, taken from the same content the comparison read.
 */
export function MarkedContext({
  view,
  side,
  nodeId,
  changeId,
}: {
  view: ContentView;
  side: Side;
  nodeId: string;
  changeId: string;
}) {
  const node = view[side].nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const marks = view.marks
    .filter((mark) => mark.side === side && "node" in mark && mark.node === nodeId && mark.change === changeId)
    .map((mark) => mark as { change: string; start: number; end: number });
  return (
    <>
      {segmentsOf(node.text, marks).map((segment, index) =>
        segment.changes.length > 0 ? (
          <mark
            key={index}
            className={
              side === "original"
                ? "rounded-[2px] bg-[#f8d7d9] px-0.5 text-ink line-through decoration-removed"
                : "rounded-[2px] bg-[#cfe8d8] px-0.5 text-ink underline decoration-added decoration-2 underline-offset-2"
            }
          >
            <span className="sr-only">{side === "original" ? "[original: " : "[revised: "}</span>
            {segment.text}
            <span className="sr-only">]</span>
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

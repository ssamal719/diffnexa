"use client";

import { useState, type ReactNode } from "react";

import type { Side } from "@/lib/content-view";

/**
 * The original and revised versions, side by side on wide screens.
 *
 * On a phone there is no room for two readable columns, so one version is
 * shown at a time with a switch between them — and when a change exists in
 * only one version (added or removed), that version is shown. A hidden
 * version cannot scroll, so each pane is told when it is revealed and moves to
 * the active change then.
 */
export function SideBySide({
  activation,
  prefer,
  headings,
  render,
}: {
  activation: number;
  /** The version the active change is in, when it is only in one. */
  prefer: Side | null;
  headings: Record<Side, { title: string; detail?: ReactNode }>;
  render: (side: Side, reveal: number) => ReactNode;
}) {
  const [mobileSide, setMobileSide] = useState<Side>("revised");
  const [handled, setHandled] = useState<number | null>(null);
  const [reveal, setReveal] = useState(0);

  // Worked out while rendering, so the right version is showing before the panes move.
  if (handled !== activation) {
    setHandled(activation);
    if (prefer) setMobileSide(prefer);
  }

  return (
    <div className="border-b border-rule">
      <div
        role="group"
        aria-label="Version to show"
        className="flex border-b border-rule bg-surface px-3 py-1.5 md:hidden"
      >
        <div className="flex rounded-[3px] border border-rule-strong">
          {(["original", "revised"] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-pressed={mobileSide === side}
              onClick={() => {
                setMobileSide(side);
                setReveal((count) => count + 1);
              }}
              className={[
                "px-3 py-1 text-[0.85rem] font-medium",
                mobileSide === side ? "bg-signal text-white" : "bg-paper text-ink",
              ].join(" ")}
            >
              {side === "original" ? "Original" : "Revised"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        {(["original", "revised"] as const).map((side) => (
          <section
            key={side}
            aria-label={headings[side].title}
            className={[
              "min-w-0 md:border-r md:border-rule md:last:border-r-0",
              mobileSide === side ? "block" : "hidden md:block",
            ].join(" ")}
          >
            <header className="flex items-baseline gap-2 px-3 pt-2 pb-1">
              <h3 className="shrink-0 text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase">
                {side === "original" ? "Original" : "Revised"}
              </h3>
              {headings[side].detail && (
                <p className="min-w-0 truncate text-[0.8rem]">{headings[side].detail}</p>
              )}
            </header>
            {render(side, reveal)}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Which version a change is in, when it is only in one: removed things are in the original, added in the revised. */
export function preferredSide(kind: string | undefined): Side | null {
  if (kind === "removed") return "original";
  if (kind === "added") return "revised";
  return null;
}

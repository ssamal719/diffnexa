"use client";

import type { PageBucket } from "@/lib/report";

/**
 * Where the document actually changed.
 *
 * This is the one thing a list cannot show: that six of eight changes sit on
 * pages 11 and 12, or that the first ten pages are untouched. Each column is a
 * page of the revised document; its height is that page's share of the changes,
 * and clicking it narrows the list to that page.
 *
 * Height alone would fail anyone who cannot compare small bars, so every page
 * with changes is also labelled with its count in the accessible name, and
 * changed pages carry a visible marker under the axis.
 */
const MIN_VISIBLE_HEIGHT = 0.18;

export function PageMap({
  pages,
  selected,
  onToggle,
}: {
  pages: PageBucket[];
  selected: number[];
  onToggle: (page: number) => void;
}) {
  if (pages.length === 0) return null;

  // Beyond about 40 pages individual columns stop being clickable targets, so
  // the map becomes a scrolling strip rather than shrinking into invisibility.
  const scrolls = pages.length > 40;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[0.9rem] font-medium">Where the changes are</h3>
        <p className="text-[0.78rem] text-ink-soft">Pages of the revised document</p>
      </div>

      <ul
        className={[
          "flex items-end gap-[3px]",
          scrolls ? "overflow-x-auto pb-1" : "",
        ].join(" ")}
      >
        {pages.map((bucket) => {
          const active = selected.includes(bucket.page);
          const height = bucket.count === 0 ? 0 : Math.max(bucket.intensity, MIN_VISIBLE_HEIGHT);
          return (
            <li key={bucket.page} className={scrolls ? "shrink-0" : "min-w-0 flex-1"}>
              <button
                type="button"
                disabled={bucket.count === 0}
                onClick={() => onToggle(bucket.page)}
                aria-pressed={active}
                aria-label={
                  bucket.count === 0
                    ? `Page ${bucket.page}, no changes`
                    : `Page ${bucket.page}, ${bucket.count} change${bucket.count === 1 ? "" : "s"}`
                }
                className={[
                  "group flex h-16 w-full flex-col justify-end rounded-[3px] px-[2px] pb-[2px]",
                  scrolls ? "w-6" : "",
                  bucket.count === 0 ? "cursor-default" : "hover:bg-surface-sunken",
                  active ? "bg-signal-soft" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "block w-full rounded-[2px] transition-colors",
                    bucket.count === 0
                      ? "h-[2px] bg-rule"
                      : active
                        ? "bg-signal"
                        : "bg-rule-strong group-hover:bg-signal",
                  ].join(" ")}
                  style={bucket.count === 0 ? undefined : { height: `${height * 100}%` }}
                />
              </button>
              <p
                className={[
                  "tabular mt-1 text-center text-[0.68rem]",
                  bucket.count === 0 ? "text-rule-strong" : "font-medium text-ink-soft",
                ].join(" ")}
              >
                {bucket.page}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

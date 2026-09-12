"use client";

import { PLANNED_CATEGORIES, type CategoryId, type CategorySummary } from "@/lib/report";

/**
 * The four kinds of change, as entry points rather than statistics.
 *
 * A category with no changes stays visible and is disabled: knowing that no
 * dates changed is useful information, and a tile that vanishes makes the
 * report's shape change between comparisons.
 */
export function CategoryTiles({
  categories,
  selected,
  onToggle,
}: {
  categories: CategorySummary[];
  selected: CategoryId[];
  onToggle: (id: CategoryId) => void;
}) {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {categories.map((category) => {
          const active = selected.includes(category.id);
          const empty = category.count === 0;
          return (
            <li key={category.id}>
              <button
                type="button"
                disabled={empty}
                onClick={() => onToggle(category.id)}
                aria-pressed={active}
                className={[
                  "h-full w-full rounded-[var(--radius-panel)] border p-3 text-left transition-colors",
                  empty
                    ? "cursor-default border-rule bg-surface text-ink-soft"
                    : active
                      ? "border-signal bg-signal-soft"
                      : "border-rule bg-paper hover:border-rule-strong",
                ].join(" ")}
              >
                <span className="tabular block text-[1.6rem] leading-none font-semibold">
                  {category.count}
                </span>
                <span className="mt-1 block text-[0.9rem] font-medium">{category.label}</span>
                <span className="mt-0.5 block text-[0.78rem] leading-snug text-ink-soft">
                  {empty ? "No changes" : category.blurb}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[0.78rem] text-ink-soft">
        Coming later:{" "}
        {PLANNED_CATEGORIES.map((item) => item.label).join(" and ")}. These are not compared yet, so
        nothing about them is reported here.
      </p>
    </div>
  );
}

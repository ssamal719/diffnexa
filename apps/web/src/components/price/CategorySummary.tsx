"use client";

import { changedCategories, type PriceComparison } from "@/lib/price-report";

/**
 * The kinds of change found, with how many of each.
 *
 * Each is a toggle that narrows the list below to that kind. Only categories
 * with at least one change are shown; listing the empty ones would read like a
 * statement about the rest of the page, which a comparison cannot make.
 */
export function CategorySummary({
  result,
  selected,
  onSelect,
}: {
  result: PriceComparison;
  selected: string | null;
  onSelect: (categoryId: string | null) => void;
}) {
  const categories = changedCategories(result);
  if (categories.length === 0) return null;

  return (
    <section aria-labelledby="categories-heading">
      <h3 id="categories-heading" className="text-[0.9rem] font-medium">
        What kind of changes
      </h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <li key={category.id}>
            <button
              type="button"
              aria-pressed={selected === category.id}
              onClick={() => onSelect(selected === category.id ? null : category.id)}
              className={[
                "w-full rounded-[var(--radius-panel)] border p-3 text-left",
                selected === category.id
                  ? "border-signal bg-signal-soft"
                  : "border-rule bg-paper hover:border-rule-strong",
              ].join(" ")}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{category.label}</span>
                <span className="tabular text-[0.85rem] text-ink-soft">
                  <span className="sr-only">: </span>
                  {category.changeCount}
                  <span className="sr-only">
                    {" "}
                    change{category.changeCount === 1 ? "" : "s"}.{" "}
                  </span>
                </span>
              </span>
              <span className="mt-0.5 block text-[0.8rem] text-ink-soft">{category.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.78rem] text-ink-soft">
        Each change is placed in one group, using the page&apos;s own wording, headings and
        tables. A number counts as a price only when the page shows it with a currency or in a
        price column. Select a group to show only its changes.
      </p>
    </section>
  );
}

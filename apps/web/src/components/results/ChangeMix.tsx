"use client";

import { EDIT_KIND_LABEL, EDIT_KIND_MARK, type EditKind } from "@/lib/report";

const TONE: Record<EditKind, { bar: string; text: string }> = {
  added: { bar: "bg-added", text: "text-added" },
  removed: { bar: "bg-removed", text: "text-removed" },
  changed: { bar: "bg-signal", text: "text-signal" },
  moved: { bar: "bg-rule-strong", text: "text-ink-soft" },
};

/**
 * The proportion of additions, removals and rewrites, as one bar.
 *
 * Each segment is a button: clicking it narrows the list below to that kind of
 * edit. The bar is only drawn when there is more than one kind to compare —
 * a single full-width segment would say nothing a number does not.
 */
export function ChangeMix({
  mix,
  total,
  selected,
  onToggle,
}: {
  mix: { kind: EditKind; count: number }[];
  total: number;
  selected: EditKind[];
  onToggle: (kind: EditKind) => void;
}) {
  if (mix.length === 0) return null;

  return (
    <div>
      {mix.length > 1 && (
        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
          role="presentation"
        >
          {mix.map((entry) => (
            <div
              key={entry.kind}
              className={TONE[entry.kind].bar}
              style={{ width: `${(entry.count / total) * 100}%` }}
            />
          ))}
        </div>
      )}

      <ul className="mt-3 flex flex-wrap gap-2">
        {mix.map((entry) => {
          const active = selected.includes(entry.kind);
          return (
            <li key={entry.kind}>
              <button
                type="button"
                onClick={() => onToggle(entry.kind)}
                aria-pressed={active}
                className={[
                  "flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-[0.85rem] transition-colors",
                  active
                    ? "border-signal bg-signal-soft text-ink"
                    : "border-rule bg-paper text-ink-soft hover:border-rule-strong",
                ].join(" ")}
              >
                <span aria-hidden="true" className={TONE[entry.kind].text}>
                  {EDIT_KIND_MARK[entry.kind]}
                </span>
                <span className="tabular font-medium text-ink">{entry.count}</span>
                <span>{EDIT_KIND_LABEL[entry.kind].toLowerCase()}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

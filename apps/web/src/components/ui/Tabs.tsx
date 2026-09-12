"use client";

type Tab = { id: string; label: string };

/**
 * A small set of mutually exclusive choices.
 *
 * Implemented as buttons with `aria-pressed` rather than links, because the
 * choice changes what is on screen rather than navigating anywhere.
 */
export function Tabs({
  label,
  tabs,
  active,
  onSelect,
}: {
  label: string;
  tabs: Tab[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-[3px] border border-rule bg-surface p-0.5">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(tab.id)}
            className={[
              "rounded-[2px] px-3 py-1.5 text-[0.88rem] font-medium transition-colors",
              selected ? "bg-paper text-ink shadow-[0_0_0_1px_var(--color-rule)]" : "text-ink-soft hover:text-ink",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

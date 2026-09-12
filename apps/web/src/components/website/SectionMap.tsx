"use client";

import type { SectionNode } from "@/lib/web-report";

/**
 * Where on the page the changes are.
 *
 * A webpage has no pages, so the honest answer to "where" is the page's own
 * headings. This shows that hierarchy with a count beside each heading, and
 * choosing one narrows the list below. A parent heading includes everything
 * beneath it, which is how a reader would expect it to behave.
 */
export function SectionMap({
  sections,
  selected,
  onToggle,
}: {
  sections: SectionNode[];
  selected: string[];
  onToggle: (path: string) => void;
}) {
  if (sections.length === 0) return null;

  const rows: SectionNode[] = [];
  const walk = (nodes: SectionNode[]) => {
    for (const node of nodes) {
      rows.push(node);
      walk(node.children);
    }
  };
  walk(sections);

  return (
    <div>
      <h3 className="mb-2 text-[0.9rem] font-medium">Where the changes are</h3>
      <ul className="space-y-px">
        {rows.map((node) => {
          const active = selected.includes(node.path);
          return (
            <li key={node.path}>
              <button
                type="button"
                onClick={() => onToggle(node.path)}
                aria-pressed={active}
                className={[
                  "flex w-full items-baseline justify-between gap-3 rounded-[3px] px-2 py-1.5 text-left",
                  active ? "bg-signal-soft" : "hover:bg-surface",
                ].join(" ")}
                style={{ paddingLeft: `${0.5 + node.depth * 1}rem` }}
              >
                <span className={node.depth === 0 ? "font-medium" : "text-ink-soft"}>{node.name}</span>
                <span className="tabular shrink-0 text-[0.85rem] text-ink-soft">
                  {node.count}
                  <span className="sr-only"> change{node.count === 1 ? "" : "s"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

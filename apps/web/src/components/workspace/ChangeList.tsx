"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { WorkspaceContext } from "@/components/workspace/ComparisonWorkspace";
import { scrollWithin } from "@/lib/scroll";
import type { WorkspaceChange } from "@/lib/workspace";

export type CardProps = {
  index: number;
  total: number;
  isCurrent: boolean;
  onFocus: () => void;
};

/**
 * The List view: every change the navigator lists, as the tool's own cards,
 * for reading straight through. Choosing a card makes it the active change;
 * choosing a change anywhere else brings its card into view.
 */
export function ChangeList({
  context,
  renderCard,
  sectionOf,
}: {
  context: WorkspaceContext;
  renderCard: (change: WorkspaceChange, props: CardProps) => ReactNode;
  /** Optional headings between cards, for tools that group their list (signals, categories). */
  sectionOf?: (change: WorkspaceChange) => { key: string; title: string; blurb?: string };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { visible, active, activation } = context;

  useEffect(() => {
    if (!active) return;
    const card = [...(containerRef.current?.querySelectorAll<HTMLElement>("[data-change-id]") ?? [])].find(
      (element) => element.dataset.changeId === active.id,
    );
    scrollWithin(containerRef.current, card ?? null);
  }, [active, activation]);

  if (visible.length === 0) {
    return <p className="p-4 text-ink-soft">Nothing matches this search or filter. Clear it to see every change.</p>;
  }

  const items: ReactNode[] = [];
  let lastSection: string | null = null;
  for (let index = 0; index < visible.length; index += 1) {
    const change = visible[index];
    const section = sectionOf?.(change);
    if (section && section.key !== lastSection) {
      lastSection = section.key;
      const count = visible.filter((item) => sectionOf!(item).key === section.key).length;
      items.push(
        <div key={`section-${section.key}-${index}`} className="pt-2">
          <h3 className="text-[1rem] font-semibold">
            {section.title}{" "}
            <span className="tabular text-[0.85rem] font-normal text-ink-soft">
              · {count} change{count === 1 ? "" : "s"}
            </span>
          </h3>
          {section.blurb && <p className="text-[0.82rem] text-ink-soft">{section.blurb}</p>}
        </div>,
      );
    }
    items.push(
      <div key={change.id} data-change-id={change.id}>
        {renderCard(change, {
          index,
          total: visible.length,
          isCurrent: active?.id === change.id,
          onFocus: () => {
            if (active?.id !== change.id) context.activate(change.id);
          },
        })}
      </div>,
    );
  }

  return (
    <div ref={containerRef} className="max-h-[46rem] space-y-3 overflow-y-auto border-b border-rule p-3 lg:border-b-0">
      {items}
    </div>
  );
}

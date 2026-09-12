"use client";

import { forwardRef, useEffect, useState } from "react";

import { ChangeCard } from "@/components/results/ChangeCard";
import { pageGroupHeadline, pageGroupSummary, type ReportItem } from "@/lib/report";

type PageGroup = Extract<ReportItem, { type: "page-group" }>;

/**
 * A whole page that was added or removed.
 *
 * The page itself is the headline, because that is what a reader needs to know
 * first. The text on it is real, evidence-backed detail, so it is kept and
 * nested rather than hidden: one click opens every underlying change, each with
 * its own quotations and page references.
 *
 * When a search is running the section opens automatically, so a match inside a
 * collapsed group is never invisible.
 */
export const PageGroupCard = forwardRef<
  HTMLElement,
  {
    group: PageGroup;
    index: number;
    total: number;
    isCurrent: boolean;
    onFocus: () => void;
    forceOpen: boolean;
  }
>(function PageGroupCard({ group, index, total, isCurrent, onFocus, forceOpen }, ref) {
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;
  const added = group.side === "new";
  const count = group.members.length;

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <article
      ref={ref}
      tabIndex={-1}
      onFocus={onFocus}
      aria-label={`Result ${index + 1} of ${total}: ${pageGroupHeadline(group)}`}
      className={[
        "scroll-mt-24 rounded-[var(--radius-panel)] border-l-[3px] bg-paper",
        added ? "border-l-added" : "border-l-removed",
        isCurrent ? "border border-signal ring-1 ring-signal/20" : "border border-rule",
      ].join(" ")}
    >
      <header className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[1.05rem] font-semibold">
            <span aria-hidden="true" className={`mr-1.5 ${added ? "text-added" : "text-removed"}`}>
              {added ? "+" : "−"}
            </span>
            {pageGroupHeadline(group)}
          </h3>
          <p className="tabular ml-auto text-[0.82rem] text-ink-soft">
            {added ? "New document" : "Previous document"}
          </p>
        </div>
        <p className="mt-1 max-w-prose text-ink-soft">{pageGroupSummary(group)}</p>

        {count > 0 && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={expanded}
            className="mt-3 rounded-[3px] border border-rule-strong px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"
          >
            {expanded ? "Hide" : "View"} {count} text change{count === 1 ? "" : "s"} on this page
          </button>
        )}
      </header>

      {expanded && count > 0 && (
        <div className="space-y-3 border-t border-rule bg-surface p-3 md:p-4">
          <p className="text-[0.85rem] text-ink-soft">
            Each of these is a separate detected change with its own evidence.
          </p>
          {group.members.map((member, position) => (
            <ChangeCard
              key={member.id}
              change={member}
              index={position}
              total={count}
              isCurrent={false}
              onFocus={() => undefined}
            />
          ))}
        </div>
      )}
    </article>
  );
});

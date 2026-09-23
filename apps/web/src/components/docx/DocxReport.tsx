"use client";

import { useMemo, useRef, useState } from "react";

import { DocxChangeCard } from "@/components/docx/DocxChangeCard";
import { Alert } from "@/components/ui/Alert";
import {
  NO_CHANGES_SENTENCE,
  filterChanges,
  groupChanges,
  headline,
  readingNotes,
  type DocxComparison,
  type DocxGroupId,
} from "@/lib/docx-report";
import { formatFileSize } from "@/lib/validation";

type FileSummary = { name: string; sizeBytes: number };

/**
 * The result of comparing two Word documents.
 *
 * Every change the engine found is shown, in exactly one group, in reading
 * order. The groups say what kind of content changed — text, a heading, a
 * table cell — and nothing more: no change is marked important or minor,
 * and none is hidden.
 */
export function DocxReport({
  result,
  original,
  revised,
}: {
  result: DocxComparison;
  original: FileSummary;
  revised: FileSummary;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<DocxGroupId | null>(null);
  const [current, setCurrent] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  const total = result.changes.length;
  const summary = result.groups.filter((item) => item.changeCount > 0);
  const groups = useMemo(
    () => groupChanges(result, filterChanges(result, { query, group })),
    [result, query, group],
  );
  const flat = groups.flatMap((item) => item.changes);
  const indexOf = new Map(flat.map((change, index) => [change.id, index]));
  const filtering = query.trim() !== "" || group !== null;
  const notes = readingNotes(result);

  function chooseGroup(next: DocxGroupId | null) {
    setGroup(next);
    setCurrent(0);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: "start" }));
  }

  function goTo(index: number) {
    if (index < 0 || index >= flat.length) return;
    setCurrent(index);
    cardRefs.current[index]?.focus();
    cardRefs.current[index]?.scrollIntoView({ block: "center" });
  }

  return (
    <section aria-labelledby="docx-report-heading" className="mt-6 space-y-4">
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <header className="border-b border-rule p-4 md:p-5">
          <p className="text-[0.82rem] font-medium text-added">Comparison complete</p>
          <h2 id="docx-report-heading" className="mt-1 text-[1.5rem] leading-tight font-semibold md:text-[1.75rem]">
            {headline(total)}
          </h2>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[0.88rem] sm:grid-cols-[9.5rem_1fr]">
            <dt className="text-ink-soft">Original document</dt>
            <dd className="break-words">
              {original.name} <span className="text-ink-soft">· {formatFileSize(original.sizeBytes)}</span>
            </dd>
            <dt className="text-ink-soft">Revised document</dt>
            <dd className="break-words">
              {revised.name} <span className="text-ink-soft">· {formatFileSize(revised.sizeBytes)}</span>
            </dd>
          </dl>
        </header>

        <div className="p-4 md:p-5">
          {total === 0 ? (
            <p>{NO_CHANGES_SENTENCE}</p>
          ) : (
            <section aria-labelledby="docx-groups-heading">
              <h3 id="docx-groups-heading" className="text-[0.9rem] font-medium">
                Where the changes are
              </h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {summary.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={group === item.id}
                      onClick={() => chooseGroup(group === item.id ? null : item.id)}
                      className={[
                        "w-full rounded-[var(--radius-panel)] border p-3 text-left",
                        group === item.id ? "border-signal bg-signal-soft" : "border-rule bg-paper hover:border-rule-strong",
                      ].join(" ")}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{item.label}</span>
                        <span className="tabular text-[0.85rem] text-ink-soft">
                          <span className="sr-only">: </span>
                          {item.changeCount}
                          <span className="sr-only"> change{item.changeCount === 1 ? "" : "s"}.</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.78rem] text-ink-soft">
                Each change is in one group, by the kind of content that changed. Select a group to show
                only its changes.
              </p>
            </section>
          )}
        </div>
      </div>

      {notes.map((note) => (
        <Alert key={`${note.title}-${note.text}`} tone="note" title={note.title}>
          {note.text}
        </Alert>
      ))}

      {total > 0 && (
        <div ref={listRef} className="rounded-[var(--radius-panel)] border border-rule bg-paper">
          <div className="flex flex-wrap items-center gap-3 border-b border-rule p-3 md:p-4">
            <h2 className="mr-auto text-[1.05rem] font-semibold">What changed</h2>
            <label className="min-w-[12rem] flex-1">
              <span className="sr-only">Search the changes</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCurrent(0);
                }}
                placeholder="Search wording, values or locations"
                className="w-full rounded-[3px] border border-rule bg-paper px-3 py-1.5 text-[0.9rem]"
              />
            </label>
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setGroup(null);
                  setCurrent(0);
                }}
                className="rounded-[3px] border border-rule-strong px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"
              >
                Clear filters
              </button>
            )}
          </div>

          {flat.length > 1 && (
            <div className="flex items-center justify-between gap-3 border-b border-rule bg-surface px-3 py-2 md:px-4">
              <p className="tabular text-[0.85rem] text-ink-soft" role="status" aria-live="polite">
                Change {Math.min(current + 1, flat.length)} of {flat.length}
                {filtering && ` · filtered from ${total}`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Previous change"
                  disabled={current === 0}
                  onClick={() => goTo(current - 1)}
                  className="rounded-[3px] border border-rule-strong bg-paper px-3 py-1 hover:bg-surface disabled:text-rule-strong"
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="Next change"
                  disabled={current >= flat.length - 1}
                  onClick={() => goTo(current + 1)}
                  className="rounded-[3px] border border-rule-strong bg-paper px-3 py-1 hover:bg-surface disabled:text-rule-strong"
                >
                  →
                </button>
              </div>
            </div>
          )}

          {flat.length === 0 ? (
            <p className="p-4 text-ink-soft md:p-5">
              Nothing matches these filters. Clear them to see all {total} changes.
            </p>
          ) : (
            <div className="space-y-6 p-3 md:p-4">
              {groups.map((item) => (
                <section key={item.id} aria-labelledby={`docx-group-${item.id}`}>
                  <h3 id={`docx-group-${item.id}`} className="text-[1rem] font-semibold">
                    {item.label}{" "}
                    <span className="tabular text-[0.85rem] font-normal text-ink-soft">
                      · {item.changes.length} change{item.changes.length === 1 ? "" : "s"}
                    </span>
                  </h3>
                  <p className="mt-0.5 text-[0.82rem] text-ink-soft">{item.blurb}</p>
                  <div className="mt-2 space-y-3">
                    {item.changes.map((change) => {
                      const index = indexOf.get(change.id) ?? 0;
                      return (
                        <DocxChangeCard
                          key={change.id}
                          ref={(element) => {
                            cardRefs.current[index] = element;
                          }}
                          change={change}
                          index={index}
                          total={flat.length}
                          isCurrent={index === current}
                          onFocus={() => setCurrent(index)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          <footer className="border-t border-rule p-3 text-[0.78rem] text-ink-soft md:p-4">
            Every change above was found by comparing the text and structure of the two documents,
            and points to where it is in each. Visual formatting, images, headers, footers,
            footnotes and comments are not compared. No AI was used.
          </footer>
        </div>
      )}
    </section>
  );
}

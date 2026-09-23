"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  EDIT_MARK,
  EDIT_WORD,
  counterText,
  navigatorGroups,
  searchChanges,
  stepChange,
  type WorkspaceChange,
  type WorkspaceMode,
} from "@/lib/workspace";
import type { FocusRequest } from "@/lib/use-change-focus";

const TONE = {
  added: "text-added",
  removed: "text-removed",
  changed: "text-signal",
  moved: "text-ink-soft",
} as const;

export type WorkspaceContext = {
  mode: string;
  setMode: (mode: string) => void;
  active: WorkspaceChange | null;
  /** Increases every time a change is chosen, even the same one again, so views can move to it. */
  activation: number;
  activate: (id: string) => void;
  visible: WorkspaceChange[];
};

/**
 * Comparison Workspace V2: the shared screen for comparing two versions.
 *
 * Controls across the top, every change in a navigator on the left, and the
 * tool's own view of the two versions in the main area. Choosing a change —
 * in the navigator, with Previous/Next, or from a view — makes it the active
 * change everywhere, and the tool's view moves both versions to it.
 *
 * The workspace knows nothing about workbooks or documents. A tool passes its
 * changes in the shared shape (`WorkspaceChange`), the modes it genuinely
 * offers, and what to draw for each; the workspace adds nothing of its own to
 * the result.
 */
export function ComparisonWorkspace({
  title,
  headline,
  summary,
  emptyNote,
  files,
  changes,
  modes,
  initialMode,
  renderMain,
  renderDetails,
  notes,
  focus = null,
}: {
  title: string;
  headline: string;
  summary: { label: string; count: number }[];
  /** Shown instead of the navigator when nothing changed. */
  emptyNote: string;
  files: { original: string; revised: string };
  changes: WorkspaceChange[];
  modes: WorkspaceMode[];
  initialMode: string;
  renderMain: (context: WorkspaceContext) => ReactNode;
  renderDetails?: (context: WorkspaceContext) => ReactNode;
  notes?: ReactNode;
  /** A change to show, asked for from outside the workspace (AI Change Analyst's "View change"). */
  focus?: FocusRequest;
}) {
  const id = useId();
  const [mode, setMode] = useState(initialMode);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(changes[0]?.id ?? null);
  const [activation, setActivation] = useState(0);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const visible = useMemo(() => searchChanges(changes, query), [changes, query]);
  const groups = useMemo(() => navigatorGroups(visible), [visible]);
  const active = changes.find((change) => change.id === activeId) ?? null;

  const [focusActive, setFocusActive] = useState(false);
  const [handledFocus, setHandledFocus] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const scrolledFor = useRef<number | null>(null);

  // A change asked for from outside becomes the active change, exactly as if it
  // had been chosen in the navigator, and is never hidden by a search.
  if (focus && handledFocus !== focus.token && changes.some((change) => change.id === focus.id)) {
    setHandledFocus(focus.token);
    setQuery("");
    setActiveId(focus.id);
    setActivation((count) => count + 1);
    setFocusActive(false);
  }

  useEffect(() => {
    if (!focus || handledFocus !== focus.token || scrolledFor.current === focus.token) return;
    scrolledFor.current = focus.token;
    sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [focus, handledFocus]);

  function activate(next: string | null, focus = false) {
    if (!next) return;
    setActiveId(next);
    setActivation((count) => count + 1);
    setFocusActive(focus);
  }

  // Keep the active change in view in the navigator, however it was chosen, and
  // move keyboard focus to it when it was chosen with the arrow keys.
  useEffect(() => {
    if (!activeId) return;
    const element = itemRefs.current.get(activeId);
    element?.scrollIntoView?.({ block: "nearest" });
    if (focusActive) element?.focus();
  }, [activeId, activation, focusActive]);

  const context: WorkspaceContext = {
    mode,
    setMode,
    active,
    activation,
    activate: (next) => activate(next),
    visible,
  };

  function onNavigatorKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activate(stepChange(visible, activeId, event.key === "ArrowDown" ? 1 : -1), true);
    }
  }

  const counter = counterText(visible, changes.length, activeId);
  const atStart = visible.length === 0 || visible[0].id === activeId;
  const atEnd = visible.length === 0 || visible[visible.length - 1].id === activeId;

  return (
    <section
      ref={sectionRef}
      aria-labelledby={`${id}-headline`}
      className="mt-6 scroll-mt-4 rounded-[var(--radius-panel)] border border-rule bg-paper"
    >
      {/* Overview */}
      <header className="flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <p className="text-[0.78rem] font-medium text-added">Comparison complete · {title}</p>
          <h2 id={`${id}-headline`} className="text-[1.35rem] leading-tight font-semibold">
            {headline}
          </h2>
          {summary.length > 0 && (
            <p className="tabular mt-0.5 text-[0.88rem] text-ink-soft">
              {summary.map((item) => `${item.count} ${item.label}`).join(" · ")}
            </p>
          )}
        </div>
        <dl className="ml-auto grid min-w-0 grid-cols-[auto_1fr] gap-x-3 text-[0.82rem]">
          <dt className="text-ink-soft">Original</dt>
          <dd className="min-w-0 truncate" title={files.original}>
            {files.original}
          </dd>
          <dt className="text-ink-soft">Revised</dt>
          <dd className="min-w-0 truncate" title={files.revised}>
            {files.revised}
          </dd>
        </dl>
      </header>

      {notes}

      {changes.length === 0 ? (
        <div className="p-4">
          <p className="font-medium">{headline}</p>
          <p className="mt-1 text-ink-soft">{emptyNote}</p>
          <div className="mt-4">{renderMain(context)}</div>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-rule bg-paper/95 px-3 py-2 backdrop-blur">
            <div role="tablist" aria-label="View" className="flex rounded-[3px] border border-rule-strong">
              {modes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${item.id}`}
                  aria-selected={mode === item.id}
                  aria-controls={`${id}-panel`}
                  onClick={() => setMode(item.id)}
                  className={[
                    "px-3 py-1 text-[0.85rem] font-medium first:rounded-l-[2px] last:rounded-r-[2px]",
                    mode === item.id ? "bg-signal text-white" : "bg-paper text-ink hover:bg-surface",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="min-w-[10rem] flex-1 sm:max-w-[18rem]">
              <span className="sr-only">Search changes</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search changes"
                className="w-full rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[0.85rem]"
              />
            </label>
            <p role="status" aria-live="polite" className="tabular ml-auto text-[0.82rem] text-ink-soft">
              {counter}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => activate(stepChange(visible, activeId, -1))}
                disabled={atStart}
                className="rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[0.85rem] font-medium hover:bg-surface disabled:text-rule-strong"
              >
                <span aria-hidden="true">← </span>Previous
              </button>
              <button
                type="button"
                onClick={() => activate(stepChange(visible, activeId, 1))}
                disabled={atEnd}
                className="rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[0.85rem] font-medium hover:bg-surface disabled:text-rule-strong"
              >
                Next<span aria-hidden="true"> →</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
            {/* Differences navigator */}
            <nav
              aria-label="Differences"
              onKeyDown={onNavigatorKey}
              className="relative max-h-[17rem] overflow-y-auto border-b border-rule lg:max-h-[46rem] lg:border-r lg:border-b-0"
            >
              <p className="sticky top-0 z-10 flex items-baseline justify-between border-b border-rule bg-surface px-3 py-1.5 text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase">
                Differences
                <span className="tabular font-medium normal-case">
                  {visible.length === changes.length ? `All ${changes.length}` : `${visible.length} of ${changes.length}`}
                </span>
              </p>
              {visible.length === 0 ? (
                <p className="px-3 py-3 text-[0.85rem] text-ink-soft">No change matches this search.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.key}>
                    <p className="px-3 pt-2.5 pb-1 text-[0.78rem] font-semibold text-ink">{group.label}</p>
                    <ul>
                      {group.changes.map((change) => {
                        const current = change.id === activeId;
                        return (
                          <li key={change.id}>
                            <button
                              type="button"
                              ref={(element) => {
                                if (element) itemRefs.current.set(change.id, element);
                                else itemRefs.current.delete(change.id);
                              }}
                              aria-current={current ? "true" : undefined}
                              aria-label={change.description}
                              onClick={() => activate(change.id)}
                              className={[
                                "block w-full border-l-[3px] px-3 py-1.5 text-left text-[0.84rem]",
                                current ? "border-signal bg-signal-soft" : "border-transparent hover:bg-surface",
                              ].join(" ")}
                            >
                              <span className="flex items-baseline gap-2">
                                <span className="tabular text-[0.75rem] text-ink-soft">#{change.number}</span>
                                <span className="font-semibold">{change.place}</span>
                                <span className="ml-auto text-[0.75rem] text-ink-soft">
                                  <span aria-hidden="true" className={`${TONE[change.kind]} mr-1`}>
                                    {EDIT_MARK[change.kind]}
                                  </span>
                                  {change.category}
                                </span>
                              </span>
                              {(change.before || change.after) && (
                                <span className="mt-0.5 block truncate text-[0.8rem] text-ink-soft">
                                  {change.before && <span className="line-through decoration-removed/50">{change.before}</span>}
                                  {change.before && change.after && <span aria-hidden="true"> → </span>}
                                  {change.after && <span className="text-ink">{change.after}</span>}
                                </span>
                              )}
                              <span className="sr-only">{EDIT_WORD[change.kind]}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </nav>

            <div
              id={`${id}-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-tab-${mode}`}
              className="min-w-0"
            >
              {renderMain(context)}
              {renderDetails?.(context)}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

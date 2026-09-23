"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { AIExplanation } from "@/components/workspace/AIExplanation";
import type { ChangeAnalysis } from "@/lib/analysis";
import { scrollWithin } from "@/lib/scroll";
import type { FocusRequest } from "@/lib/use-change-focus";
import {
  EDIT_MARK,
  EDIT_WORD,
  NO_FILTERS,
  counterText,
  filterChanges,
  hasFilters,
  navigatorGroups,
  searchChanges,
  stepChange,
  toggleFilter,
  type FilterGroup,
  type FilterState,
  type WorkspaceChange,
  type WorkspaceMode,
} from "@/lib/workspace";

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
  /** The changes the navigator lists: searched, filtered, in reading order. */
  visible: WorkspaceChange[];
  filters: FilterState;
  toggleFilter: (group: string, option: string) => void;
  /** Sets one filter group's choice outright; an empty list means "all". */
  setFilter: (group: string, options: string[]) => void;
  clearFilters: () => void;
};

type Fact = { label: string; value: ReactNode };

/**
 * The Comparison Workspace: the one screen every DiffNexa tool uses to show a
 * finished comparison.
 *
 * Across the top, what was compared and how many changes were found. Below,
 * three panes: every change in a navigator on the left, the two versions in
 * the middle (drawn by the tool), and the evidence for the active change on
 * the right. Choosing a change — in the navigator, with Previous/Next, with
 * the arrow keys, or from AI Change Analyst — makes it the active change
 * everywhere: the tool's view moves both versions to it and the evidence panel
 * shows what proves it.
 *
 * AI Change Analyst sits underneath, as an optional second step. The evidence
 * panel keeps DiffNexa's deterministic evidence and the AI's explanation in
 * separate, labelled sections, so it is always clear which is which.
 *
 * The workspace knows nothing about pages, cells or headings. A tool passes
 * its changes in the shared shape (`WorkspaceChange`), the views it genuinely
 * offers, and what to draw; the workspace adds nothing of its own to the result.
 */
export function ComparisonWorkspace({
  tool,
  headline,
  summary,
  emptyNote,
  facts,
  changes,
  modes,
  initialMode,
  filters = [],
  overview,
  overviewTitle = "Summary",
  renderMain,
  renderEvidence,
  notes,
  footer,
  minorLabel = "minor difference",
  showMainWhenEmpty = false,
  analyst,
  analysis = null,
  focus = null,
}: {
  /** The tool's name: "PDF Compare". */
  tool: string;
  headline: string;
  summary: { label: string; count: number }[];
  /** Shown instead of the workspace when nothing changed. */
  emptyNote: ReactNode;
  /** What was compared: the two files, or the address, page type and baseline. */
  facts: Fact[];
  changes: WorkspaceChange[];
  modes: WorkspaceMode[];
  initialMode: string;
  filters?: FilterGroup[];
  /** A tool's own summary above the workspace (policy topics, competitor signals). */
  overview?: (context: WorkspaceContext) => ReactNode;
  overviewTitle?: string;
  renderMain: (context: WorkspaceContext) => ReactNode;
  /** The deterministic evidence for the active change. */
  renderEvidence?: (context: WorkspaceContext) => ReactNode;
  notes?: ReactNode;
  /** A line under the workspace saying how the result was produced. */
  footer?: ReactNode;
  /** What this tool calls a minor difference, singular: "minor difference", "unimportant difference". */
  minorLabel?: string;
  /** Draw the two versions even when nothing changed (a workbook is still worth seeing). */
  showMainWhenEmpty?: boolean;
  /** AI Change Analyst, shown under the workspace. */
  analyst?: ReactNode;
  /** The AI analysis, once the person has asked for it. */
  analysis?: ChangeAnalysis | null;
  /** A change to show, asked for from outside the workspace (AI Change Analyst's "View change"). */
  focus?: FocusRequest;
}) {
  const id = useId();
  const [mode, setMode] = useState<string>(
    modes.some((item) => item.id === initialMode) ? initialMode : (modes[0]?.id ?? initialMode),
  );
  const [query, setQuery] = useState("");
  const [filterState, setFilterState] = useState<FilterState>(NO_FILTERS);
  const [includeMinor, setIncludeMinor] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The summary starts open where there is room for it, and folded on a phone.
  const [overviewOpen, setOverviewOpen] = useState(
    () => typeof window === "undefined" || !window.matchMedia || window.matchMedia("(min-width: 768px)").matches,
  );
  const major = useMemo(() => changes.filter((change) => !change.minor), [changes]);
  const minorCount = changes.length - major.length;
  const [activeId, setActiveId] = useState<string | null>(major[0]?.id ?? null);
  const [activation, setActivation] = useState(0);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const pool = useMemo(() => filterChanges(changes, filterState, includeMinor), [changes, filterState, includeMinor]);
  const visible = useMemo(() => searchChanges(pool, query), [pool, query]);
  const groups = useMemo(() => navigatorGroups(visible), [visible]);
  const active = changes.find((change) => change.id === activeId) ?? null;
  const listed = includeMinor ? changes.length : major.length;
  const filtering = hasFilters(filterState) || query.trim() !== "";

  const [focusActive, setFocusActive] = useState(false);
  const [handledFocus, setHandledFocus] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const scrolledFor = useRef<number | null>(null);

  // A change asked for from outside becomes the active change, exactly as if it
  // had been chosen in the navigator. Nothing a reader chose may hide it: the
  // search and filters are cleared, and minor differences shown if it is one.
  const focusTarget = focus ? changes.find((change) => change.id === focus.id) : undefined;
  if (focus && handledFocus !== focus.token && focusTarget) {
    setHandledFocus(focus.token);
    setQuery("");
    if (!filterChanges([focusTarget], filterState, includeMinor).length) setFilterState(NO_FILTERS);
    if (focusTarget.minor) setIncludeMinor(true);
    setActiveId(focus.id);
    setActivation((count) => count + 1);
    setFocusActive(false);
  }

  useEffect(() => {
    if (!focus || handledFocus !== focus.token || scrolledFor.current === focus.token) return;
    scrolledFor.current = focus.token;
    sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [focus, handledFocus]);

  function activate(next: string | null, moveFocus = false) {
    if (!next) return;
    setActiveId(next);
    setActivation((count) => count + 1);
    setFocusActive(moveFocus);
  }

  // Keep the active change in view in the navigator, however it was chosen, and
  // move keyboard focus to it when it was chosen with the arrow keys.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!activeId) return;
    const element = itemRefs.current.get(activeId) ?? null;
    scrollWithin(navRef.current, element);
    if (focusActive) element?.focus({ preventScroll: true });
  }, [activeId, activation, focusActive]);

  function clearFilters() {
    setFilterState(NO_FILTERS);
    setQuery("");
  }

  const context: WorkspaceContext = {
    mode,
    setMode,
    active,
    activation,
    activate: (next) => activate(next),
    visible,
    filters: filterState,
    toggleFilter: (group, option) => setFilterState((current) => toggleFilter(current, group, option)),
    setFilter: (group, options) => setFilterState((current) => ({ ...current, [group]: options })),
    clearFilters,
  };

  function onNavigatorKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activate(stepChange(visible, activeId, event.key === "ArrowDown" ? 1 : -1), true);
    }
  }

  const counter = counterText(visible, listed, activeId);
  const atStart = visible.length === 0 || visible[0].id === activeId;
  const atEnd = visible.length === 0 || visible[visible.length - 1].id === activeId;
  const barGroups = filters.filter((group) => group.inBar !== false && group.options.length > 0);
  const chosenCount = Object.values(filterState).reduce((sum, values) => sum + values.length, 0);
  const showAnalyst = Boolean(analyst) && major.length > 0;
  const analystId = `${id}-analyst`;
  const empty = major.length === 0 && !includeMinor;
  const minorWords = `${minorCount} ${minorLabel}${minorCount === 1 ? "" : "s"}`;

  return (
    <section
      ref={sectionRef}
      aria-labelledby={`${id}-headline`}
      className="mt-6 max-w-none! scroll-mt-4 rounded-[var(--radius-panel)] border border-rule bg-paper"
    >
      {/* Comparison header */}
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-rule px-4 py-3">
        <div className="min-w-[min(100%,16rem)] flex-1">
          <p className="text-[0.78rem] font-medium text-added">Comparison complete · {tool}</p>
          <h2 id={`${id}-headline`} className="text-[1.35rem] leading-tight font-semibold">
            {headline}
          </h2>
          {summary.length > 0 && (
            <p className="tabular mt-0.5 text-[0.88rem] text-ink-soft">
              {summary.map((item) => `${item.count} ${item.label}`).join(" · ")}
            </p>
          )}
        </div>
        <dl className="grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-[0.82rem] sm:max-w-[26rem]">
          {facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-ink-soft">{fact.label}</dt>
              <dd className="min-w-0 break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
        {showAnalyst && (
          <a
            href={`#${analystId}`}
            className="self-center rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.85rem] font-medium text-signal hover:bg-signal-soft"
          >
            AI Analysis <span className="font-normal text-ink-soft">· optional</span>
          </a>
        )}
      </header>

      {notes}

      {overview && !empty && (
        <div className="border-b border-rule">
          <button
            type="button"
            aria-expanded={overviewOpen}
            aria-controls={`${id}-overview`}
            onClick={() => setOverviewOpen((open) => !open)}
            className="flex w-full items-center justify-between px-4 py-2 text-left text-[0.85rem] font-medium hover:bg-surface"
          >
            {overviewOpen ? `Hide ${overviewTitle.toLowerCase()}` : `Show ${overviewTitle.toLowerCase()}`}
            <span aria-hidden="true">{overviewOpen ? "▴" : "▾"}</span>
          </button>
          <div id={`${id}-overview`} hidden={!overviewOpen} className="px-4 pb-4">
            {overview(context)}
          </div>
        </div>
      )}

      {empty ? (
        <div className="p-4">
          <p className="font-medium">{headline}</p>
          <div className="mt-1 text-ink-soft">{emptyNote}</div>
          {minorCount > 0 && (
            <p className="mt-2 text-[0.9rem] text-ink-soft">
              {minorWords} {minorCount === 1 ? "was" : "were"} set aside.{" "}
              <button
                type="button"
                onClick={() => setIncludeMinor(true)}
                className="font-medium text-signal underline underline-offset-2"
              >
                Show {minorCount === 1 ? "it" : "them"}
              </button>
            </p>
          )}
          {showMainWhenEmpty && <div className="mt-4">{renderMain(context)}</div>}
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="z-20 border-b border-rule bg-paper/95 backdrop-blur md:sticky md:top-0">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              {modes.length > 1 && (
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
              )}
              <label className="min-w-[9rem] flex-1 sm:max-w-[16rem]">
                <span className="sr-only">Search changes</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search changes"
                  className="w-full rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[0.85rem]"
                />
              </label>
              {(barGroups.length > 0 || minorCount > 0) && (
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls={`${id}-filters`}
                  onClick={() => setFiltersOpen((open) => !open)}
                  className={[
                    "rounded-[3px] border px-2.5 py-1 text-[0.85rem] font-medium",
                    chosenCount > 0 ? "border-signal bg-signal-soft text-signal" : "border-rule-strong bg-paper hover:bg-surface",
                  ].join(" ")}
                >
                  Filters{chosenCount > 0 ? ` · ${chosenCount} on` : ""}
                </button>
              )}
              {filtering && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[0.85rem] font-medium hover:bg-surface"
                >
                  Clear filters
                </button>
              )}
              <p role="status" aria-live="polite" className="tabular ml-auto text-[0.82rem] text-ink-soft">
                {counter}
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => activate(stepChange(visible, activeId, -1))}
                  disabled={atStart}
                  aria-label="Previous change"
                  className="rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[0.85rem] font-medium hover:bg-surface disabled:text-ink-soft/60"
                >
                  <span aria-hidden="true">← </span>Previous
                </button>
                <button
                  type="button"
                  onClick={() => activate(stepChange(visible, activeId, 1))}
                  disabled={atEnd}
                  aria-label="Next change"
                  className="rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[0.85rem] font-medium hover:bg-surface disabled:text-ink-soft/60"
                >
                  Next<span aria-hidden="true"> →</span>
                </button>
              </div>
            </div>

            <div id={`${id}-filters`} hidden={!filtersOpen} className="space-y-2 border-t border-rule px-3 py-2">
              {barGroups.map((group) => (
                <div key={group.id} role="group" aria-label={group.label} className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[0.78rem] font-semibold text-ink-soft" aria-hidden="true">
                    {group.label}
                  </span>
                  {group.options.map((option) => {
                    const on = (filterState[group.id] ?? []).includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => context.toggleFilter(group.id, option.id)}
                        className={[
                          "rounded-full border px-2.5 py-0.5 text-[0.8rem]",
                          on ? "border-signal bg-signal-soft font-medium text-signal" : "border-rule bg-paper hover:border-rule-strong",
                        ].join(" ")}
                      >
                        {option.label} <span className="tabular text-ink-soft">{option.count}</span>
                        <span className="sr-only"> change{option.count === 1 ? "" : "s"}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {minorCount > 0 && (
                <label className="flex items-center gap-2 text-[0.82rem]">
                  <input
                    type="checkbox"
                    checked={includeMinor}
                    onChange={(event) => setIncludeMinor(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Include {minorWords}
                </label>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
            {/* Change navigator */}
            <nav
              ref={navRef}
              aria-label="Differences"
              onKeyDown={onNavigatorKey}
              className="relative max-h-[14rem] overflow-y-auto border-b border-rule md:max-h-[18rem] lg:row-span-2 lg:max-h-[46rem] lg:border-r lg:border-b-0 xl:row-span-1"
            >
              <p className="sticky top-0 z-10 flex items-baseline justify-between border-b border-rule bg-surface px-3 py-1.5 text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase">
                Changes
                <span className="tabular font-medium normal-case">
                  {visible.length === listed ? `All ${listed}` : `${visible.length} of ${listed}`}
                  {minorCount > 0 && !includeMinor && ` · ${minorCount} minor set aside`}
                </span>
              </p>
              {visible.length === 0 ? (
                <div className="px-3 py-3 text-[0.85rem] text-ink-soft">
                  <p>No change matches this search or filter.</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-1 font-medium text-signal underline underline-offset-2"
                  >
                    Show all changes
                  </button>
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group.key}>
                    <p className="px-3 pt-2.5 pb-1 text-[0.78rem] font-semibold break-words text-ink">{group.label}</p>
                    <ul>
                      {group.changes.map((change) => (
                        <li key={change.id}>
                          <NavigatorEntry
                            change={change}
                            current={change.id === activeId}
                            onChoose={() => activate(change.id)}
                            refCallback={(element) => {
                              if (element) itemRefs.current.set(change.id, element);
                              else itemRefs.current.delete(change.id);
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </nav>

            {/* The two versions */}
            <div
              id={`${id}-panel`}
              role={modes.length > 1 ? "tabpanel" : undefined}
              aria-labelledby={modes.length > 1 ? `${id}-tab-${mode}` : undefined}
              className="min-w-0 lg:col-start-2 lg:row-start-1"
            >
              {renderMain(context)}
            </div>

            {/* Evidence for the active change */}
            <EvidencePanel
              active={active}
              position={active ? visible.findIndex((change) => change.id === active.id) : -1}
              shown={visible.length}
              analysis={analysis}
              analystHref={showAnalyst ? `#${analystId}` : null}
            >
              {renderEvidence?.(context)}
            </EvidencePanel>
          </div>
        </>
      )}

      {footer && <p className="border-t border-rule px-4 py-2.5 text-[0.78rem] text-ink-soft">{footer}</p>}

      {showAnalyst && (
        <div id={analystId} tabIndex={-1} className="scroll-mt-4 border-t border-rule bg-surface p-3 md:p-4">
          {analyst}
        </div>
      )}
    </section>
  );
}

function NavigatorEntry({
  change,
  current,
  onChoose,
  refCallback,
}: {
  change: WorkspaceChange;
  current: boolean;
  onChoose: () => void;
  refCallback: (element: HTMLButtonElement | null) => void;
}) {
  const hasValues = Boolean(change.before || change.after);
  return (
    <button
      type="button"
      ref={refCallback}
      aria-current={current ? "true" : undefined}
      aria-label={change.description}
      onClick={onChoose}
      className={[
        "block w-full border-l-[3px] px-3 py-1.5 text-left text-[0.84rem]",
        current ? "border-signal bg-signal-soft" : "border-transparent hover:bg-surface",
      ].join(" ")}
    >
      <span className="flex items-baseline gap-2">
        <span className="tabular text-[0.75rem] text-ink-soft">#{change.number}</span>
        <span className="min-w-0 font-semibold">
          <span aria-hidden="true" className={`${TONE[change.kind]} mr-1`}>
            {EDIT_MARK[change.kind]}
          </span>
          {change.title}
        </span>
        {change.category && (
          <span className="ml-auto shrink-0 rounded-[2px] bg-ink/5 px-1 text-[0.72rem] text-ink-soft">
            {change.category}
          </span>
        )}
      </span>
      <span className="mt-0.5 block truncate text-[0.78rem] text-ink-soft">
        {change.place}
        {change.minor && " · minor"}
      </span>
      {hasValues ? (
        <span className="mt-0.5 block truncate text-[0.8rem] text-ink-soft">
          {change.before && <span className="line-through decoration-removed/50">{change.before}</span>}
          {change.before && change.after && <span aria-hidden="true"> → </span>}
          {change.after && <span className="text-ink">{change.after}</span>}
        </span>
      ) : (
        change.context && <span className="mt-0.5 block truncate text-[0.8rem] text-ink-soft">“{change.context}”</span>
      )}
      <span className="sr-only">{EDIT_WORD[change.kind]}</span>
    </button>
  );
}

/**
 * The evidence for the active change, then — only if the person asked for it —
 * the AI's explanation, in a separate section that says what it is.
 */
function EvidencePanel({
  active,
  position,
  shown,
  analysis,
  analystHref,
  children,
}: {
  active: WorkspaceChange | null;
  position: number;
  shown: number;
  analysis: ChangeAnalysis | null;
  analystHref: string | null;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-label="Evidence"
      tabIndex={0}
      className="min-w-0 border-t border-rule p-3 lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1 xl:max-h-[46rem] xl:overflow-y-auto xl:border-t-0 xl:border-l"
    >
      {!active ? (
        <>
          <h3 id={headingId} className="text-[0.95rem] font-semibold">
            Evidence
          </h3>
          <p className="mt-1 text-[0.85rem] text-ink-soft">Choose a change to see what proves it.</p>
        </>
      ) : (
        <>
          <p className="tabular text-[0.75rem] text-ink-soft">
            {position >= 0 ? `Change ${position + 1} of ${shown}` : `Change #${active.number} (not in the current filter)`}
          </p>
          <h3 id={headingId} className="text-[1rem] leading-snug font-semibold">
            <span aria-hidden="true" className={`${TONE[active.kind]} mr-1`}>
              {EDIT_MARK[active.kind]}
            </span>
            {active.title}
          </h3>
          <p className="text-[0.85rem] break-words">
            {active.place}
            {active.category && <span className="text-ink-soft"> · {active.category}</span>}
          </p>
          {active.placeNote && <p className="mt-0.5 text-[0.75rem] text-ink-soft">{active.placeNote}</p>}

          <div className="mt-3 rounded-[3px] border border-rule">
            <h4 className="border-b border-rule bg-surface px-2.5 py-1 text-[0.72rem] font-semibold tracking-wide text-ink-soft uppercase">
              Comparison evidence
            </h4>
            <div className="p-2.5">{children}</div>
            <p className="border-t border-rule px-2.5 py-1 text-[0.72rem] text-ink-soft">
              Detected by DiffNexa&apos;s comparison and read directly from both versions. No AI was used.
            </p>
          </div>

          <AIExplanation changeId={active.id} analysis={analysis} analystHref={analystHref} />
        </>
      )}
    </section>
  );
}

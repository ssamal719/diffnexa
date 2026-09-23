"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** A request, from outside a report, to show one change. A new token means "again". */
export type FocusRequest = { id: string; token: number } | null;

/**
 * Lets something outside a report (AI Change Analyst's "View change") take the
 * reader to one change, using the report's own navigation.
 *
 * `locate` gives the index of the card that shows a change (-1 when filtered
 * out). When the change is hidden by the report's filters, `reveal` clears them. The
 * change's card is then focused and scrolled into view, which also makes it the
 * report's current change (each card does that when it receives focus), so
 * Previous/Next carry on from there.
 */
export function useChangeFocus(
  focus: FocusRequest,
  locate: (id: string) => number,
  reveal: () => void,
  cards: RefObject<(HTMLElement | null)[]>,
) {
  const [handled, setHandled] = useState<number | null>(null);
  const [target, setTarget] = useState<FocusRequest>(null);

  // Worked out while rendering, so a filter cleared here is gone before the effect runs.
  if (focus && handled !== focus.token) {
    setHandled(focus.token);
    setTarget(focus);
    if (locate(focus.id) < 0) reveal();
  }

  const index = target ? locate(target.id) : -1;
  const done = useRef<number | null>(null);
  useEffect(() => {
    if (!target || index < 0 || done.current === target.token) return;
    done.current = target.token;
    const card = cards.current?.[index];
    card?.focus();
    card?.scrollIntoView?.({ block: "center" });
  }, [target, index, cards]);
}

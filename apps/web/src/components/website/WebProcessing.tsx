"use client";

import { useEffect, useState } from "react";

/**
 * What the tool is doing while it works.
 *
 * The steps are real application state, not a timed animation, and there is no
 * percentage anywhere: reading a page is one request whose progress the browser
 * cannot measure. Saying "60%" would be a guess dressed up as information, so
 * the interface shows the step it is on and how long it has been working.
 */
export type WebStage = "validating" | "fetching" | "reading" | "comparing" | "preparing";

const CAPTURE_STAGES: { id: WebStage; label: string }[] = [
  { id: "validating", label: "Checking the address" },
  { id: "fetching", label: "Fetching the page" },
  { id: "reading", label: "Reading its content" },
  { id: "preparing", label: "Preparing your baseline" },
];

const COMPARE_STAGES: { id: WebStage; label: string }[] = [
  { id: "validating", label: "Checking the address" },
  { id: "fetching", label: "Fetching the page" },
  { id: "reading", label: "Reading its content" },
  { id: "comparing", label: "Comparing with your baseline" },
  { id: "preparing", label: "Preparing your report" },
];

export function WebProcessing({ stage, mode }: { stage: WebStage; mode: "capture" | "compare" }) {
  const [seconds, setSeconds] = useState(0);
  const stages = mode === "capture" ? CAPTURE_STAGES : COMPARE_STAGES;
  const activeIndex = stages.findIndex((item) => item.id === stage);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section
      aria-live="polite"
      aria-busy="true"
      className="mt-6 rounded-[var(--radius-panel)] border border-rule bg-paper p-4 md:p-5"
    >
      <h2 className="text-[1.05rem] font-semibold">
        {mode === "capture" ? "Capturing this page" : "Checking this page"}
      </h2>
      <ol className="mt-3 space-y-2">
        {stages.map((item, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li key={item.id} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={[
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-semibold",
                  done
                    ? "border-added bg-added text-white"
                    : active
                      ? "border-signal text-signal"
                      : "border-rule text-rule-strong",
                ].join(" ")}
              >
                {done ? "✓" : index + 1}
              </span>
              <span
                className={
                  active ? "font-medium text-ink" : done ? "text-ink-soft" : "text-rule-strong"
                }
              >
                {item.label}
                {done && <span className="sr-only"> — finished</span>}
                {active && <span className="sr-only"> — in progress</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {seconds >= 5 && (
        <p className="tabular mt-3 border-t border-rule pt-2 text-[0.82rem] text-ink-soft">
          Working for {seconds} seconds. Some pages are slow to respond.
        </p>
      )}
    </section>
  );
}

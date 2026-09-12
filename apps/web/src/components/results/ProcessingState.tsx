"use client";

import { useEffect, useState } from "react";

/**
 * What the application is actually doing, while it does it.
 *
 * The stages here are real application state, not a timed animation. Only the
 * first stage has a percentage, because uploading is the only step whose
 * progress the browser can genuinely measure. The rest show elapsed time
 * instead of a fabricated bar: a comparison that takes 40 seconds should look
 * like it is working, not like it is 80% done.
 */
export type ProcessingStage = "sending" | "comparing" | "preparing";

const STAGES: { id: ProcessingStage; label: string; detail: string }[] = [
  { id: "sending", label: "Sending your documents", detail: "Transferring both files securely" },
  { id: "comparing", label: "Reading and comparing", detail: "Extracting text, then matching pages and wording" },
  { id: "preparing", label: "Preparing your report", detail: "Organising the changes and their evidence" },
];

export function ProcessingState({
  stage,
  uploadPercent,
}: {
  stage: ProcessingStage;
  uploadPercent: number | null;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeIndex = STAGES.findIndex((item) => item.id === stage);

  return (
    <section
      aria-live="polite"
      aria-busy="true"
      className="mt-6 rounded-[var(--radius-panel)] border border-rule bg-paper p-4 md:p-5"
    >
      <h2 className="text-[1.1rem] font-semibold">Comparing your documents</h2>
      <p className="mt-1 text-[0.9rem] text-ink-soft">
        This usually takes a few seconds. Longer documents take longer to read.
      </p>

      <ol className="mt-4 space-y-3">
        {STAGES.map((item, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li key={item.id} className="flex gap-3">
              <span
                aria-hidden="true"
                className={[
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-semibold",
                  done
                    ? "border-added bg-added text-white"
                    : active
                      ? "border-signal text-signal"
                      : "border-rule text-rule-strong",
                ].join(" ")}
              >
                {done ? "✓" : index + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={[
                    "text-[0.95rem]",
                    active ? "font-medium text-ink" : done ? "text-ink-soft" : "text-rule-strong",
                  ].join(" ")}
                >
                  {item.label}
                  {done && <span className="sr-only"> — finished</span>}
                </p>
                {active && (
                  <>
                    <p className="text-[0.85rem] text-ink-soft">{item.detail}</p>
                    {item.id === "sending" && uploadPercent !== null && (
                      <div className="mt-1.5 max-w-xs">
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className="h-full bg-signal transition-[width] duration-200"
                            style={{ width: `${uploadPercent}%` }}
                          />
                        </div>
                        <p className="tabular mt-1 text-[0.78rem] text-ink-soft">
                          {uploadPercent}% transferred
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {seconds >= 5 && (
        <p className="tabular mt-4 border-t border-rule pt-3 text-[0.82rem] text-ink-soft">
          Working for {seconds} seconds. Still going — you don&apos;t need to refresh.
        </p>
      )}
    </section>
  );
}

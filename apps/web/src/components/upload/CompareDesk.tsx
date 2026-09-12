"use client";

import { useEffect, useState } from "react";

import { ResultsPanel } from "@/components/results/ResultsPanel";
import { UploadSlot, type SlotFile } from "@/components/upload/UploadSlot";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { ComparisonError, ComparisonResponse } from "@/lib/comparison";
import { DEFAULT_LIMITS } from "@/lib/validation";

type EngineStatus = { checked: boolean; available: boolean };

type Phase =
  | { name: "idle" }
  | { name: "comparing" }
  | { name: "done"; result: ComparisonResponse }
  | { name: "failed"; error: ComparisonError };

/**
 * The tool is the page's main content, so it sits directly under the heading.
 *
 * "Compare PDFs" is enabled only when both files are valid and the comparison
 * engine is actually reachable. A button that looked ready but could not work
 * would be worse than an honest one that explains itself.
 */
export function CompareDesk() {
  const [previous, setPrevious] = useState<SlotFile | null>(null);
  const [revised, setRevised] = useState<SlotFile | null>(null);
  const [engine, setEngine] = useState<EngineStatus>({ checked: false, available: false });
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/engine-status")
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled) setEngine({ checked: true, available: Boolean(body.available) });
      })
      .catch(() => {
        if (!cancelled) setEngine({ checked: true, available: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bothReady = previous !== null && revised !== null;
  const canCompare = bothReady && engine.available && phase.name !== "comparing";
  const sameFile =
    bothReady &&
    previous.sizeBytes === revised.sizeBytes &&
    previous.displayName === revised.displayName;

  async function runComparison() {
    if (!previous || !revised) return;
    setPhase({ name: "comparing" });

    const form = new FormData();
    form.append("previous", previous.file, "previous.pdf");
    form.append("revised", revised.file, "revised.pdf");

    try {
      const response = await fetch("/api/compare", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) {
        setPhase({
          name: "failed",
          error: body?.error ?? {
            code: "comparison_failed",
            message: "The comparison could not be completed. Please try again.",
          },
        });
        return;
      }
      setPhase({ name: "done", result: body as ComparisonResponse });
    } catch {
      setPhase({
        name: "failed",
        error: {
          code: "network",
          message: "The comparison could not be reached. Check your connection and try again.",
        },
      });
    }
  }

  function replaceFile(setter: (value: SlotFile | null) => void) {
    return (value: SlotFile | null) => {
      setter(value);
      setPhase({ name: "idle" }); // old results never linger beside new files
    };
  }

  return (
    <>
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <div className="grid gap-px bg-rule md:grid-cols-2">
          <div className="bg-paper p-4 md:p-5">
            <UploadSlot
              label="Previous version"
              hint="The original"
              limits={DEFAULT_LIMITS}
              value={previous}
              onChange={replaceFile(setPrevious)}
            />
          </div>
          <div className="bg-paper p-4 md:p-5">
            <UploadSlot
              label="New version"
              hint="The revision"
              limits={DEFAULT_LIMITS}
              value={revised}
              onChange={replaceFile(setRevised)}
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-rule p-4 md:p-5">
          {sameFile && (
            <Alert tone="note" title="These look like the same file">
              Both slots hold a file with the same name and size. Comparing a document with itself
              will find no changes.
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canCompare} onClick={runComparison} aria-describedby="compare-state">
              {phase.name === "comparing" ? "Comparing…" : "Compare PDFs"}
            </Button>
            <p
              id="compare-state"
              role="status"
              aria-live="polite"
              className="text-[0.85rem] text-ink-soft"
            >
              {stateMessage({ bothReady, engine, phase })}
            </p>
          </div>

          {phase.name === "failed" && (
            <Alert tone="problem" title="Comparison failed" role="alert">
              {phase.error.message}
              {phase.error.side && (
                <> This is about the {phase.error.side === "previous" ? "previous" : "new"} PDF.</>
              )}
            </Alert>
          )}

          {engine.checked && !engine.available && (
            <Alert tone="planned" title="Comparison engine not running">
              The engine runs as a separate program and is not reachable right now. Start it with{" "}
              <code>diffnexa serve</code> in a terminal, then reload this page. Hosting it online so
              no setup is needed is a later stage.
            </Alert>
          )}

          <p className="text-[0.8rem] text-ink-soft">
            Your PDFs are sent to the comparison engine, compared in memory, and discarded when the
            result comes back. Nothing is stored and nothing is sent to any AI service.
          </p>
        </div>
      </div>

      {phase.name === "done" && <ResultsPanel result={phase.result} />}
    </>
  );
}

function stateMessage({
  bothReady,
  engine,
  phase,
}: {
  bothReady: boolean;
  engine: EngineStatus;
  phase: Phase;
}): string {
  if (phase.name === "comparing") return "Reading both documents and comparing them…";
  if (!bothReady) return "Choose both files to continue.";
  if (!engine.checked) return "Checking whether the comparison engine is running…";
  if (!engine.available) return "The comparison engine is not running.";
  if (phase.name === "done") return "Comparison finished. Results are below.";
  return "Both files are ready.";
}

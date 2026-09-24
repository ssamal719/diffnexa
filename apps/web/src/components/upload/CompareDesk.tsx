"use client";

import { useEffect, useRef, useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { ComparisonError } from "@/components/results/ComparisonError";
import { ComparisonReport } from "@/components/results/ComparisonReport";
import { ProcessingState, type ProcessingStage } from "@/components/results/ProcessingState";
import { UploadSlot, type SlotFile } from "@/components/upload/UploadSlot";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type {
  ComparisonError as ComparisonErrorPayload,
  ComparisonResponse,
} from "@/lib/comparison";
import { DEFAULT_LIMITS } from "@/lib/validation";
import { SEAL_HEADER } from "@/lib/analysis";

type EngineStatus = { checked: boolean; available: boolean };

type Phase =
  | { name: "idle" }
  | { name: "working"; stage: ProcessingStage; uploadPercent: number | null }
  | { name: "done"; result: ComparisonResponse; seal: string | null }
  | { name: "failed"; error: ComparisonErrorPayload };

/**
 * The upload step and everything that follows it.
 *
 * "Compare documents" is enabled only when both files are readable and the
 * comparison service is reachable, so the button never promises something it
 * cannot do.
 */
export function CompareDesk() {
  const [previous, setPrevious] = useState<SlotFile | null>(null);
  const [revised, setRevised] = useState<SlotFile | null>(null);
  const [engine, setEngine] = useState<EngineStatus>({ checked: false, available: false });
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const requestRef = useRef<XMLHttpRequest | null>(null);

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
      requestRef.current?.abort();
    };
  }, []);

  const bothReady = previous !== null && revised !== null;
  const working = phase.name === "working";
  const canCompare = bothReady && engine.available && !working;
  const sameFile =
    bothReady &&
    previous.sizeBytes === revised.sizeBytes &&
    previous.displayName === revised.displayName;

  function runComparison() {
    if (!previous || !revised) return;

    const form = new FormData();
    form.append("previous", previous.file, "previous.pdf");
    form.append("revised", revised.file, "revised.pdf");

    // XMLHttpRequest rather than fetch, because it reports real upload progress.
    // Nothing here estimates: the percentage shown is bytes actually sent.
    const request = new XMLHttpRequest();
    requestRef.current = request;
    setPhase({ name: "working", stage: "sending", uploadPercent: 0 });

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setPhase({
        name: "working",
        stage: percent >= 100 ? "comparing" : "sending",
        uploadPercent: percent,
      });
    });

    request.upload.addEventListener("load", () => {
      setPhase({ name: "working", stage: "comparing", uploadPercent: 100 });
    });

    request.addEventListener("load", () => {
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = null;
      }

      if (request.status >= 200 && request.status < 300 && body) {
        setPhase({ name: "working", stage: "preparing", uploadPercent: 100 });
        // Give the browser a frame to paint the final stage before the report
        // replaces it, so the last step is seen rather than skipped.
        // The seal lets this result be sent for AI analysis later, if the person asks.
        const seal = request.getResponseHeader?.(SEAL_HEADER) ?? null;
        requestAnimationFrame(() => setPhase({ name: "done", result: body as ComparisonResponse, seal }));
        return;
      }

      const error = (body as { error?: ComparisonErrorPayload } | null)?.error;
      setPhase({
        name: "failed",
        error: error ?? {
          code: "comparison_failed",
          message: "The comparison could not be completed.",
        },
      });
    });

    request.addEventListener("error", () => {
      setPhase({
        name: "failed",
        error: {
          code: "network",
          message: "The connection dropped before the comparison finished.",
        },
      });
    });

    request.addEventListener("abort", () => setPhase({ name: "idle" }));

    request.open("POST", "/api/compare");
    request.send(form);
  }

  function replaceFile(setter: (value: SlotFile | null) => void) {
    return (value: SlotFile | null) => {
      setter(value);
      requestRef.current?.abort();
      setPhase({ name: "idle" }); // results never linger beside different files
    };
  }

  return (
    <>
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <div className="grid gap-px bg-rule md:grid-cols-2">
          <div className="bg-paper p-4 md:p-5">
            <UploadSlot
              label="Previous version"
              hint="Step 1 · the original"
              limits={DEFAULT_LIMITS}
              value={previous}
              onChange={replaceFile(setPrevious)}
            />
          </div>
          <div className="bg-paper p-4 md:p-5">
            <UploadSlot
              label="New version"
              hint="Step 2 · the revision"
              limits={DEFAULT_LIMITS}
              value={revised}
              onChange={replaceFile(setRevised)}
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-rule p-4 md:p-5">
          {sameFile && (
            <Alert tone="note" title="These look like the same document">
              Both slots hold a file with the same name and size. Comparing a document with itself
              will find no changes.
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canCompare} onClick={runComparison} aria-describedby="compare-state">
              {working ? "Comparing…" : "Compare documents"}
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

          {engine.checked && !engine.available && (
            <Alert tone="planned" title="Comparison service not reachable">
              The service that compares documents isn&apos;t responding right now, so comparison is
              unavailable. Your documents are fine.
            </Alert>
          )}

          <p className="text-[0.8rem] text-ink-soft">
            Your documents are sent to the comparison service, used only for this comparison, and discarded
            when the result comes back. Nothing is stored and the comparison sends nothing to any AI service.
          </p>
        </div>
      </div>

      {phase.name === "working" && (
        <ProcessingState stage={phase.stage} uploadPercent={phase.uploadPercent} />
      )}
      {phase.name === "failed" && <ComparisonError error={phase.error} onRetry={runComparison} />}
      {phase.name === "done" && (
        <ReportWithAnalyst tool="pdf" result={phase.result} seal={phase.seal}>
          {({ analyst, focus, analysis }) => (
            <ComparisonReport
              result={phase.result}
              files={{ original: previous?.file ?? null, revised: revised?.file ?? null }}
              names={{ original: previous?.displayName ?? "Previous version", revised: revised?.displayName ?? "New version" }}
              analyst={analyst}
              analysis={analysis}
              focus={focus}
            />
          )}
        </ReportWithAnalyst>
      )}
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
  if (phase.name === "working") return "Working on it — progress is shown below.";
  if (!bothReady) return "Add both documents to continue.";
  if (!engine.checked) return "Checking the comparison service…";
  if (!engine.available) return "The comparison service is unavailable.";
  if (phase.name === "done") return "Your report is ready below.";
  return "Both documents are ready.";
}

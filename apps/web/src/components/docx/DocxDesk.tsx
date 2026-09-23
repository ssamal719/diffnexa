"use client";

import { useEffect, useRef, useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { DocxReport } from "@/components/docx/DocxReport";
import { DocxUploadSlot, type DocxSlotFile } from "@/components/docx/DocxUploadSlot";
import { ProcessingState, type ProcessingStage, type StageText } from "@/components/results/ProcessingState";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { DocxComparison, DocxFailure } from "@/lib/docx-report";
import { docxErrorMessage } from "@/lib/validation";
import { SEAL_HEADER } from "@/lib/analysis";

type EngineStatus = { checked: boolean; available: boolean };

type Phase =
  | { name: "idle" }
  | { name: "working"; stage: ProcessingStage; uploadPercent: number | null }
  | { name: "done"; result: DocxComparison; original: DocxSlotFile; revised: DocxSlotFile; seal: string | null }
  | { name: "failed"; error: DocxFailure };

const STAGES: StageText[] = [
  { id: "sending", label: "Sending your documents", detail: "Transferring both files securely" },
  {
    id: "comparing",
    label: "Reading and comparing",
    detail: "Reading paragraphs, headings, lists and tables, then matching them",
  },
  { id: "preparing", label: "Preparing your report", detail: "Organising the changes and their evidence" },
];

/**
 * Choosing the two Word documents, and everything that follows.
 *
 * "Compare documents" is enabled only when both files have passed the first
 * check and the comparison service is reachable, so the button never promises
 * something it cannot do.
 */
export function DocxDesk() {
  const [original, setOriginal] = useState<DocxSlotFile | null>(null);
  const [revised, setRevised] = useState<DocxSlotFile | null>(null);
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

  const bothReady = original !== null && revised !== null;
  const working = phase.name === "working";
  const canCompare = bothReady && engine.available && !working;
  const sameFile =
    bothReady && original.sizeBytes === revised.sizeBytes && original.displayName === revised.displayName;

  function runComparison() {
    if (!original || !revised) return;
    const files = { original, revised };

    const form = new FormData();
    form.append("original", original.file, "original.docx");
    form.append("revised", revised.file, "revised.docx");

    // XMLHttpRequest rather than fetch, because it reports real upload progress.
    const request = new XMLHttpRequest();
    requestRef.current = request;
    setPhase({ name: "working", stage: "sending", uploadPercent: 0 });

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setPhase({ name: "working", stage: percent >= 100 ? "comparing" : "sending", uploadPercent: percent });
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
        const seal = request.getResponseHeader?.(SEAL_HEADER) ?? null;
        requestAnimationFrame(() =>
          setPhase({ name: "done", result: body as DocxComparison, ...files, seal }),
        );
        return;
      }
      const error = (body as { error?: DocxFailure } | null)?.error;
      setPhase({
        name: "failed",
        error: error ?? { code: "comparison_failed", message: "The comparison could not be completed." },
      });
    });

    request.addEventListener("error", () => {
      setPhase({
        name: "failed",
        error: { code: "network", message: "The connection dropped before the comparison finished." },
      });
    });
    request.addEventListener("abort", () => setPhase({ name: "idle" }));

    request.open("POST", "/api/docx/compare");
    request.send(form);
  }

  function replaceFile(setter: (value: DocxSlotFile | null) => void) {
    return (value: DocxSlotFile | null) => {
      setter(value);
      requestRef.current?.abort();
      setPhase({ name: "idle" }); // a result never lingers beside different files
    };
  }

  return (
    <>
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <div className="grid gap-px bg-rule md:grid-cols-2">
          <div className="bg-paper p-4 md:p-5">
            <DocxUploadSlot
              label="Original document"
              hint="Choose the earlier DOCX"
              value={original}
              onChange={replaceFile(setOriginal)}
            />
          </div>
          <div className="bg-paper p-4 md:p-5">
            <DocxUploadSlot
              label="Revised document"
              hint="Choose the newer DOCX"
              value={revised}
              onChange={replaceFile(setRevised)}
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-rule p-4 md:p-5">
          {sameFile && (
            <Alert tone="note" title="These look like the same document">
              Both slots hold a file with the same name and size. Comparing a document with itself will
              find no changes.
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canCompare} onClick={runComparison} aria-describedby="docx-compare-state">
              {working ? "Comparing…" : "Compare documents"}
            </Button>
            <p id="docx-compare-state" role="status" aria-live="polite" className="text-[0.85rem] text-ink-soft">
              {stateMessage({ bothReady, engine, phase })}
            </p>
          </div>

          {engine.checked && !engine.available && (
            <Alert tone="planned" title="Comparison service not reachable">
              The service that compares documents isn&apos;t responding right now, so comparison is
              unavailable. Your documents are fine.
            </Alert>
          )}

          <ul className="list-disc space-y-1 pl-5 text-[0.8rem] text-ink-soft">
            <li>Word .docx files only. Older .doc files and macro-enabled .docm files are not accepted.</li>
            <li>
              Your files are processed for this comparison only and are not stored as account history.
              The comparison sends nothing to any AI service.
            </li>
            <li>
              Text and structure are compared. Visual formatting and images are not compared in this
              version.
            </li>
          </ul>
        </div>
      </div>

      {phase.name === "working" && (
        <ProcessingState stage={phase.stage} uploadPercent={phase.uploadPercent} stages={STAGES} />
      )}
      {phase.name === "failed" && <DocxError error={phase.error} onRetry={runComparison} />}
      {phase.name === "done" && (
        <ReportWithAnalyst tool="docx" result={phase.result} seal={phase.seal}>
          {({ analyst, focus }) => (
            <DocxReport
              result={phase.result}
              original={{ name: phase.original.displayName, sizeBytes: phase.original.sizeBytes }}
              revised={{ name: phase.revised.displayName, sizeBytes: phase.revised.sizeBytes }}
              analyst={analyst}
              focus={focus}
            />
          )}
        </ReportWithAnalyst>
      )}
    </>
  );
}

const SERVICE_PROBLEMS: Record<string, { title: string; whatNext: string }> = {
  engine_unavailable: {
    title: "The comparison service isn't reachable",
    whatNext: "Nothing is wrong with your documents. Try again in a moment.",
  },
  timeout: {
    title: "The comparison took too long",
    whatNext: "Your documents are fine, but they took longer than expected. Try again, or compare shorter documents.",
  },
  network: {
    title: "The connection dropped",
    whatNext: "Check your internet connection and try again. Your documents were not changed.",
  },
  too_many_requests: {
    title: "Too many comparisons in a short time",
    whatNext: "Please wait a minute, then try again.",
  },
};

/**
 * What went wrong, which document it is about, and what to do next.
 *
 * A document is only blamed when the service examined that document and found
 * the problem in it; a service or connection failure says so instead.
 */
function DocxError({ error, onRetry }: { error: DocxFailure; onRetry: () => void }) {
  const documentMessage = docxErrorMessage(error.code);
  const side = error.side === "original" ? "original" : error.side === "revised" ? "revised" : null;
  const service = SERVICE_PROBLEMS[error.code];
  const title = documentMessage ? "This document can't be compared" : (service?.title ?? "The comparison couldn't be completed");
  const detail = documentMessage ?? service?.whatNext ?? "Please try again.";

  return (
    <section role="alert" className="mt-6 rounded-[var(--radius-panel)] border border-removed/40 bg-[#fdf0f0] p-4 md:p-5">
      <h2 className="text-[1.05rem] font-semibold text-removed">{title}</h2>
      {side && <p className="mt-1 text-[0.9rem] font-medium">This is about your {side} document.</p>}
      <p className="mt-2 max-w-prose">{detail}</p>
      <div className="mt-3">
        {side ? (
          <p className="text-[0.85rem] text-ink-soft">
            Use “Replace file” above to choose a different {side} document.
          </p>
        ) : (
          <Button onClick={onRetry} className="px-3 py-1.5 text-[0.9rem]">
            Try again
          </Button>
        )}
      </div>
    </section>
  );
}

function stateMessage({ bothReady, engine, phase }: { bothReady: boolean; engine: EngineStatus; phase: Phase }): string {
  if (phase.name === "working") return "Working on it — progress is shown below.";
  if (!bothReady) return "Add both documents to continue.";
  if (!engine.checked) return "Checking the comparison service…";
  if (!engine.available) return "The comparison service is unavailable.";
  if (phase.name === "done") return "Your report is ready below.";
  return "Both documents are ready.";
}

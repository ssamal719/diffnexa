"use client";

import { useEffect, useRef, useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { ExcelWorkspace } from "@/components/excel/ExcelWorkspace";
import { ProcessingState, type ProcessingStage, type StageText } from "@/components/results/ProcessingState";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { OfficeFileSlot, type FileCheck, type SlotFile } from "@/components/upload/OfficeFileSlot";
import type { ExcelComparison, ExcelFailure } from "@/lib/excel-report";
import { EXCEL_ERROR_MESSAGES, EXCEL_MAX_FILE_BYTES, checkXlsxBytes, excelErrorMessage, formatFileSize } from "@/lib/validation";
import { SEAL_HEADER } from "@/lib/analysis";

type EngineStatus = { checked: boolean; available: boolean };

type Phase =
  | { name: "idle" }
  | { name: "working"; stage: ProcessingStage; uploadPercent: number | null }
  | { name: "done"; result: ExcelComparison; original: SlotFile; revised: SlotFile; seal: string | null }
  | { name: "failed"; error: ExcelFailure };

const STAGES: StageText[] = [
  { id: "sending", label: "Sending your workbooks", detail: "Transferring both files securely" },
  { id: "comparing", label: "Reading and comparing", detail: "Reading every sheet, then matching rows, columns and cells" },
  { id: "preparing", label: "Preparing the comparison", detail: "Laying out both workbooks and every change" },
];

/** The first look at a workbook: its size and its first bytes, as the engine will check them. */
async function checkWorkbook(file: File): Promise<FileCheck> {
  if (file.size === 0 || file.size > EXCEL_MAX_FILE_BYTES) {
    const verdict = checkXlsxBytes(new Uint8Array(0), file.size);
    return verdict.ok ? verdict : { ok: false, message: EXCEL_ERROR_MESSAGES[verdict.code] };
  }
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  // Only an older Excel container needs reading in full, to tell an .xls from a
  // password-protected .xlsx.
  const bytes = head[0] === 0xd0 && head[1] === 0xcf ? new Uint8Array(await file.arrayBuffer()) : head;
  const verdict = checkXlsxBytes(bytes, file.size);
  return verdict.ok ? verdict : { ok: false, message: EXCEL_ERROR_MESSAGES[verdict.code] };
}

/**
 * Choosing the two workbooks, and everything that follows.
 *
 * "Compare workbooks" is enabled only when both files have passed the first
 * check and the comparison service is reachable, so the button never promises
 * something it cannot do.
 */
export function ExcelDesk() {
  const [original, setOriginal] = useState<SlotFile | null>(null);
  const [revised, setRevised] = useState<SlotFile | null>(null);
  const [engine, setEngine] = useState<EngineStatus>({ checked: false, available: false });
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (phase.name === "done") resultRef.current?.scrollIntoView?.({ block: "start" });
  }, [phase.name]);

  const bothReady = original !== null && revised !== null;
  const working = phase.name === "working";
  const canCompare = bothReady && engine.available && !working;
  const sameFile =
    bothReady && original.sizeBytes === revised.sizeBytes && original.displayName === revised.displayName;

  function runComparison() {
    if (!original || !revised) return;
    const files = { original, revised };
    const form = new FormData();
    form.append("original", original.file, "original.xlsx");
    form.append("revised", revised.file, "revised.xlsx");

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
        requestAnimationFrame(() => setPhase({ name: "done", result: body as ExcelComparison, ...files, seal }));
        return;
      }
      const error = (body as { error?: ExcelFailure } | null)?.error;
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
    request.open("POST", "/api/excel/compare");
    request.send(form);
  }

  function replaceFile(setter: (value: SlotFile | null) => void) {
    return (value: SlotFile | null) => {
      setter(value);
      requestRef.current?.abort();
      setPhase({ name: "idle" }); // a result never lingers beside different files
    };
  }

  const slotProps = {
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dropText: "Drag a .xlsx file here, or",
    formatNote: `Excel .xlsx only, up to ${formatFileSize(EXCEL_MAX_FILE_BYTES)}`,
    kindNote: "Excel workbook",
    check: checkWorkbook,
  };

  return (
    <>
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <div className="grid gap-px bg-rule md:grid-cols-2">
          <div className="bg-paper p-4 md:p-5">
            <OfficeFileSlot
              label="Original workbook"
              hint="Choose the earlier .xlsx"
              value={original}
              onChange={replaceFile(setOriginal)}
              {...slotProps}
            />
          </div>
          <div className="bg-paper p-4 md:p-5">
            <OfficeFileSlot
              label="Revised workbook"
              hint="Choose the newer .xlsx"
              value={revised}
              onChange={replaceFile(setRevised)}
              {...slotProps}
            />
          </div>
        </div>
        <div className="space-y-3 border-t border-rule p-4 md:p-5">
          {sameFile && (
            <Alert tone="note" title="These look like the same workbook">
              Both slots hold a file with the same name and size. Comparing a workbook with itself will find no
              changes.
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canCompare} onClick={runComparison} aria-describedby="excel-compare-state">
              {working ? "Comparing…" : "Compare workbooks"}
            </Button>
            <p id="excel-compare-state" role="status" aria-live="polite" className="text-[0.85rem] text-ink-soft">
              {stateMessage({ bothReady, engine, phase })}
            </p>
          </div>
          {engine.checked && !engine.available && (
            <Alert tone="planned" title="Comparison service not reachable">
              The service that compares workbooks isn&apos;t responding right now, so comparison is unavailable. Your
              workbooks are fine.
            </Alert>
          )}
          <ul className="list-disc space-y-1 pl-5 text-[0.8rem] text-ink-soft">
            <li>Excel .xlsx files only. Older .xls, macro-enabled .xlsm and binary .xlsb files are not accepted.</li>
            <li>
              Your files are read for this comparison only and are not stored. No formula is calculated, no macro is
              run and the comparison sends nothing to any AI service.
            </li>
            <li>Values, formulas, rows, columns, sheets and links are compared. Formatting and charts are not.</li>
          </ul>
        </div>
      </div>

      <div>
        {phase.name === "working" && (
          <ProcessingState stage={phase.stage} uploadPercent={phase.uploadPercent} stages={STAGES} />
        )}
        {phase.name === "failed" && <ExcelErrorView error={phase.error} onRetry={runComparison} />}
      </div>
      {phase.name === "done" && (
        <div ref={resultRef} className="max-w-none! scroll-mt-4">
          <ReportWithAnalyst tool="excel" result={phase.result} seal={phase.seal}>
            {({ analyst, focus, analysis }) => (
              <ExcelWorkspace
                result={phase.result}
                original={{ name: phase.original.displayName, sizeBytes: phase.original.sizeBytes }}
                revised={{ name: phase.revised.displayName, sizeBytes: phase.revised.sizeBytes }}
                analyst={analyst}
                analysis={analysis}
                focus={focus}
              />
            )}
          </ReportWithAnalyst>
        </div>
      )}
    </>
  );
}

const SERVICE_PROBLEMS: Record<string, { title: string; whatNext: string }> = {
  engine_unavailable: {
    title: "The comparison service isn't reachable",
    whatNext: "Nothing is wrong with your workbooks. Try again in a moment.",
  },
  timeout: {
    title: "The comparison took too long",
    whatNext: "Your workbooks are fine, but they took longer than expected. Try again, or compare smaller workbooks.",
  },
  network: {
    title: "The connection dropped",
    whatNext: "Check your internet connection and try again. Your workbooks were not changed.",
  },
  too_many_requests: {
    title: "Too many comparisons in a short time",
    whatNext: "Please wait a minute, then try again.",
  },
};

/** A workbook is only blamed when the service examined it and found the problem in it. */
function ExcelErrorView({ error, onRetry }: { error: ExcelFailure; onRetry: () => void }) {
  const fileMessage = excelErrorMessage(error.code);
  const side = error.side === "original" ? "original" : error.side === "revised" ? "revised" : null;
  const service = SERVICE_PROBLEMS[error.code];
  const title = fileMessage
    ? "This workbook can't be compared"
    : (service?.title ?? "The comparison couldn't be completed");
  return (
    <section role="alert" className="mt-6 rounded-[var(--radius-panel)] border border-removed/40 bg-[#fdf0f0] p-4 md:p-5">
      <h2 className="text-[1.05rem] font-semibold text-removed">{title}</h2>
      {side && <p className="mt-1 text-[0.9rem] font-medium">This is about your {side} workbook.</p>}
      <p className="mt-2 max-w-prose">{fileMessage ?? service?.whatNext ?? "Please try again."}</p>
      <div className="mt-3">
        {side ? (
          <p className="text-[0.85rem] text-ink-soft">Use “Replace file” above to choose a different {side} workbook.</p>
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
  if (!bothReady) return "Add both workbooks to continue.";
  if (!engine.checked) return "Checking the comparison service…";
  if (!engine.available) return "The comparison service is unavailable.";
  if (phase.name === "done") return "Your comparison is ready below.";
  return "Both workbooks are ready.";
}

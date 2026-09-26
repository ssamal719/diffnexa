"use client";

import { useEffect, useRef, useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { ExcelWorkspace } from "@/components/excel/ExcelWorkspace";
import { ExampleGuide } from "@/components/examples/ExampleGuide";
import { TryExample } from "@/components/examples/TryExample";
import { ProcessingState, type StageText } from "@/components/results/ProcessingState";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { OfficeFileSlot, type FileCheck, type SlotFile } from "@/components/upload/OfficeFileSlot";
import type { WorkspaceControls } from "@/components/workspace/WorkspaceControls";
import {
  DEFAULT_EXCEL_OPTIONS,
  type ExcelComparison,
  type ExcelFailure,
  type ExcelOptions,
} from "@/lib/excel-report";
import { EXAMPLE_FILES, EXAMPLE_GUIDES, loadExampleFile } from "@/lib/examples";
import { excelExportFormats } from "@/lib/tool-exports";
import { useComparisonRun, type EngineStatus, type RunFiles } from "@/lib/use-comparison-run";
import { EXCEL_ERROR_MESSAGES, EXCEL_MAX_FILE_BYTES, checkXlsxBytes, excelErrorMessage, formatFileSize } from "@/lib/validation";

const STAGES: StageText[] = [
  { id: "sending", label: "Sending your workbooks", detail: "Transferring both files securely" },
  { id: "comparing", label: "Reading and comparing", detail: "Reading every sheet, then matching rows, columns and cells" },
  { id: "preparing", label: "Preparing the comparison", detail: "Laying out both workbooks and every change" },
];

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The Ignore options Excel Compare really implements, each applied by the engine to text cells. */
const IGNORE_OPTIONS = [
  {
    id: "ignoreCase",
    label: "Ignore capitalisation",
    detail: "“Paid” and “PAID” count as the same text. Off by default: text is compared exactly.",
  },
  {
    id: "ignoreWhitespace",
    label: "Ignore extra spaces",
    detail: "Spaces at the start or end of a cell, and repeated spaces inside it, are not reported. Off by default.",
  },
];

const ALWAYS_IGNORED = [
  "A number or date whose format changed but whose stored value did not",
  "A formula rewritten only because a row or column was inserted above or before it",
];

const NOT_COMPARED = ["Formatting: fonts, colours, borders and column widths", "Charts, images and comments", "Macros"];

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
  const [options, setOptions] = useState<ExcelOptions>(DEFAULT_EXCEL_OPTIONS);
  const { engine, phase, run, cancel } = useComparisonRun<ExcelComparison, SlotFile, ExcelFailure>({
    endpoint: "/api/excel/compare",
    fields: ["original", "revised"],
    filenames: ["original.xlsx", "revised.xlsx"],
  });
  const resultRef = useRef<HTMLDivElement>(null);
  const run_ = phase.name === "done" ? phase.run : 0;

  useEffect(() => {
    if (run_ > 0) resultRef.current?.scrollIntoView?.({ block: "start" });
  }, [run_]);

  const bothReady = original !== null && revised !== null;
  const working = phase.name === "working";
  const canCompare = bothReady && engine.available && !working;
  const sameFile =
    bothReady && original.sizeBytes === revised.sizeBytes && original.displayName === revised.displayName;

  /** Every comparison — the first, Reverse, new Ignore options, the example — is this one request. */
  function compare(files: RunFiles<SlotFile>, matching: ExcelOptions = options) {
    run(files, { ...matching }, Boolean(files.original.example && files.revised.example));
  }

  function reverse(done: RunFiles<SlotFile>) {
    const swapped = { original: done.revised, revised: done.original };
    setOriginal(swapped.original);
    setRevised(swapped.revised);
    compare(swapped);
  }

  function applyOptions(done: RunFiles<SlotFile>, values: Record<string, boolean>) {
    const next: ExcelOptions = { ignoreCase: Boolean(values.ignoreCase), ignoreWhitespace: Boolean(values.ignoreWhitespace) };
    setOptions(next);
    compare(done, next);
  }

  /** Loads the built-in example workbooks into both slots and compares them. */
  async function tryExample() {
    const [first, second] = await Promise.all(
      [EXAMPLE_FILES.excel.original, EXAMPLE_FILES.excel.revised].map(async (example) => {
        const file = await loadExampleFile(example, XLSX_TYPE);
        return { file, displayName: example.name, sizeBytes: file.size, example: true } satisfies SlotFile;
      }),
    );
    setOriginal(first);
    setRevised(second);
    if (engine.available) compare({ original: first, revised: second });
    else cancel();
  }

  function controlsFor(done: RunFiles<SlotFile> & { result: ExcelComparison }): WorkspaceControls {
    const applied = done.result.options ?? DEFAULT_EXCEL_OPTIONS;
    return {
      ignore: {
        options: IGNORE_OPTIONS,
        applied: { ignoreCase: applied.ignoreCase, ignoreWhitespace: applied.ignoreWhitespace },
        alwaysIgnored: ALWAYS_IGNORED,
        notCompared: NOT_COMPARED,
        onApply: (values) => applyOptions(done, values),
      },
      exports: excelExportFormats(done.result, { name: done.original.displayName }, { name: done.revised.displayName }),
      reverse: {
        onReverse: () => reverse(done),
        detail: `Compare again with ${done.revised.displayName} as the original and ${done.original.displayName} as the revision`,
      },
    };
  }

  function replaceFile(setter: (value: SlotFile | null) => void) {
    return (value: SlotFile | null) => {
      setter(value);
      cancel(); // a result never lingers beside different files
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
            <Button
              disabled={!canCompare}
              onClick={() => bothReady && compare({ original, revised })}
              aria-describedby="excel-compare-state"
            >
              {working ? "Comparing…" : "Compare workbooks"}
            </Button>
            <p id="excel-compare-state" role="status" aria-live="polite" className="text-[0.85rem] text-ink-soft">
              {stateMessage({ bothReady, engine, phase })}
            </p>
          </div>
          <TryExample
            disabled={working}
            onTry={tryExample}
            note="Loads two versions of a fictional company workbook into the slots above and compares them — no account and no files of your own needed. Replace either one to compare your own."
          />
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
        {phase.name === "failed" && (
          <ExcelErrorView error={phase.error} onRetry={() => bothReady && compare({ original, revised })} />
        )}
      </div>
      {/* The result scrolls into view here — from the example's guide, when there is one. */}
      <div ref={resultRef} className="scroll-mt-4" />
      {phase.name === "done" && phase.example && <ExampleGuide guide={EXAMPLE_GUIDES.excel} />}
      {phase.name === "done" && (
        <div className="max-w-none!">
          <ReportWithAnalyst key={phase.run} tool="excel" result={phase.result} seal={phase.seal}>
            {({ analyst, focus, analysis }) => (
              <ExcelWorkspace
                result={phase.result}
                original={{ name: phase.original.displayName, sizeBytes: phase.original.sizeBytes }}
                revised={{ name: phase.revised.displayName, sizeBytes: phase.revised.sizeBytes }}
                analyst={analyst}
                analysis={analysis}
                focus={focus}
                controls={controlsFor(phase)}
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

function stateMessage({
  bothReady,
  engine,
  phase,
}: {
  bothReady: boolean;
  engine: EngineStatus;
  phase: { name: string };
}): string {
  if (phase.name === "working") return "Working on it — progress is shown below.";
  if (!bothReady) return "Add both workbooks to continue.";
  if (!engine.checked) return "Checking the comparison service…";
  if (!engine.available) return "The comparison service is unavailable.";
  if (phase.name === "done") return "Your comparison is ready below.";
  return "Both workbooks are ready.";
}

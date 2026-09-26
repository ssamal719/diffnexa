"use client";

import { useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { ExampleGuide } from "@/components/examples/ExampleGuide";
import { TryExample } from "@/components/examples/TryExample";
import { ComparisonError } from "@/components/results/ComparisonError";
import { ComparisonReport } from "@/components/results/ComparisonReport";
import { ProcessingState } from "@/components/results/ProcessingState";
import { UploadSlot, type SlotFile } from "@/components/upload/UploadSlot";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { WorkspaceControls } from "@/components/workspace/WorkspaceControls";
import {
  DEFAULT_PDF_OPTIONS,
  type ComparisonError as ComparisonErrorPayload,
  type ComparisonResponse,
  type PdfOptions,
} from "@/lib/comparison";
import { EXAMPLE_FILES, EXAMPLE_GUIDES, loadExampleFile } from "@/lib/examples";
import { inspectPdf } from "@/lib/pdf-preview";
import { pdfExportFormats } from "@/lib/tool-exports";
import { runStatus, useComparisonRun, type RunFiles } from "@/lib/use-comparison-run";
import { DEFAULT_LIMITS } from "@/lib/validation";

/** The Ignore options PDF Compare really implements, each applied by the engine. */
const IGNORE_OPTIONS = [
  {
    id: "ignoreCase",
    label: "Ignore capitalisation",
    detail: "“Deadline” and “deadline” count as the same word. On by default.",
  },
  {
    id: "ignorePunctuation",
    label: "Ignore punctuation-only changes",
    detail:
      "An added or removed comma or full stop is not reported. Punctuation inside numbers, such as 2,500 or 3.5, is always compared.",
  },
];

const ALWAYS_IGNORED = [
  "Where lines wrap and where pages break, and extra spaces between words",
  "Repeated headers, footers and page numbers — set aside as minor differences, which you can show from Filters",
];

const NOT_COMPARED = ["Fonts, colours and layout", "Images and drawings", "Scanned pages without a text layer"];

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
  const [options, setOptions] = useState<PdfOptions>(DEFAULT_PDF_OPTIONS);
  const { engine, phase, run, cancel } = useComparisonRun<ComparisonResponse, SlotFile, ComparisonErrorPayload>({
    endpoint: "/api/compare",
    fields: ["previous", "revised"],
    filenames: ["previous.pdf", "revised.pdf"],
  });

  const bothReady = previous !== null && revised !== null;
  const working = phase.name === "working";
  const canCompare = bothReady && engine.available && !working;
  const sameFile =
    bothReady && previous.sizeBytes === revised.sizeBytes && previous.displayName === revised.displayName;

  /** Every comparison — the first, Reverse, new Ignore options, the example — is this one request. */
  function compare(files: RunFiles<SlotFile>, matching: PdfOptions = options) {
    run(files, { ...matching }, Boolean(files.original.example && files.revised.example));
  }

  function reverse(done: RunFiles<SlotFile>) {
    const swapped = { original: done.revised, revised: done.original };
    setPrevious(swapped.original);
    setRevised(swapped.revised);
    compare(swapped);
  }

  function applyOptions(done: RunFiles<SlotFile>, values: Record<string, boolean>) {
    const next: PdfOptions = { ignoreCase: Boolean(values.ignoreCase), ignorePunctuation: Boolean(values.ignorePunctuation) };
    setOptions(next);
    compare(done, next);
  }

  /** Loads the built-in example PDFs into both slots and compares them. */
  async function tryExample() {
    const [first, second] = await Promise.all(
      [EXAMPLE_FILES.pdf.original, EXAMPLE_FILES.pdf.revised].map(async (example) => {
        const file = await loadExampleFile(example, "application/pdf");
        const inspection = await inspectPdf(file, DEFAULT_LIMITS);
        if (!inspection.ok) throw new Error("example unreadable");
        return {
          file,
          displayName: example.name,
          sizeBytes: file.size,
          pageCount: inspection.pageCount,
          example: true,
        } satisfies SlotFile;
      }),
    );
    setPrevious(first);
    setRevised(second);
    if (engine.available) compare({ original: first, revised: second });
    else cancel();
  }

  function controlsFor(done: RunFiles<SlotFile> & { result: ComparisonResponse }): WorkspaceControls {
    const applied = done.result.options ?? DEFAULT_PDF_OPTIONS;
    return {
      ignore: {
        options: IGNORE_OPTIONS,
        applied: { ignoreCase: applied.ignoreCase, ignorePunctuation: applied.ignorePunctuation },
        alwaysIgnored: ALWAYS_IGNORED,
        notCompared: NOT_COMPARED,
        onApply: (values) => applyOptions(done, values),
      },
      exports: pdfExportFormats(done.result, { name: done.original.displayName }, { name: done.revised.displayName }),
      reverse: {
        onReverse: () => reverse(done),
        detail: `Compare again with ${done.revised.displayName} as the previous version and ${done.original.displayName} as the new one`,
      },
    };
  }

  function replaceFile(setter: (value: SlotFile | null) => void) {
    return (value: SlotFile | null) => {
      setter(value);
      cancel(); // results never linger beside different files
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
            <Button
              disabled={!canCompare}
              onClick={() => bothReady && compare({ original: previous, revised })}
              aria-describedby="compare-state"
            >
              {working ? "Comparing…" : "Compare documents"}
            </Button>
            <p id="compare-state" role="status" aria-live="polite" className="text-[0.85rem] text-ink-soft">
              {runStatus(phase, engine, bothReady)}
            </p>
          </div>

          <TryExample
            disabled={working}
            onTry={tryExample}
            note="Loads two versions of a fictional recruitment notice into the slots above and compares them — no account and no files of your own needed. Replace either one to compare your own."
          />

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

      {phase.name === "working" && <ProcessingState stage={phase.stage} uploadPercent={phase.uploadPercent} />}
      {phase.name === "failed" && (
        <ComparisonError error={phase.error} onRetry={() => bothReady && compare({ original: previous, revised })} />
      )}
      {phase.name === "done" && phase.example && <ExampleGuide guide={EXAMPLE_GUIDES.pdf} />}
      {phase.name === "done" && (
        <ReportWithAnalyst key={phase.run} tool="pdf" result={phase.result} seal={phase.seal}>
          {({ analyst, focus, analysis }) => (
            <ComparisonReport
              result={phase.result}
              files={{ original: phase.original.file, revised: phase.revised.file }}
              names={{ original: phase.original.displayName, revised: phase.revised.displayName }}
              analyst={analyst}
              analysis={analysis}
              focus={focus}
              controls={controlsFor(phase)}
            />
          )}
        </ReportWithAnalyst>
      )}
    </>
  );
}

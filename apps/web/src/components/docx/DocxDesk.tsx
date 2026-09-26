"use client";

import { useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { DocxReport } from "@/components/docx/DocxReport";
import { DocxUploadSlot, type DocxSlotFile } from "@/components/docx/DocxUploadSlot";
import { ExampleGuide } from "@/components/examples/ExampleGuide";
import { TryExample } from "@/components/examples/TryExample";
import { ProcessingState, type StageText } from "@/components/results/ProcessingState";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { WorkspaceControls } from "@/components/workspace/WorkspaceControls";
import { docxExportFormats } from "@/lib/docx-export";
import { DEFAULT_DOCX_OPTIONS, type DocxComparison, type DocxFailure, type DocxOptions } from "@/lib/docx-report";
import { EXAMPLE_FILES, EXAMPLE_GUIDES, loadExampleFile } from "@/lib/examples";
import { runStatus, useComparisonRun, type RunFiles } from "@/lib/use-comparison-run";
import { docxErrorMessage } from "@/lib/validation";

/**
 * The built-in example: a short, fictional services agreement and a revision
 * of it, served with the site (see apps/engine/tests/fixtures/docx_pages/
 * build_example.py). They are compared exactly like uploaded files.
 */
export const DOCX_EXAMPLE = EXAMPLE_FILES.docx;

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The Ignore options DOCX Compare really implements, each applied by the engine. */
const IGNORE_OPTIONS = [
  {
    id: "ignoreCase",
    label: "Ignore capitalisation",
    detail: "“Client” and “client” count as the same word. On by default.",
  },
  {
    id: "ignorePunctuation",
    label: "Ignore punctuation-only changes",
    detail: "An added or removed comma or full stop is not reported. Punctuation inside numbers, such as 2,500 or 3.5, is always compared.",
  },
];

const ALWAYS_IGNORED = [
  "Extra spaces, tabs and line breaks inside a paragraph",
  "Where lines wrap and where pages break",
];

const NOT_COMPARED = [
  "Formatting such as fonts, bold, colours and spacing",
  "Headers, footers, footnotes and comments",
  "Images",
];

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
  const [options, setOptions] = useState<DocxOptions>(DEFAULT_DOCX_OPTIONS);
  const { engine, phase, run, cancel } = useComparisonRun<DocxComparison, DocxSlotFile, DocxFailure>({
    endpoint: "/api/docx/compare",
    fields: ["original", "revised"],
    filenames: ["original.docx", "revised.docx"],
  });

  const bothReady = original !== null && revised !== null;
  const working = phase.name === "working";
  const canCompare = bothReady && engine.available && !working;
  const sameFile =
    bothReady && original.sizeBytes === revised.sizeBytes && original.displayName === revised.displayName;

  /** Every comparison — the first, Reverse, new Ignore options, the example — is this one request. */
  function compare(files: RunFiles<DocxSlotFile>, matching: DocxOptions = options) {
    run(files, { ...matching }, Boolean(files.original.example && files.revised.example));
  }

  /** Swaps which file is the original and which the revision, then compares them again. */
  function reverse(done: RunFiles<DocxSlotFile>) {
    const swapped = { original: done.revised, revised: done.original };
    setOriginal(swapped.original);
    setRevised(swapped.revised);
    compare(swapped);
  }

  /** Compares the same two files again with different Ignore options. */
  function applyOptions(done: RunFiles<DocxSlotFile>, values: Record<string, boolean>) {
    const next: DocxOptions = {
      ignoreCase: Boolean(values.ignoreCase),
      ignorePunctuation: Boolean(values.ignorePunctuation),
    };
    setOptions(next);
    compare(done, next);
  }

  /** Loads the built-in example documents into both slots and compares them. */
  async function tryExample() {
    const [first, second] = await Promise.all(
      [DOCX_EXAMPLE.original, DOCX_EXAMPLE.revised].map(async (example) => {
        const file = await loadExampleFile(example, DOCX_TYPE);
        return { file, displayName: example.name, sizeBytes: file.size, example: true } satisfies DocxSlotFile;
      }),
    );
    setOriginal(first);
    setRevised(second);
    if (engine.available) compare({ original: first, revised: second });
    else cancel();
  }

  function controlsFor(done: RunFiles<DocxSlotFile> & { result: DocxComparison }): WorkspaceControls {
    const applied = done.result.options ?? DEFAULT_DOCX_OPTIONS;
    return {
      ignore: {
        options: IGNORE_OPTIONS,
        applied: { ignoreCase: applied.ignoreCase, ignorePunctuation: applied.ignorePunctuation },
        alwaysIgnored: ALWAYS_IGNORED,
        notCompared: NOT_COMPARED,
        onApply: (values) => applyOptions(done, values),
      },
      exports: docxExportFormats(
        done.result,
        { name: done.original.displayName },
        { name: done.revised.displayName },
      ),
      reverse: {
        onReverse: () => reverse(done),
        detail: `Compare again with ${done.revised.displayName} as the original and ${done.original.displayName} as the revision`,
      },
    };
  }

  function replaceFile(setter: (value: DocxSlotFile | null) => void) {
    return (value: DocxSlotFile | null) => {
      setter(value);
      cancel(); // a result never lingers beside different files
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
            <Button
              disabled={!canCompare}
              onClick={() => bothReady && compare({ original, revised })}
              aria-describedby="docx-compare-state"
            >
              {working ? "Comparing…" : "Compare documents"}
            </Button>
            <p id="docx-compare-state" role="status" aria-live="polite" className="text-[0.85rem] text-ink-soft">
              {runStatus(phase, engine, bothReady)}
            </p>
          </div>

          <TryExample
            disabled={working}
            onTry={tryExample}
            note="Loads two short, fictional versions of a services agreement into the slots above and compares them — no account and no files of your own needed. Replace either one to compare your own."
          />

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
      {phase.name === "failed" && (
        <DocxError error={phase.error} onRetry={() => bothReady && compare({ original, revised })} />
      )}
      {phase.name === "done" && phase.example && <ExampleGuide guide={EXAMPLE_GUIDES.docx} />}
      {phase.name === "done" && (
        <ReportWithAnalyst key={phase.run} tool="docx" result={phase.result} seal={phase.seal}>
          {({ analyst, focus, analysis }) => (
            <DocxReport
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

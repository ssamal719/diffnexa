"use client";

import { useState, type ReactNode } from "react";

import { TryExample } from "@/components/examples/TryExample";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCapturedAt } from "@/lib/web-report";

/** The baseline the person has in hand: a file they chose, or a page they have just captured. */
export type DeskBaseline = {
  /** The file's name, or a description of the capture. */
  name: string;
  capturedAt: string | null;
  /** Captured here just now, so not saved yet: the file still needs downloading. */
  justCaptured: boolean;
  /** Extra facts about it, such as the page title or the competitor's name. */
  details?: { label: string; value: string }[];
};

/**
 * The two-panel desk shared by the four web monitoring tools, laid out like
 * the file comparison tools: the earlier version on the left, the later one on
 * the right, one button to compare them.
 *
 * On the left is the baseline — the page as it was, a small file the person
 * keeps. They drop in a baseline they saved, or capture one now from the
 * address on the right. On the right is the page now, read live when they
 * check. The tool supplies the fields (address, labels) and all behaviour;
 * this component only arranges them, so every tool reads the same way.
 */
export function MonitorDesk({
  fileInputId,
  pageTitle = "Page to check",
  pageHint = "Read live when you check",
  pageFields,
  baseline,
  fileError,
  onChooseFile,
  onRemoveBaseline,
  onCapture,
  onDownload,
  onCheck,
  working,
  capturing,
  checking,
  status,
  example,
  footnote,
}: {
  fileInputId: string;
  pageTitle?: string;
  pageHint?: string;
  /** The address and the tool's own labels. */
  pageFields: ReactNode;
  baseline: DeskBaseline | null;
  fileError: string | null;
  onChooseFile: (file: File) => void;
  onRemoveBaseline: () => void;
  onCapture: () => void;
  onDownload: () => void;
  onCheck: () => void;
  working: boolean;
  capturing: boolean;
  checking: boolean;
  status: string;
  example: { note: string; onTry: () => Promise<void> };
  footnote: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
      <div className="grid gap-px bg-rule md:grid-cols-2">
        {/* ---------------------------------------------------------- the baseline */}
        <section
          aria-label="Baseline"
          className="flex flex-col bg-paper p-4 md:p-5"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onChooseFile(file);
          }}
        >
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-[0.95rem] font-semibold">
              <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink/80 text-[0.72rem] text-white">
                1
              </span>
              Baseline
            </h2>
            <span className="text-[0.8rem] text-ink-soft">The page as it was</span>
          </div>

          <div
            className={[
              "flex flex-1 flex-col justify-center rounded-[var(--radius-panel)] border p-4 transition-colors",
              dragging ? "border-signal bg-surface-sunken" : "border-dashed border-rule-strong bg-paper",
            ].join(" ")}
          >
            <input
              id={fileInputId}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onChooseFile(file);
                event.target.value = "";
              }}
            />

            {baseline === null ? (
              <div className="text-center">
                <p className="text-[0.9rem] text-ink-soft">Drag your baseline file here, or</p>
                <label
                  htmlFor={fileInputId}
                  className="mt-2 inline-flex cursor-pointer items-center rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.9rem] font-medium hover:bg-surface"
                >
                  Choose baseline file
                </label>
                <div className="mt-4 border-t border-rule pt-3">
                  <p className="text-[0.85rem] text-ink-soft">No baseline yet? Capture the page as it is today.</p>
                  <Button
                    variant="secondary"
                    onClick={onCapture}
                    disabled={working}
                    className="mt-2 px-3 py-1.5 text-[0.9rem]"
                  >
                    {capturing ? "Capturing…" : "Capture baseline"}
                  </Button>
                  <p className="mt-1.5 text-[0.78rem] text-ink-soft">Uses the page address in step 2.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="font-medium break-words">{baseline.name}</p>
                <p className="text-[0.85rem] text-ink-soft">
                  {baseline.justCaptured ? <Badge tone="working">Captured now</Badge> : <Badge tone="ready">Ready</Badge>}{" "}
                  {baseline.capturedAt && <span className="ml-1">Captured {formatCapturedAt(baseline.capturedAt)}</span>}
                </p>
                {baseline.details && baseline.details.length > 0 && (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[0.82rem]">
                    {baseline.details.map((item) => (
                      <div key={item.label} className="contents">
                        <dt className="text-ink-soft">{item.label}</dt>
                        <dd className="break-words">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {baseline.justCaptured && (
                  <div className="rounded-[4px] border border-caution/50 bg-caution-soft px-2.5 py-2 text-[0.82rem]">
                    <p className="font-semibold">Keep this file — you will need it</p>
                    <p className="mt-0.5">
                      The baseline is a small file on your computer, not an account. Download it, then come back
                      whenever you like, drop it here and check for changes.
                    </p>
                    <Button onClick={onDownload} className="mt-2 px-3 py-1.5 text-[0.85rem]">
                      Download baseline
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <label
                    htmlFor={fileInputId}
                    className="inline-flex cursor-pointer items-center rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"
                  >
                    Replace file
                  </label>
                  <Button variant="secondary" onClick={onRemoveBaseline} className="px-3 py-1.5 text-[0.85rem]">
                    Remove
                  </Button>
                </div>
              </div>
            )}
            {fileError && (
              <p role="alert" className="mt-2 text-[0.85rem] text-removed">
                <span className="font-semibold">Problem: </span>
                {fileError}
              </p>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------- the page now */}
        <section aria-label={pageTitle} className="flex flex-col bg-paper p-4 md:p-5">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-[0.95rem] font-semibold">
              <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink/80 text-[0.72rem] text-white">
                2
              </span>
              {pageTitle}
            </h2>
            <span className="text-[0.8rem] text-ink-soft">{pageHint}</span>
          </div>
          <div className="space-y-4 rounded-[var(--radius-panel)] border border-rule p-4">{pageFields}</div>
        </section>
      </div>

      <div className="space-y-3 border-t border-rule p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onCheck} disabled={working}>
            {checking ? "Checking…" : "Check for changes"}
          </Button>
          <p className="text-[0.85rem] text-ink-soft" role="status" aria-live="polite">
            {status}
          </p>
        </div>
        <TryExample disabled={working} note={example.note} onTry={example.onTry} />
        <div className="text-[0.8rem] text-ink-soft">{footnote}</div>
      </div>
    </div>
  );
}

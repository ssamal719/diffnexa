"use client";

import { useState } from "react";

import { UploadSlot, type SlotFile } from "@/components/upload/UploadSlot";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DEFAULT_LIMITS } from "@/lib/validation";

/**
 * The tool is the page's main content, so it sits directly under the heading.
 *
 * Stage 1 deliberately stops at the point of comparison: files stay on this
 * device and the compare action is disabled, because the engine is not
 * connected yet. Nothing here pretends to do more than it does.
 */
export function CompareDesk() {
  const [previous, setPrevious] = useState<SlotFile | null>(null);
  const [revised, setRevised] = useState<SlotFile | null>(null);

  const bothReady = previous !== null && revised !== null;
  const sameFile =
    bothReady &&
    previous.sizeBytes === revised.sizeBytes &&
    previous.displayName === revised.displayName;

  return (
    <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
      <div className="grid gap-px bg-rule md:grid-cols-2">
        <div className="bg-paper p-4 md:p-5">
          <UploadSlot
            label="Previous version"
            hint="The original"
            limits={DEFAULT_LIMITS}
            value={previous}
            onChange={setPrevious}
          />
        </div>
        <div className="bg-paper p-4 md:p-5">
          <UploadSlot
            label="New version"
            hint="The revision"
            limits={DEFAULT_LIMITS}
            value={revised}
            onChange={setRevised}
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
          <Button disabled aria-describedby="compare-availability">
            Compare PDFs
          </Button>
          <p id="compare-availability" className="text-[0.85rem] text-ink-soft">
            {bothReady
              ? "Both files are ready. Comparison is not available yet."
              : "Choose both files to continue."}
          </p>
        </div>

        <Alert tone="planned" title="Comparison engine not connected yet">
          This is the foundation release. Your files are read on this device only, to check that
          they open and to count their pages. Nothing is uploaded or sent anywhere, and no
          comparison is produced yet.
        </Alert>
      </div>
    </div>
  );
}

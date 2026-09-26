"use client";

import { useId, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";

/**
 * The "Try example" button, and a line saying what it does.
 *
 * `onTry` loads the tool's example and compares it the ordinary way; if the
 * example cannot be loaded, that is said plainly rather than left silent.
 */
export function TryExample({
  note,
  onTry,
  disabled = false,
}: {
  /** What the example is and what happens when it is chosen. */
  note: string;
  onTry: () => Promise<void>;
  disabled?: boolean;
}) {
  const id = useId();
  const [problem, setProblem] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button
          variant="secondary"
          disabled={disabled}
          aria-describedby={`${id}-note`}
          onClick={async () => {
            setProblem(false);
            try {
              await onTry();
            } catch {
              setProblem(true);
            }
          }}
        >
          <span aria-hidden="true" className="mr-1.5 text-signal">
            ▶
          </span>
          Try example
        </Button>
        <p id={`${id}-note`} className="min-w-0 flex-1 basis-64 text-[0.82rem] text-ink-soft">
          {note}
        </p>
      </div>
      {problem && (
        <Alert tone="problem" title="The example couldn't be loaded" role="alert">
          Please try again in a moment, or use your own files.
        </Alert>
      )}
    </div>
  );
}

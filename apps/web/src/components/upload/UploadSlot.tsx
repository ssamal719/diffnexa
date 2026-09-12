"use client";

import { useId, useRef, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { inspectPdf } from "@/lib/pdf-preview";
import {
  checkFileSize,
  errorMessage,
  formatFileSize,
  formatPageCount,
  sanitizeFilename,
  type ErrorCode,
  type UploadLimits,
} from "@/lib/validation";

export type SlotFile = {
  file: File;
  displayName: string;
  sizeBytes: number;
  pageCount: number;
};

type State =
  | { status: "empty" }
  | { status: "checking"; displayName: string; sizeBytes: number }
  | { status: "ready"; value: SlotFile }
  | { status: "rejected"; displayName: string; code: ErrorCode };

export function UploadSlot({
  label,
  hint,
  limits,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  limits: UploadLimits;
  value: SlotFile | null;
  onChange: (value: SlotFile | null) => void;
}) {
  const inputId = useId();
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>(value ? { status: "ready", value } : { status: "empty" });
  const [dragging, setDragging] = useState(false);

  async function accept(file: File) {
    const displayName = sanitizeFilename(file.name);
    setState({ status: "checking", displayName, sizeBytes: file.size });

    const size = checkFileSize(file.size, limits);
    if (!size.ok) {
      setState({ status: "rejected", displayName, code: size.code });
      onChange(null);
      return;
    }

    const inspection = await inspectPdf(file, limits);
    if (!inspection.ok) {
      setState({ status: "rejected", displayName, code: inspection.code });
      onChange(null);
      return;
    }

    const accepted: SlotFile = {
      file,
      displayName,
      sizeBytes: file.size,
      pageCount: inspection.pageCount,
    };
    setState({ status: "ready", value: accepted });
    onChange(accepted);
  }

  function clear() {
    setState({ status: "empty" });
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.focus();
  }

  const isEmpty = state.status === "empty";

  return (
    <section
      aria-label={label}
      className="flex h-full flex-col"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void accept(file);
      }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[0.95rem] font-semibold">{label}</h2>
        <span className="text-[0.8rem] text-ink-soft">{hint}</span>
      </div>

      <div
        className={[
          "flex flex-1 flex-col justify-center rounded-[var(--radius-panel)] border p-4 transition-colors",
          dragging ? "border-signal bg-surface-sunken" : "border-dashed border-rule-strong bg-paper",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-describedby={statusId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void accept(file);
          }}
        />

        {isEmpty ? (
          <div className="text-center">
            <p className="text-[0.9rem] text-ink-soft">Drag a PDF here, or</p>
            <label
              htmlFor={inputId}
              className="mt-2 inline-flex cursor-pointer items-center rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.9rem] font-medium hover:bg-surface focus-within:outline-2"
            >
              Choose file
            </label>
            <p className="mt-2 text-[0.8rem] text-ink-soft">
              PDF only, up to {formatFileSize(limits.maxFileBytes)} and {limits.maxPages} pages
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-medium break-words" title={state.status === "ready" ? state.value.displayName : undefined}>
              {state.status === "ready" ? state.value.displayName : state.displayName}
            </p>

            {state.status === "checking" && (
              <p className="tabular text-[0.85rem] text-ink-soft">
                <Badge tone="working">Checking</Badge>{" "}
                <span className="ml-1">{formatFileSize(state.sizeBytes)} · reading pages…</span>
              </p>
            )}

            {state.status === "ready" && (
              <p className="tabular text-[0.85rem] text-ink-soft">
                <Badge tone="ready">Ready</Badge>{" "}
                <span className="ml-1">
                  {formatFileSize(state.value.sizeBytes)} · {formatPageCount(state.value.pageCount)}
                </span>
              </p>
            )}

            {state.status === "rejected" && (
              <Alert tone="problem" title="This file can't be used" role="alert">
                {errorMessage(state.code)}
              </Alert>
            )}

            <div className="flex gap-2 pt-1">
              <label
                htmlFor={inputId}
                className="inline-flex cursor-pointer items-center rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"
              >
                Replace file
              </label>
              <Button variant="secondary" onClick={clear} className="px-3 py-1.5 text-[0.85rem]">
                Remove
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Screen readers announce every state change through this one live region. */}
      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {state.status === "empty" && `${label}: no file chosen.`}
        {state.status === "checking" && `${label}: checking ${state.displayName}.`}
        {state.status === "ready" &&
          `${label}: ${state.value.displayName} ready, ${formatPageCount(state.value.pageCount)}.`}
        {state.status === "rejected" && `${label}: ${state.displayName} rejected. ${errorMessage(state.code)}`}
      </p>
    </section>
  );
}

"use client";

import { useId, useRef, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatFileSize, sanitizeFilename } from "@/lib/validation";

export type SlotFile = {
  file: File;
  displayName: string;
  sizeBytes: number;
  /** One of DiffNexa's built-in example files rather than the person's own. */
  example?: boolean;
};

export type FileCheck = { ok: true } | { ok: false; message: string };

type State =
  | { status: "empty" }
  | { status: "checking"; displayName: string; sizeBytes: number }
  | { status: "ready"; value: SlotFile }
  | { status: "rejected"; displayName: string; message: string };

/**
 * One file to compare: drag and drop or choose, then replace or remove.
 *
 * The tool supplies the first check (`check`), which looks only at the file's
 * bytes. It is a courtesy so an obvious mismatch is reported straight away; the
 * comparison service repeats every check and its verdict is the one that counts.
 * Nothing here trusts the file's name or declared type.
 */
export function OfficeFileSlot({
  label,
  hint,
  accept,
  dropText,
  formatNote,
  kindNote,
  check,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  accept: string;
  dropText: string;
  formatNote: string;
  kindNote: string;
  check: (file: File) => Promise<FileCheck>;
  value: SlotFile | null;
  onChange: (value: SlotFile | null) => void;
}) {
  const inputId = useId();
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>(value ? { status: "ready", value } : { status: "empty" });
  const [dragging, setDragging] = useState(false);

  // The desk can also fill the slot itself — the example, or Reverse swapping
  // the two files — so the slot follows a value set from outside.
  const [shown, setShown] = useState<SlotFile | null>(value);
  if (value !== shown) {
    setShown(value);
    if (value) setState({ status: "ready", value });
    else if (state.status === "ready") setState({ status: "empty" });
  }

  async function accept_(file: File) {
    const displayName = sanitizeFilename(file.name);
    setState({ status: "checking", displayName, sizeBytes: file.size });
    const verdict = await check(file);
    if (!verdict.ok) {
      setState({ status: "rejected", displayName, message: verdict.message });
      onChange(null);
      return;
    }
    const accepted: SlotFile = { file, displayName, sizeBytes: file.size };
    setState({ status: "ready", value: accepted });
    onChange(accepted);
  }

  function clear() {
    setState({ status: "empty" });
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.focus();
  }

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
        if (file) void accept_(file);
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
          accept={accept}
          className="sr-only"
          aria-describedby={statusId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void accept_(file);
          }}
        />
        {state.status === "empty" ? (
          <div className="text-center">
            <p className="text-[0.9rem] text-ink-soft">{dropText}</p>
            <label
              htmlFor={inputId}
              className="mt-2 inline-flex cursor-pointer items-center rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.9rem] font-medium hover:bg-surface focus-within:outline-2"
            >
              Choose file
            </label>
            <p className="mt-2 text-[0.8rem] text-ink-soft">{formatNote}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-medium break-words">
              {state.status === "ready" ? state.value.displayName : state.displayName}
            </p>
            {state.status === "checking" && (
              <p className="tabular text-[0.85rem] text-ink-soft">
                <Badge tone="working">Checking</Badge> <span className="ml-1">{formatFileSize(state.sizeBytes)}</span>
              </p>
            )}
            {state.status === "ready" && (
              <p className="tabular text-[0.85rem] text-ink-soft">
                <Badge tone="ready">Ready</Badge>{" "}
                {state.value.example && (
                  <>
                    <Badge tone="neutral">Example file</Badge>{" "}
                  </>
                )}
                <span className="ml-1">
                  {formatFileSize(state.value.sizeBytes)} · {kindNote}
                </span>
              </p>
            )}
            {state.status === "rejected" && (
              <Alert tone="problem" title="This file can't be used" role="alert">
                {state.message}
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
      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {state.status === "empty" && `${label}: no file chosen.`}
        {state.status === "checking" && `${label}: checking ${state.displayName}.`}
        {state.status === "ready" &&
          `${label}: ${state.value.displayName} ready.${state.value.example ? " This is an example file." : ""}`}
        {state.status === "rejected" && `${label}: ${state.displayName} rejected. ${state.message}`}
      </p>
    </section>
  );
}

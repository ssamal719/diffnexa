"use client";

import { useId, useRef, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DOCX_ERROR_MESSAGES,
  DOCX_MAX_FILE_BYTES,
  checkDocxBytes,
  formatFileSize,
  sanitizeFilename,
  type DocxErrorCode,
} from "@/lib/validation";

export type DocxSlotFile = {
  file: File;
  displayName: string;
  sizeBytes: number;
  /** One of DiffNexa's built-in example documents rather than the person's own file. */
  example?: boolean;
};

type State =
  | { status: "empty" }
  | { status: "checking"; displayName: string; sizeBytes: number }
  | { status: "ready"; value: DocxSlotFile }
  | { status: "rejected"; displayName: string; code: DocxErrorCode };

/**
 * One of the two Word documents.
 *
 * The browser only takes a first look at the file's bytes so an obvious
 * mismatch — a PDF, an old .doc, an empty file — is reported straight away.
 * The file is not opened, unpacked or read for content here; the comparison
 * service does that, and repeats every check on the real bytes.
 */
export function DocxUploadSlot({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: DocxSlotFile | null;
  onChange: (value: DocxSlotFile | null) => void;
}) {
  const inputId = useId();
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>(value ? { status: "ready", value } : { status: "empty" });
  const [dragging, setDragging] = useState(false);

  // The desk can also fill the slot itself — the example, or Reverse swapping
  // the two files — so the slot follows a value set from outside.
  const [shown, setShown] = useState<DocxSlotFile | null>(value);
  if (value !== shown) {
    setShown(value);
    if (value) setState({ status: "ready", value });
    else if (state.status === "ready") setState({ status: "empty" });
  }

  async function accept(file: File) {
    const displayName = sanitizeFilename(file.name);
    setState({ status: "checking", displayName, sizeBytes: file.size });

    let verdict = checkDocxBytes(new Uint8Array(0));
    if (file.size > DOCX_MAX_FILE_BYTES) {
      verdict = { ok: false, code: "docx_too_large" };
    } else if (file.size > 0) {
      // Only an older Word container needs reading in full, to tell a .doc from
      // a password-protected .docx; everything else is decided by its first bytes.
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const needsAll = head[0] === 0xd0 && head[1] === 0xcf;
      const bytes = needsAll ? new Uint8Array(await file.arrayBuffer()) : head;
      verdict = checkDocxBytes(bytes);
    }

    if (!verdict.ok) {
      setState({ status: "rejected", displayName, code: verdict.code });
      onChange(null);
      return;
    }

    const accepted: DocxSlotFile = { file, displayName, sizeBytes: file.size };
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
      // Named apart from the report's "Original document" and "Revised document" views, so every region has its own name.
      aria-label={`${label} upload`}
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
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          aria-describedby={statusId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void accept(file);
          }}
        />

        {state.status === "empty" ? (
          <div className="text-center">
            <p className="text-[0.9rem] text-ink-soft">Drag a .docx file here, or</p>
            <label
              htmlFor={inputId}
              className="mt-2 inline-flex cursor-pointer items-center rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.9rem] font-medium hover:bg-surface focus-within:outline-2"
            >
              Choose file
            </label>
            <p className="mt-2 text-[0.8rem] text-ink-soft">
              Word .docx only, up to {formatFileSize(DOCX_MAX_FILE_BYTES)}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-medium break-words">
              {state.status === "ready" ? state.value.displayName : state.displayName}
            </p>

            {state.status === "checking" && (
              <p className="tabular text-[0.85rem] text-ink-soft">
                <Badge tone="working">Checking</Badge>{" "}
                <span className="ml-1">{formatFileSize(state.sizeBytes)}</span>
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
                <span className="ml-1">{formatFileSize(state.value.sizeBytes)} · Word document</span>
              </p>
            )}

            {state.status === "rejected" && (
              <Alert tone="problem" title="This file can't be used" role="alert">
                {DOCX_ERROR_MESSAGES[state.code]}
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
        {state.status === "rejected" &&
          `${label}: ${state.displayName} rejected. ${DOCX_ERROR_MESSAGES[state.code]}`}
      </p>
    </section>
  );
}

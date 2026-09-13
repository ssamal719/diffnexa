"use client";

import { useRef, useState } from "react";

import { PolicyReport } from "@/components/policy/PolicyReport";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { TextField } from "@/components/ui/TextField";
import { WebError } from "@/components/website/WebError";
import { WebProcessing, type WebStage } from "@/components/website/WebProcessing";
import {
  POLICY_TYPES,
  baselineFilename,
  buildBaselineFile,
  policyTypeLabel,
  readBaselineFile,
  type CapturedSnapshot,
  type PolicyBaselineFile,
  type PolicyComparison,
} from "@/lib/policy-report";
import { checkUrl, formatCapturedAt, type WebFailure } from "@/lib/web-report";

type Mode = "capture" | "check";

type State =
  | { name: "idle" }
  | { name: "working"; mode: "capture" | "compare"; stage: WebStage }
  | { name: "captured"; baseline: PolicyBaselineFile }
  | {
      name: "checked";
      result: PolicyComparison;
      url: string;
      policyType: string | null;
      baselineCapturedAt: string | null;
    }
  | { name: "failed"; failure: WebFailure; mode: Mode };

/**
 * Capture a policy page, or check one against a baseline you kept.
 *
 * The two jobs are separated at the top because a first-time visitor is doing
 * one and a returning visitor the other. Nothing here mentions how any of it
 * works, and nothing suggests the page is being watched: you check when you
 * choose to.
 */
export function PolicyDesk() {
  const [mode, setMode] = useState<Mode>("capture");
  const [url, setUrl] = useState("");
  const [policyType, setPolicyType] = useState<string>(POLICY_TYPES[0].id);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<{
    name: string;
    snapshot: Record<string, unknown>;
    policyType: string | null;
    url: string | null;
  } | null>(null);
  const [state, setState] = useState<State>({ name: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function capture() {
    const checked = checkUrl(url);
    if (!checked.ok) {
      setUrlError(checked.message);
      return;
    }
    setUrlError(null);
    setState({ name: "working", mode: "capture", stage: "fetching" });

    try {
      const response = await fetch("/api/policy/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", mode: "capture", failure: body?.error ?? unknownFailure() });
        return;
      }
      setState({ name: "working", mode: "capture", stage: "preparing" });
      setState({
        name: "captured",
        baseline: buildBaselineFile(body.snapshot as CapturedSnapshot, policyType),
      });
    } catch {
      setState({ name: "failed", mode: "capture", failure: connectionFailure() });
    }
  }

  async function check() {
    const checked = checkUrl(url);
    if (!checked.ok) {
      setUrlError(checked.message);
      return;
    }
    if (!baseline) {
      setFileError("Choose the baseline file you downloaded for this page.");
      return;
    }
    setUrlError(null);
    setFileError(null);
    setState({ name: "working", mode: "compare", stage: "fetching" });

    try {
      const response = await fetch("/api/policy/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url, previous_snapshot: baseline.snapshot }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", mode: "check", failure: body?.error ?? unknownFailure() });
        return;
      }
      setState({ name: "working", mode: "compare", stage: "preparing" });
      setState({
        name: "checked",
        result: body as PolicyComparison,
        url: checked.url,
        policyType: baseline.policyType ?? policyType,
        baselineCapturedAt: capturedAtOf(baseline.snapshot),
      });
    } catch {
      setState({ name: "failed", mode: "check", failure: connectionFailure() });
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (file.size > 10 * 1024 * 1024) {
      setFileError("That file is too large to be a DiffNexa baseline.");
      setBaseline(null);
      return;
    }
    const read = readBaselineFile(await file.text());
    if (!read.ok) {
      setFileError(read.message);
      setBaseline(null);
      return;
    }
    setBaseline({ name: file.name, snapshot: read.snapshot, policyType: read.policyType, url: read.url });
    // The file records which page it belongs to, so the form fills itself in.
    if (read.policyType) setPolicyType(read.policyType);
    if (read.url && url.trim() === "") setUrl(read.url);
  }

  function download(file: PolicyBaselineFile) {
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = baselineFilename(file);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  const working = state.name === "working";

  return (
    <>
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <div className="border-b border-rule p-4 md:p-5">
          <Tabs
            label="What would you like to do?"
            active={mode}
            onSelect={(next) => {
              setMode(next as Mode);
              setState({ name: "idle" });
            }}
            tabs={[
              { id: "capture", label: "Capture a policy" },
              { id: "check", label: "Check for changes" },
            ]}
          />
        </div>

        <div className="space-y-4 p-4 md:p-5">
          {mode === "capture" ? (
            <p className="max-w-prose text-ink-soft">
              Capture a policy or terms page as it reads today. DiffNexa saves what it says to a
              small file you keep — your baseline. Come back whenever you like, upload that file,
              and see exactly what changed.
            </p>
          ) : (
            <p className="max-w-prose text-ink-soft">
              Enter the same address and upload the baseline file you saved earlier. DiffNexa
              reads the page again and shows what is different, and which part of the document
              each change sits in.
            </p>
          )}

          <TextField
            label="Policy page address"
            hint="For example, example.com/privacy"
            placeholder="example.com/privacy"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={url}
            error={urlError}
            onChange={(event) => {
              setUrl(event.target.value);
              if (urlError) setUrlError(null);
            }}
          />

          <Select
            label="What kind of document is this?"
            hint="Your own label for the page. It does not change how the page is read."
            options={POLICY_TYPES}
            value={policyType}
            onChange={(event) => setPolicyType(event.target.value)}
          />

          {mode === "check" && (
            <div>
              <p className="text-[0.9rem] font-medium">Your baseline file</p>
              <p className="mt-0.5 text-[0.82rem] text-ink-soft">
                The file you downloaded when you captured this page.
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  id="policy-baseline-file"
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
                <label
                  htmlFor="policy-baseline-file"
                  className="cursor-pointer rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.9rem] font-medium hover:bg-surface"
                >
                  Choose baseline file
                </label>
                <span className="text-[0.9rem] text-ink-soft">
                  {baseline ? baseline.name : "No file chosen"}
                </span>
              </div>
              {fileError && (
                <p role="alert" className="mt-1 text-[0.85rem] text-removed">
                  <span className="font-semibold">Problem: </span>
                  {fileError}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={mode === "capture" ? capture : check} disabled={working}>
              {working
                ? mode === "capture"
                  ? "Capturing…"
                  : "Checking…"
                : mode === "capture"
                  ? "Capture baseline"
                  : "Check this page now"}
            </Button>
            <p className="text-[0.85rem] text-ink-soft" role="status" aria-live="polite">
              {working
                ? "Working on it — progress is shown below."
                : mode === "capture"
                  ? "This is the starting point for future checks."
                  : "You need the baseline file you saved earlier."}
            </p>
          </div>

          <p className="text-[0.8rem] text-ink-soft">
            DiffNexa reads the page and discards it once your result is ready. Nothing about the
            page is stored, there is no account, and nothing is sent to any AI service. DiffNexa
            reports what changed, not what it means — it does not give legal advice.
          </p>
        </div>
      </div>

      {state.name === "working" && <WebProcessing stage={state.stage} mode={state.mode} />}

      {state.name === "failed" && (
        <WebError failure={state.failure} onRetry={state.mode === "capture" ? capture : check} />
      )}

      {state.name === "captured" && (
        <section
          aria-labelledby="policy-baseline-heading"
          className="mt-6 rounded-[var(--radius-panel)] border border-rule bg-paper p-4 md:p-5"
        >
          <p className="text-[0.82rem] font-medium text-added">Baseline captured</p>
          <h2 id="policy-baseline-heading" className="mt-1 text-[1.25rem] font-semibold">
            {state.baseline.title || state.baseline.url.replace(/^https?:\/\//, "")}
          </h2>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-[0.9rem] sm:grid-cols-[9rem_1fr]">
            <dt className="text-ink-soft">Document</dt>
            <dd>{policyTypeLabel(state.baseline.policyType)}</dd>
            <dt className="text-ink-soft">Address</dt>
            <dd className="break-all">{state.baseline.url}</dd>
            <dt className="text-ink-soft">Captured</dt>
            <dd>{formatCapturedAt(state.baseline.capturedAt)}</dd>
            <dt className="text-ink-soft">Reference</dt>
            <dd className="tabular break-all text-[0.82rem]">
              {String(state.baseline.snapshot.content_sha256 ?? "").slice(0, 16)}
            </dd>
          </dl>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => download(state.baseline)}>Download baseline</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setMode("check");
                setState({ name: "idle" });
              }}
            >
              Check this page later
            </Button>
          </div>

          <Alert tone="note" title="Keep this file — you will need it">
            The baseline is a small file on your computer, not an account. DiffNexa stores nothing
            about this page. When you want to know what has changed, come back, enter the same
            address and upload this file.
          </Alert>
        </section>
      )}

      {state.name === "checked" && (
        <PolicyReport
          result={state.result}
          url={state.url}
          policyType={state.policyType}
          baselineCapturedAt={state.baselineCapturedAt}
        />
      )}
    </>
  );
}

function capturedAtOf(snapshot: Record<string, unknown>): string | null {
  const source = snapshot.source as { fetched_at?: string } | undefined;
  return source?.fetched_at ?? null;
}

function unknownFailure(): WebFailure {
  return { code: "unknown", message: "That didn't work. Please try again." };
}

function connectionFailure(): WebFailure {
  return {
    code: "engine_unavailable",
    message: "DiffNexa couldn't be reached. Check your connection and try again.",
  };
}

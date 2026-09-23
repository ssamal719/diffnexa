"use client";

import { useRef, useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { TextField } from "@/components/ui/TextField";
import { WebError } from "@/components/website/WebError";
import { WebProcessing, type WebStage } from "@/components/website/WebProcessing";
import { WebReport } from "@/components/website/WebReport";
import { SEAL_HEADER } from "@/lib/analysis";
import {
  baselineFilename,
  checkUrl,
  describePage,
  formatCapturedAt,
  type Baseline,
  type WebComparison,
  type WebFailure,
} from "@/lib/web-report";

type Mode = "capture" | "compare";

type State =
  | { name: "idle" }
  | { name: "working"; mode: Mode; stage: WebStage }
  | { name: "captured"; baseline: Baseline }
  | { name: "compared"; result: WebComparison; url: string; seal: string | null }
  | { name: "failed"; failure: WebFailure; mode: Mode };

/**
 * The whole tool: capture a baseline, or compare a page against one.
 *
 * The two jobs are separated at the top rather than combined into one form,
 * because a first-time visitor is doing the first and a returning one is doing
 * the second, and each is simpler alone. Nothing here mentions how any of it
 * works — there is no snapshot model, no engine, no API in the wording.
 */
export function WebsiteDesk() {
  const [mode, setMode] = useState<Mode>("capture");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [baselineFile, setBaselineFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ name: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setState({ name: "idle" });
  }

  async function capture() {
    const checked = checkUrl(url);
    if (!checked.ok) {
      setUrlError(checked.message);
      return;
    }
    setUrlError(null);
    setState({ name: "working", mode: "capture", stage: "validating" });

    try {
      setState({ name: "working", mode: "capture", stage: "fetching" });
      const response = await fetch("/api/web/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", mode: "capture", failure: body?.error ?? fallbackFailure() });
        return;
      }
      setState({ name: "working", mode: "capture", stage: "preparing" });
      setState({ name: "captured", baseline: body.snapshot as Baseline });
    } catch {
      setState({ name: "failed", mode: "capture", failure: connectionFailure() });
    }
  }

  async function compare() {
    const checked = checkUrl(url);
    if (!checked.ok) {
      setUrlError(checked.message);
      return;
    }
    if (!baselineFile) {
      setFileError("Choose the baseline file you downloaded for this page.");
      return;
    }
    setUrlError(null);
    setFileError(null);

    let previous: unknown;
    try {
      previous = JSON.parse(baselineFile.text);
    } catch {
      setFileError("That file isn't a DiffNexa baseline. Choose the file you downloaded.");
      return;
    }

    setState({ name: "working", mode: "compare", stage: "fetching" });
    try {
      const response = await fetch("/api/web/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url, previous_snapshot: previous }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", mode: "compare", failure: body?.error ?? fallbackFailure() });
        return;
      }
      setState({ name: "working", mode: "compare", stage: "preparing" });
      // The seal lets this result be sent for AI analysis later, if the person asks.
      const seal = response.headers?.get?.(SEAL_HEADER) ?? null;
      setState({ name: "compared", result: body as WebComparison, url: checked.url, seal });
    } catch {
      setState({ name: "failed", mode: "compare", failure: connectionFailure() });
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (file.size > 10 * 1024 * 1024) {
      setFileError("That file is too large to be a DiffNexa baseline.");
      setBaselineFile(null);
      return;
    }
    setBaselineFile({ name: file.name, text: await file.text() });
  }

  function download(baseline: Baseline) {
    const blob = new Blob([JSON.stringify(baseline, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = baselineFilename(baseline);
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
              reset();
            }}
            tabs={[
              { id: "capture", label: "Capture a page" },
              { id: "compare", label: "Check for changes" },
            ]}
          />
        </div>

        <div className="space-y-4 p-4 md:p-5">
          {mode === "capture" ? (
            <p className="max-w-prose text-ink-soft">
              Capture the page as it is today. DiffNexa saves what it says to a small file you keep
              — your baseline. Come back any time, upload that file, and see what has changed since.
            </p>
          ) : (
            <p className="max-w-prose text-ink-soft">
              Enter the same address and upload the baseline file you saved earlier. DiffNexa reads
              the page again and shows you what is different.
            </p>
          )}

          <TextField
            label="Web page address"
            hint="For example, example.com/pricing"
            placeholder="example.com/pricing"
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

          {mode === "compare" && (
            <div>
              <p className="text-[0.9rem] font-medium">Your baseline file</p>
              <p className="mt-0.5 text-[0.82rem] text-ink-soft">
                The file you downloaded when you captured this page.
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  id="baseline-file"
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
                <label
                  htmlFor="baseline-file"
                  className="cursor-pointer rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.9rem] font-medium hover:bg-surface"
                >
                  Choose baseline file
                </label>
                <span className="text-[0.9rem] text-ink-soft">
                  {baselineFile ? baselineFile.name : "No file chosen"}
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
            <Button onClick={mode === "capture" ? capture : compare} disabled={working}>
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
            DiffNexa reads the page and discards it once the result is ready. Nothing about the
            page is stored, and the comparison sends nothing to any AI service.
          </p>
        </div>
      </div>

      {state.name === "working" && <WebProcessing stage={state.stage} mode={state.mode} />}

      {state.name === "failed" && (
        <WebError
          failure={state.failure}
          onRetry={state.mode === "capture" ? capture : compare}
        />
      )}

      {state.name === "captured" && (
        <section
          aria-labelledby="baseline-heading"
          className="mt-6 rounded-[var(--radius-panel)] border border-rule bg-paper p-4 md:p-5"
        >
          <p className="text-[0.82rem] font-medium text-added">Baseline captured</p>
          <h2 id="baseline-heading" className="mt-1 text-[1.25rem] font-semibold">
            {describePage(state.baseline)}
          </h2>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-[0.9rem] sm:grid-cols-[8rem_1fr]">
            <dt className="text-ink-soft">Address</dt>
            <dd className="break-all">{state.baseline.source.final_url}</dd>
            <dt className="text-ink-soft">Captured</dt>
            <dd>{formatCapturedAt(state.baseline.source.fetched_at)}</dd>
          </dl>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => download(state.baseline)}>Download baseline</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setMode("compare");
                reset();
              }}
            >
              Check this page later
            </Button>
          </div>

          <Alert tone="note" title="Keep this file safe">
            The baseline is a small file on your computer, not an account. Nothing is stored by
            DiffNexa. When you want to know what has changed, come back, enter the same address and
            upload this file.
          </Alert>
        </section>
      )}

      {state.name === "compared" && (
        <ReportWithAnalyst tool="web" result={state.result} seal={state.seal}>
          {({ analyst, focus, analysis }) => (
            <WebReport result={state.result} url={state.url} analyst={analyst} analysis={analysis} focus={focus} />
          )}
        </ReportWithAnalyst>
      )}
    </>
  );
}

function fallbackFailure(): WebFailure {
  return { code: "unknown", message: "That didn't work. Please try again." };
}

function connectionFailure(): WebFailure {
  return {
    code: "engine_unavailable",
    message: "DiffNexa couldn't be reached. Check your connection and try again.",
  };
}

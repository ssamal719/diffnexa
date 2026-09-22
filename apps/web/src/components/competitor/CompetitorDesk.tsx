"use client";

import { useState } from "react";

import { CompetitorReport } from "@/components/competitor/CompetitorReport";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { TextField } from "@/components/ui/TextField";
import { WebError } from "@/components/website/WebError";
import { WebProcessing, type WebStage } from "@/components/website/WebProcessing";
import {
  COMPETITOR_ERRORS,
  MAX_COMPETITOR_NAME,
  PAGE_TYPES,
  baselineFilename,
  buildBaselineFile,
  cleanCompetitorName,
  fallbackCompetitorName,
  pageTypeLabel,
  readBaselineFile,
  type CapturedSnapshot,
  type CompetitorBaselineFile,
  type CompetitorComparison,
} from "@/lib/competitor-report";
import { checkUrl, formatCapturedAt, type WebFailure } from "@/lib/web-report";

type Mode = "capture" | "check";

type State =
  | { name: "idle" }
  | { name: "working"; mode: "capture" | "compare"; stage: WebStage }
  | { name: "captured"; baseline: CompetitorBaselineFile }
  | {
      name: "checked";
      result: CompetitorComparison;
      url: string;
      competitor: string;
      pageType: string;
      baselineCapturedAt: string | null;
    }
  | { name: "failed"; failure: WebFailure; mode: Mode };

type ChosenBaseline = {
  name: string;
  snapshot: Record<string, unknown>;
  capturedAt: string | null;
};

/**
 * Capture a competitor's page, or check it against a baseline you kept.
 *
 * The two jobs are separated at the top because a first-time visitor is doing
 * one and a returning visitor the other. Nothing suggests the page is being
 * watched: you check when you choose to.
 *
 * The competitor's name and the page type are your labels. They go into the
 * baseline file you download and into your report, and are never sent to the
 * server.
 */
export function CompetitorDesk() {
  const [mode, setMode] = useState<Mode>("capture");
  const [competitor, setCompetitor] = useState("");
  const [url, setUrl] = useState("");
  const [pageType, setPageType] = useState<string>(PAGE_TYPES[1].id);
  const [nameError, setNameError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<ChosenBaseline | null>(null);
  const [state, setState] = useState<State>({ name: "idle" });

  async function capture() {
    const name = cleanCompetitorName(competitor);
    const checked = checkUrl(url);
    setNameError(name ? null : "Enter a name for this competitor, such as the company or product.");
    setUrlError(checked.ok ? null : checked.message);
    if (!name || !checked.ok) return;

    setState({ name: "working", mode: "capture", stage: "fetching" });
    try {
      const response = await fetch("/api/competitor/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", mode: "capture", failure: body?.error ?? unknownFailure() });
        return;
      }
      setState({
        name: "captured",
        baseline: buildBaselineFile(body.snapshot as CapturedSnapshot, name, pageType),
      });
    } catch {
      setState({ name: "failed", mode: "capture", failure: connectionFailure() });
    }
  }

  async function check() {
    const checked = checkUrl(url);
    setUrlError(checked.ok ? null : checked.message);
    if (!baseline) setFileError("Choose the baseline file you downloaded for this page.");
    if (!checked.ok || !baseline) return;
    setFileError(null);

    setState({ name: "working", mode: "compare", stage: "fetching" });
    try {
      const response = await fetch("/api/competitor/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url, previous_snapshot: baseline.snapshot }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", mode: "check", failure: body?.error ?? unknownFailure() });
        return;
      }
      setState({
        name: "checked",
        result: body as CompetitorComparison,
        url: checked.url,
        competitor: cleanCompetitorName(competitor) || fallbackCompetitorName(checked.url),
        pageType,
        baselineCapturedAt: baseline.capturedAt,
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
    setBaseline({ name: file.name, snapshot: read.snapshot, capturedAt: read.capturedAt });
    // The file records what it belongs to, so the form fills itself in.
    if (read.competitor) setCompetitor(read.competitor);
    if (read.pageType) setPageType(read.pageType);
    if (read.url && url.trim() === "") setUrl(read.url);
  }

  function download(file: CompetitorBaselineFile) {
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
              { id: "capture", label: "Capture a baseline" },
              { id: "check", label: "Check for changes" },
            ]}
          />
        </div>

        <div className="space-y-4 p-4 md:p-5">
          {mode === "capture" ? (
            <p className="max-w-prose text-ink-soft">
              Capture a competitor&apos;s public page as it reads today. DiffNexa saves what it
              says to a small file you keep — your baseline. Come back whenever you like, upload
              that file, and see exactly what changed.
            </p>
          ) : (
            <p className="max-w-prose text-ink-soft">
              Enter the same address and upload the baseline file you saved earlier. DiffNexa
              reads the page again and shows what is different, grouped by the kind of content
              that changed.
            </p>
          )}

          <TextField
            label="Competitor"
            hint={
              mode === "capture"
                ? "Your own label, such as the company or product name."
                : "Filled in from your baseline file. Your own label."
            }
            placeholder="Acme"
            autoComplete="off"
            maxLength={MAX_COMPETITOR_NAME}
            value={competitor}
            error={nameError}
            onChange={(event) => {
              setCompetitor(event.target.value);
              if (nameError) setNameError(null);
            }}
          />

          <TextField
            label="Page address"
            hint="A public page, for example acme.com/pricing"
            placeholder="acme.com/pricing"
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
            label="Page type"
            hint="Your own label for the page. It does not change how the page is read."
            options={PAGE_TYPES}
            value={pageType}
            onChange={(event) => setPageType(event.target.value)}
          />

          {mode === "check" && (
            <div>
              <p className="text-[0.9rem] font-medium">Your baseline file</p>
              <p className="mt-0.5 text-[0.82rem] text-ink-soft">
                The .diffnexa-snapshot.json file you downloaded when you captured this page.
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <input
                  id="competitor-baseline-file"
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
                <label
                  htmlFor="competitor-baseline-file"
                  className="cursor-pointer rounded-[3px] border border-rule-strong bg-paper px-3 py-1.5 text-[0.9rem] font-medium hover:bg-surface"
                >
                  Choose baseline file
                </label>
                <span className="break-all text-[0.9rem] text-ink-soft">
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
            DiffNexa reads the page once and discards it when your result is ready. Nothing about
            the page is stored, there is no account, and nothing is sent to any AI service.
            DiffNexa reports what changed on the page, not what it means.
          </p>
        </div>
      </div>

      {state.name === "working" && <WebProcessing stage={state.stage} mode={state.mode} />}

      {state.name === "failed" && (
        <WebError
          failure={state.failure}
          onRetry={state.mode === "capture" ? capture : check}
          explanations={COMPETITOR_ERRORS}
        />
      )}

      {state.name === "captured" && (
        <section
          aria-labelledby="competitor-baseline-heading"
          className="mt-6 rounded-[var(--radius-panel)] border border-rule bg-paper p-4 md:p-5"
        >
          <p className="text-[0.82rem] font-medium text-added">Baseline captured</p>
          <h2 id="competitor-baseline-heading" className="mt-1 text-[1.25rem] font-semibold">
            {state.baseline.competitor}
          </h2>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-[0.9rem] sm:grid-cols-[9rem_1fr]">
            <dt className="text-ink-soft">Page</dt>
            <dd className="break-all">
              {state.baseline.title ? `${state.baseline.title} — ` : ""}
              {state.baseline.url}
            </dd>
            <dt className="text-ink-soft">Page type</dt>
            <dd>{pageTypeLabel(state.baseline.pageType)}</dd>
            <dt className="text-ink-soft">Captured</dt>
            <dd>{formatCapturedAt(state.baseline.capturedAt)}</dd>
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
        <CompetitorReport
          result={state.result}
          url={state.url}
          competitor={state.competitor}
          pageType={state.pageType}
          baselineCapturedAt={state.baselineCapturedAt}
        />
      )}
    </>
  );
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

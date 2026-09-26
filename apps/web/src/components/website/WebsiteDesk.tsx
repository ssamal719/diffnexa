"use client";

import { useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { ExampleGuide } from "@/components/examples/ExampleGuide";
import { TextField } from "@/components/ui/TextField";
import { MonitorDesk, type DeskBaseline } from "@/components/website/MonitorDesk";
import { WebError } from "@/components/website/WebError";
import { WebProcessing, type WebStage } from "@/components/website/WebProcessing";
import { WebReport } from "@/components/website/WebReport";
import { SEAL_HEADER } from "@/lib/analysis";
import { EXAMPLE_GUIDES, EXAMPLE_PAGES } from "@/lib/examples";
import {
  baselineFilename,
  checkUrl,
  describePage,
  type Baseline,
  type WebComparison,
  type WebFailure,
} from "@/lib/web-report";

type Job = "capture" | "compare";

type State =
  | { name: "idle" }
  | { name: "working"; job: Job; stage: WebStage }
  | { name: "compared"; run: number; result: WebComparison; url: string; seal: string | null; example: boolean }
  | { name: "failed"; failure: WebFailure; job: Job };

/** The baseline in hand: the capture itself, and how it came to be here. */
type Held = { snapshot: Baseline; fileName: string; justCaptured: boolean };

/**
 * The whole tool: a baseline on the left, the page now on the right, and one
 * button to compare them.
 *
 * A first-time visitor captures a baseline from the address on the right and
 * keeps the file; a returning one drops that file on the left. Nothing here
 * mentions how any of it works — there is no snapshot model, no engine, no API
 * in the wording.
 */
export function WebsiteDesk() {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ name: "idle" });
  const [runs, setRuns] = useState(0);

  function finished(result: WebComparison, pageUrl: string, seal: string | null, example: boolean) {
    const run = runs + 1;
    setRuns(run);
    setState({ name: "compared", run, result, url: pageUrl, seal, example });
  }

  async function capture() {
    const checked = checkUrl(url);
    if (!checked.ok) {
      setUrlError(checked.message);
      return;
    }
    setUrlError(null);
    setState({ name: "working", job: "capture", stage: "fetching" });
    try {
      const response = await fetch("/api/web/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", job: "capture", failure: body?.error ?? fallbackFailure() });
        return;
      }
      const snapshot = body.snapshot as Baseline;
      setHeld({ snapshot, fileName: baselineFilename(snapshot), justCaptured: true });
      setFileError(null);
      setState({ name: "idle" });
    } catch {
      setState({ name: "failed", job: "capture", failure: connectionFailure() });
    }
  }

  async function compare() {
    const checked = checkUrl(url);
    setUrlError(checked.ok ? null : checked.message);
    if (!held) setFileError("Choose the baseline file you saved for this page, or capture one first.");
    if (!checked.ok || !held) return;
    setFileError(null);

    setState({ name: "working", job: "compare", stage: "fetching" });
    try {
      const response = await fetch("/api/web/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url, previous_snapshot: held.snapshot }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", job: "compare", failure: body?.error ?? fallbackFailure() });
        return;
      }
      setState({ name: "working", job: "compare", stage: "preparing" });
      // The seal lets this result be sent for AI analysis later, if the person asks.
      finished(body as WebComparison, checked.url, response.headers?.get?.(SEAL_HEADER) ?? null, false);
    } catch {
      setState({ name: "failed", job: "compare", failure: connectionFailure() });
    }
  }

  /** The built-in example: two saved versions of a fictional page, compared by the engine. Nothing is fetched. */
  async function tryExample() {
    setState({ name: "working", job: "compare", stage: "comparing" });
    const response = await fetch("/api/web/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ example: true }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || !body) {
      setState({ name: "failed", job: "compare", failure: body?.error ?? connectionFailure() });
      return;
    }
    finished(body as WebComparison, EXAMPLE_PAGES.web.url, response.headers?.get?.(SEAL_HEADER) ?? null, true);
  }

  async function chooseFile(file: File) {
    setFileError(null);
    if (file.size > 10 * 1024 * 1024) {
      setFileError("That file is too large to be a DiffNexa baseline.");
      return;
    }
    let snapshot: Baseline;
    try {
      snapshot = JSON.parse(await file.text()) as Baseline;
      if (!snapshot?.source?.url) throw new Error("not a baseline");
    } catch {
      setFileError("That file isn't a DiffNexa baseline. Choose the file you downloaded.");
      return;
    }
    setHeld({ snapshot, fileName: file.name, justCaptured: false });
    // The file records which page it belongs to, so the address fills itself in.
    if (url.trim() === "") setUrl(snapshot.source.url);
  }

  function download(snapshot: Baseline) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = baselineFilename(snapshot);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  const working = state.name === "working";
  const baseline: DeskBaseline | null = held
    ? {
        name: held.fileName,
        capturedAt: held.snapshot.source?.fetched_at ?? null,
        justCaptured: held.justCaptured,
        details: [{ label: "Page", value: describePage(held.snapshot) }],
      }
    : null;

  return (
    <>
      <MonitorDesk
        fileInputId="baseline-file"
        pageFields={
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
        }
        baseline={baseline}
        fileError={fileError}
        onChooseFile={(file) => void chooseFile(file)}
        onRemoveBaseline={() => setHeld(null)}
        onCapture={capture}
        onDownload={() => held && download(held.snapshot)}
        onCheck={compare}
        working={working}
        capturing={working && state.job === "capture"}
        checking={working && state.job === "compare"}
        status={statusLine(state, held)}
        example={{
          note: "Compares two saved versions of a fictional service agreement page — no address, no account and no baseline of your own needed.",
          onTry: tryExample,
        }}
        footnote="DiffNexa reads the page and discards it once the result is ready. Nothing about the page is stored, and the comparison sends nothing to any AI service."
      />

      {state.name === "working" && <WebProcessing stage={state.stage} mode={state.job} />}

      {state.name === "failed" && <WebError failure={state.failure} onRetry={state.job === "capture" ? capture : compare} />}

      {state.name === "compared" && state.example && <ExampleGuide guide={EXAMPLE_GUIDES.web} />}
      {state.name === "compared" && (
        <ReportWithAnalyst key={state.run} tool="web" result={state.result} seal={state.seal}>
          {({ analyst, focus, analysis }) => (
            <WebReport result={state.result} url={state.url} analyst={analyst} analysis={analysis} focus={focus} />
          )}
        </ReportWithAnalyst>
      )}
    </>
  );
}

function statusLine(state: State, held: Held | null): string {
  if (state.name === "working") return "Working on it — progress is shown below.";
  if (state.name === "compared") return "Your result is ready below.";
  if (held?.justCaptured) return "Baseline captured. Download it, then check back whenever you like.";
  if (held) return "Ready to check the page against your baseline.";
  return "Add a baseline: choose the file you saved, or capture the page now.";
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

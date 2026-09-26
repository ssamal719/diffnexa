"use client";

import { useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { ExampleGuide } from "@/components/examples/ExampleGuide";
import { PolicyReport } from "@/components/policy/PolicyReport";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { MonitorDesk, type DeskBaseline } from "@/components/website/MonitorDesk";
import { WebError } from "@/components/website/WebError";
import { WebProcessing, type WebStage } from "@/components/website/WebProcessing";
import { SEAL_HEADER } from "@/lib/analysis";
import { EXAMPLE_BASELINE_AT, EXAMPLE_GUIDES, EXAMPLE_PAGES } from "@/lib/examples";
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
import { checkUrl, type WebFailure } from "@/lib/web-report";

type Job = "capture" | "compare";

type State =
  | { name: "idle" }
  | { name: "working"; job: Job; stage: WebStage }
  | {
      name: "checked";
      run: number;
      result: PolicyComparison;
      seal: string | null;
      url: string;
      policyType: string | null;
      baselineCapturedAt: string | null;
      example: boolean;
    }
  | { name: "failed"; failure: WebFailure; job: Job };

/** The baseline in hand: a file chosen, or a page captured just now and not yet downloaded. */
type Held = {
  fileName: string;
  snapshot: Record<string, unknown>;
  policyType: string | null;
  title: string | null;
  /** Set when captured here: the file to download. */
  captured: PolicyBaselineFile | null;
};

/**
 * A baseline of a policy page on the left, the page now on the right, and one
 * button to compare them.
 *
 * Nothing here mentions how any of it works, and nothing suggests the page is
 * being watched: you check when you choose to.
 */
export function PolicyDesk() {
  const [url, setUrl] = useState("");
  const [policyType, setPolicyType] = useState<string>(POLICY_TYPES[0].id);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [state, setState] = useState<State>({ name: "idle" });
  const [runs, setRuns] = useState(0);

  function nextRun(): number {
    const run = runs + 1;
    setRuns(run);
    return run;
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
      const response = await fetch("/api/policy/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", job: "capture", failure: body?.error ?? unknownFailure() });
        return;
      }
      const file = buildBaselineFile(body.snapshot as CapturedSnapshot, policyType);
      setHeld({
        fileName: baselineFilename(file),
        snapshot: file.snapshot,
        policyType: file.policyType,
        title: file.title,
        captured: file,
      });
      setFileError(null);
      setState({ name: "idle" });
    } catch {
      setState({ name: "failed", job: "capture", failure: connectionFailure() });
    }
  }

  async function check() {
    const checked = checkUrl(url);
    setUrlError(checked.ok ? null : checked.message);
    if (!held) setFileError("Choose the baseline file you saved for this page, or capture one first.");
    if (!checked.ok || !held) return;
    setFileError(null);
    setState({ name: "working", job: "compare", stage: "fetching" });

    try {
      const response = await fetch("/api/policy/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url, previous_snapshot: held.snapshot }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", job: "compare", failure: body?.error ?? unknownFailure() });
        return;
      }
      // The seal lets this result be sent for AI analysis later, if the person asks.
      const seal = response.headers?.get?.(SEAL_HEADER) ?? null;
      setState({
        name: "checked",
        run: nextRun(),
        result: body as PolicyComparison,
        seal,
        url: checked.url,
        policyType: held.policyType ?? policyType,
        baselineCapturedAt: capturedAtOf(held.snapshot),
        example: false,
      });
    } catch {
      setState({ name: "failed", job: "compare", failure: connectionFailure() });
    }
  }

  /** The built-in example: two saved versions of fictional terms, compared by the engine. Nothing is fetched. */
  async function tryExample() {
    setState({ name: "working", job: "compare", stage: "comparing" });
    const response = await fetch("/api/policy/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ example: true }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || !body) {
      setState({ name: "failed", job: "compare", failure: body?.error ?? connectionFailure() });
      return;
    }
    setState({
      name: "checked",
      run: nextRun(),
      result: body as PolicyComparison,
      seal: response.headers?.get?.(SEAL_HEADER) ?? null,
      url: EXAMPLE_PAGES.policy.url,
      policyType: EXAMPLE_PAGES.policy.policyType,
      baselineCapturedAt: EXAMPLE_BASELINE_AT,
      example: true,
    });
  }

  async function chooseFile(file: File) {
    setFileError(null);
    if (file.size > 10 * 1024 * 1024) {
      setFileError("That file is too large to be a DiffNexa baseline.");
      return;
    }
    const read = readBaselineFile(await file.text());
    if (!read.ok) {
      setFileError(read.message);
      return;
    }
    const title = (read.snapshot.metadata as { title?: string | null } | undefined)?.title ?? null;
    setHeld({ fileName: file.name, snapshot: read.snapshot, policyType: read.policyType, title, captured: null });
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
  const baseline: DeskBaseline | null = held
    ? {
        name: held.fileName,
        capturedAt: capturedAtOf(held.snapshot),
        justCaptured: held.captured !== null,
        details: [
          ...(held.title ? [{ label: "Page", value: held.title }] : []),
          ...(held.policyType ? [{ label: "Document", value: policyTypeLabel(held.policyType) }] : []),
        ],
      }
    : null;

  return (
    <>
      <MonitorDesk
        fileInputId="policy-baseline-file"
        pageTitle="Policy page to check"
        pageFields={
          <>
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
          </>
        }
        baseline={baseline}
        fileError={fileError}
        onChooseFile={(file) => void chooseFile(file)}
        onRemoveBaseline={() => setHeld(null)}
        onCapture={capture}
        onDownload={() => held?.captured && download(held.captured)}
        onCheck={check}
        working={working}
        capturing={working && state.job === "capture"}
        checking={working && state.job === "compare"}
        status={statusLine(state, held)}
        example={{
          note: "Compares two saved versions of a fictional company's terms of service — no address, no account and no baseline of your own needed.",
          onTry: tryExample,
        }}
        footnote="DiffNexa reads the page and discards it once your result is ready. Nothing about the page is stored, there is no account, and the comparison sends nothing to any AI service. DiffNexa reports what changed, not what it means — it does not give legal advice."
      />

      {state.name === "working" && <WebProcessing stage={state.stage} mode={state.job} />}

      {state.name === "failed" && <WebError failure={state.failure} onRetry={state.job === "capture" ? capture : check} />}

      {state.name === "checked" && state.example && <ExampleGuide guide={EXAMPLE_GUIDES.policy} />}
      {state.name === "checked" && (
        <ReportWithAnalyst key={state.run} tool="policy" result={state.result} seal={state.seal}>
          {({ analyst, focus, analysis }) => (
            <PolicyReport
              result={state.result}
              url={state.url}
              policyType={state.policyType}
              baselineCapturedAt={state.baselineCapturedAt}
              analyst={analyst}
              analysis={analysis}
              focus={focus}
            />
          )}
        </ReportWithAnalyst>
      )}
    </>
  );
}

function statusLine(state: State, held: Held | null): string {
  if (state.name === "working") return "Working on it — progress is shown below.";
  if (state.name === "checked") return "Your result is ready below.";
  if (held?.captured) return "Baseline captured. Download it, then check back whenever you like.";
  if (held) return "Ready to check the page against your baseline.";
  return "Add a baseline: choose the file you saved, or capture the page now.";
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

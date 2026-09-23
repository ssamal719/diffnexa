"use client";

import { useState } from "react";

import { ReportWithAnalyst } from "@/components/analysis/ReportWithAnalyst";
import { PriceReport } from "@/components/price/PriceReport";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { TextField } from "@/components/ui/TextField";
import { WebError } from "@/components/website/WebError";
import { WebProcessing, type WebStage } from "@/components/website/WebProcessing";
import { SEAL_HEADER } from "@/lib/analysis";
import {
  MAX_PRODUCT_NAME,
  PAGE_TYPES,
  PRICE_ERRORS,
  baselineFilename,
  buildBaselineFile,
  cleanProductName,
  fallbackProductName,
  pageTypeLabel,
  readBaselineFile,
  type CapturedSnapshot,
  type PriceBaselineFile,
  type PriceComparison,
} from "@/lib/price-report";
import { checkUrl, formatCapturedAt, type WebFailure } from "@/lib/web-report";

type Mode = "capture" | "check";

type State =
  | { name: "idle" }
  | { name: "working"; mode: "capture" | "compare"; stage: WebStage }
  | { name: "captured"; baseline: PriceBaselineFile }
  | {
      name: "checked";
      result: PriceComparison;
      seal: string | null;
      url: string;
      product: string;
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
 * Capture a pricing or product page, or check it against a baseline you kept.
 *
 * The two jobs are separated at the top because a first-time visitor is doing
 * one and a returning visitor the other. Nothing suggests the page is being
 * watched or that prices are tracked automatically: you check when you choose to.
 *
 * The product name and the page type are your labels. They go into the
 * baseline file you download and into your report, and are never sent to the
 * server.
 */
export function PriceDesk() {
  const [mode, setMode] = useState<Mode>("capture");
  const [product, setProduct] = useState("");
  const [url, setUrl] = useState("");
  const [pageType, setPageType] = useState<string>(PAGE_TYPES[0].id);
  const [nameError, setNameError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<ChosenBaseline | null>(null);
  const [state, setState] = useState<State>({ name: "idle" });

  async function capture() {
    const name = cleanProductName(product);
    const checked = checkUrl(url);
    setNameError(name ? null : "Enter a name for this product or service.");
    setUrlError(checked.ok ? null : checked.message);
    if (!name || !checked.ok) return;

    setState({ name: "working", mode: "capture", stage: "fetching" });
    try {
      const response = await fetch("/api/price/snapshot", {
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
      const response = await fetch("/api/price/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checked.url, previous_snapshot: baseline.snapshot }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ name: "failed", mode: "check", failure: body?.error ?? unknownFailure() });
        return;
      }
      // The seal lets this result be sent for AI analysis later, if the person asks.
      const seal = response.headers?.get?.(SEAL_HEADER) ?? null;
      setState({
        name: "checked",
        result: body as PriceComparison,
        seal,
        url: checked.url,
        product: cleanProductName(product) || fallbackProductName(checked.url),
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
    if (read.product) setProduct(read.product);
    if (read.pageType) setPageType(read.pageType);
    if (read.url && url.trim() === "") setUrl(read.url);
  }

  function download(file: PriceBaselineFile) {
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
              Capture a public pricing or product page as it reads today. DiffNexa saves what it
              says to a small file you keep — your baseline. Come back whenever you like, upload
              that file, and see exactly what changed.
            </p>
          ) : (
            <p className="max-w-prose text-ink-soft">
              Enter the same address and upload the baseline file you saved earlier. DiffNexa
              reads the page again and shows exactly what is different — prices, plans,
              availability and everything else — with the evidence for each change.
            </p>
          )}

          <TextField
            label="Product / service"
            hint="Your own label for this product or service."
            placeholder="GitHub Copilot"
            autoComplete="off"
            maxLength={MAX_PRODUCT_NAME}
            value={product}
            error={nameError}
            onChange={(event) => {
              setProduct(event.target.value);
              if (nameError) setNameError(null);
            }}
          />

          <TextField
            label="Page address"
            hint="A public page, for example example.com/pricing"
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
                  id="price-baseline-file"
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
                <label
                  htmlFor="price-baseline-file"
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
                  ? "Capture this page"
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
            DiffNexa reads the page once and discards it — and your baseline — when your result is
            ready. Nothing is stored, there is no account, and the comparison sends nothing to any AI service.
            DiffNexa reports what the page says, not whether a price is good or bad.
          </p>
        </div>
      </div>

      {state.name === "working" && <WebProcessing stage={state.stage} mode={state.mode} />}

      {state.name === "failed" && (
        <WebError
          failure={state.failure}
          onRetry={state.mode === "capture" ? capture : check}
          explanations={PRICE_ERRORS}
        />
      )}

      {state.name === "captured" && (
        <section
          aria-labelledby="price-baseline-heading"
          className="mt-6 rounded-[var(--radius-panel)] border border-rule bg-paper p-4 md:p-5"
        >
          <p className="text-[0.82rem] font-medium text-added">Baseline captured</p>
          <h2 id="price-baseline-heading" className="mt-1 text-[1.25rem] font-semibold">
            {state.baseline.product}
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
        <ReportWithAnalyst tool="price" result={state.result} seal={state.seal}>
          {({ analyst, focus, analysis }) => (
            <PriceReport
              result={state.result}
              url={state.url}
              product={state.product}
              pageType={state.pageType}
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

function unknownFailure(): WebFailure {
  return { code: "unknown", message: "That didn't work. Please try again." };
}

function connectionFailure(): WebFailure {
  return {
    code: "engine_unavailable",
    message: "DiffNexa couldn't be reached. Check your connection and try again.",
  };
}

"use client";

import { useEffect, useRef, useState } from "react";

import type { ProcessingStage } from "@/components/results/ProcessingState";
import { SEAL_HEADER } from "@/lib/analysis";

export type EngineStatus = { checked: boolean; available: boolean };

export type RunFailure = { code: string; message: string; side?: string | null };

export type RunPhase<R, F, E = RunFailure> =
  | { name: "idle" }
  | { name: "working"; stage: ProcessingStage; uploadPercent: number | null }
  | {
      name: "done";
      /** Which comparison this is. Every run gets a new one, so nothing from an earlier run is reused. */
      run: number;
      result: R;
      original: F;
      revised: F;
      seal: string | null;
      /** Whether the two files were the tool's built-in example. */
      example: boolean;
    }
  | { name: "failed"; error: E };

export type RunFiles<F> = { original: F; revised: F };

/**
 * Comparing two files: the request, its progress and its result.
 *
 * Shared by PDF, Word and Excel Compare. Every comparison — the first one,
 * Reverse, new Ignore options, the example — goes through `run`, which makes
 * exactly the request an ordinary upload makes. The upload uses
 * XMLHttpRequest rather than fetch because it reports real upload progress:
 * the percentage shown is bytes actually sent.
 */
export function useComparisonRun<R, F extends { file: File }, E extends RunFailure = RunFailure>({
  endpoint,
  fields,
  filenames,
}: {
  endpoint: string;
  /** The form fields for the two files, original first. */
  fields: readonly [string, string];
  /** The fixed names sent for the two files; the person's own names never leave the browser. */
  filenames: readonly [string, string];
}) {
  const [engine, setEngine] = useState<EngineStatus>({ checked: false, available: false });
  const [phase, setPhase] = useState<RunPhase<R, F, E>>({ name: "idle" });
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/engine-status")
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled) setEngine({ checked: true, available: Boolean(body.available) });
      })
      .catch(() => {
        if (!cancelled) setEngine({ checked: true, available: false });
      });
    return () => {
      cancelled = true;
      requestRef.current?.abort();
    };
  }, []);

  function run(files: RunFiles<F>, settings: Record<string, boolean> = {}, example = false) {
    requestRef.current?.abort();
    const { original, revised } = files;

    const form = new FormData();
    form.append(fields[0], original.file, filenames[0]);
    form.append(fields[1], revised.file, filenames[1]);
    for (const [name, value] of Object.entries(settings)) form.append(name, String(value));

    const request = new XMLHttpRequest();
    requestRef.current = request;
    setPhase({ name: "working", stage: "sending", uploadPercent: 0 });

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setPhase({ name: "working", stage: percent >= 100 ? "comparing" : "sending", uploadPercent: percent });
    });
    request.upload.addEventListener("load", () => {
      setPhase({ name: "working", stage: "comparing", uploadPercent: 100 });
    });

    request.addEventListener("load", () => {
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = null;
      }
      if (request.status >= 200 && request.status < 300 && body) {
        setPhase({ name: "working", stage: "preparing", uploadPercent: 100 });
        // The seal lets this result be sent for AI analysis later, if the person asks.
        const seal = request.getResponseHeader?.(SEAL_HEADER) ?? null;
        runRef.current += 1;
        const number = runRef.current;
        // A frame to paint the final stage before the report replaces it.
        requestAnimationFrame(() =>
          setPhase({ name: "done", run: number, result: body as R, original, revised, seal, example }),
        );
        return;
      }
      const error = (body as { error?: E } | null)?.error;
      setPhase({
        name: "failed",
        error: error ?? ({ code: "comparison_failed", message: "The comparison could not be completed." } as E),
      });
    });

    request.addEventListener("error", () => {
      setPhase({
        name: "failed",
        error: { code: "network", message: "The connection dropped before the comparison finished." } as E,
      });
    });
    request.addEventListener("abort", () => {
      if (requestRef.current === request) setPhase({ name: "idle" });
    });

    request.open("POST", endpoint);
    request.send(form);
  }

  /** Stops any comparison in progress and clears the result, so a result never lingers beside different files. */
  function cancel() {
    requestRef.current?.abort();
    setPhase({ name: "idle" });
  }

  return { engine, phase, run, cancel };
}

/** The line beside the compare button: what is needed next, or what is happening. */
export function runStatus(
  phase: { name: string },
  engine: EngineStatus,
  bothReady: boolean,
  things: string = "documents",
): string {
  if (phase.name === "working") return "Working on it — progress is shown below.";
  if (!bothReady) return `Add both ${things} to continue.`;
  if (!engine.checked) return "Checking the comparison service…";
  if (!engine.available) return "The comparison service is unavailable.";
  if (phase.name === "done") return "Your report is ready below.";
  return `Both ${things} are ready.`;
}

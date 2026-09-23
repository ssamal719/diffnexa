"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import {
  AI_DISCLOSURE,
  PROVIDER_NAMES,
  SIGNIFICANCE_LABELS,
  aiErrorMessage,
  analysisPayload,
  coverageSentences,
  withheldSentence,
  type AnalysedChange,
  type AnalysisFailure,
  type AnalysisTool,
  type ChangeAnalysis,
  type Significance,
} from "@/lib/analysis";

type Phase =
  | { name: "checking" }
  | { name: "unavailable" }
  | { name: "ready" }
  | { name: "running" }
  | { name: "done"; analysis: ChangeAnalysis }
  | { name: "failed"; error: AnalysisFailure };

/** Failures that trying again straight away could fix. */
const RETRYABLE = new Set(["ai_timeout", "ai_failed", "ai_invalid", "ai_busy", "ai_unavailable", "network"]);

const SIGNIFICANCE_STYLE: Record<Significance, string> = {
  important: "border-signal bg-signal-soft text-signal",
  notable: "border-rule-strong bg-surface text-ink",
  minor: "border-rule bg-paper text-ink-soft",
  unclear: "border-rule bg-paper text-ink-soft",
};

/**
 * AI Change Analyst, attached to a finished comparison.
 *
 * The comparison above stays the source of truth. This panel does nothing until
 * the person asks, sends only the comparison's changes and evidence (sealed by
 * the server when the comparison was made), and shows only statements the
 * engine checked against that evidence. Every explanation sits next to what the
 * comparison itself says, and links back to the change in the report.
 *
 * There is no chat and no free-text question: the analysis explains the
 * changes found, and nothing else.
 */
export function ChangeAnalyst({
  tool,
  result,
  seal,
  changeCount,
  onViewChange,
}: {
  tool: AnalysisTool;
  result: unknown;
  seal: string | null;
  /** Changes the person can see in the report; with none, there is nothing to analyse. */
  changeCount: number;
  onViewChange: (changeId: string) => void;
}) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>(seal ? { name: "checking" } : { name: "unavailable" });
  const [open, setOpen] = useState(true);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!seal) return;
    let cancelled = false;
    fetch("/api/ai/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled) setPhase(body?.available === true ? { name: "ready" } : { name: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setPhase({ name: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [seal]);

  if (changeCount === 0) return null;

  async function analyse() {
    if (inFlight.current || !seal) return; // one analysis at a time; a second click does nothing
    inFlight.current = true;
    setPhase({ name: "running" });
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, seal, result: analysisPayload(tool, result) }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body && Array.isArray(body.changes)) {
        setPhase({ name: "done", analysis: body as ChangeAnalysis });
        setOpen(true);
      } else {
        const code: string = body?.error?.code ?? "ai_failed";
        const message = body?.error?.message ?? aiErrorMessage("ai_failed")!;
        setPhase({ name: "failed", error: { code, message } });
      }
    } catch {
      setPhase({
        name: "failed",
        error: { code: "network", message: "The connection dropped before the AI analysis finished. Your comparison is not affected." },
      });
    } finally {
      inFlight.current = false;
    }
  }

  const heading = `${id}-heading`;

  return (
    <section
      aria-labelledby={heading}
      aria-busy={phase.name === "running"}
      className="rounded-[var(--radius-panel)] border border-rule bg-paper"
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-rule p-4 md:p-5">
        <div className="min-w-0 flex-1">
          <p className="text-[0.78rem] font-medium tracking-wide text-ink-soft uppercase">
            Optional · second step
          </p>
          <h2 id={heading} className="text-[1.15rem] font-semibold">
            AI Change Analyst
          </h2>
          <p className="mt-1 max-w-[70ch] text-[0.9rem] text-ink-soft">
            The comparison above found and proved every change. AI Change Analyst can explain those
            changes in plain language. It does not look for changes itself.
          </p>
        </div>
        {phase.name === "done" && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => setOpen((value) => !value)}
            className="rounded-[3px] border border-rule-strong px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"
          >
            {open ? "Hide AI analysis" : "Show AI analysis"}
          </button>
        )}
      </header>

      <div id={`${id}-body`} className="p-4 md:p-5" hidden={phase.name === "done" && !open}>
        {phase.name === "checking" && (
          <p role="status" className="text-[0.9rem] text-ink-soft">
            Checking whether AI analysis is available…
          </p>
        )}

        {phase.name === "unavailable" && (
          <p role="status" className="text-[0.9rem] text-ink-soft">
            AI analysis isn&apos;t available on this site right now. Your comparison above is complete.
          </p>
        )}

        {(phase.name === "ready" || phase.name === "running" || phase.name === "failed") && (
          <div className="space-y-3">
            <p className="max-w-[70ch] text-[0.85rem] text-ink-soft">{AI_DISCLOSURE}</p>
            {phase.name === "failed" && (
              <Alert tone="problem" role="alert" title="AI analysis unavailable for this comparison">
                <p>{phase.error.message}</p>
                <p className="mt-1 text-[0.85rem] text-ink-soft">
                  The comparison above is complete and has not changed.
                </p>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {(phase.name !== "failed" || RETRYABLE.has(phase.error.code)) && (
                <Button onClick={analyse} disabled={phase.name === "running"}>
                  {phase.name === "running"
                    ? "Analyzing…"
                    : phase.name === "failed"
                      ? "Try AI analysis again"
                      : "Analyze Changes with AI"}
                </Button>
              )}
              <p role="status" aria-live="polite" className="text-[0.85rem] text-ink-soft">
                {phase.name === "running"
                  ? `Explaining ${changeCount} change${changeCount === 1 ? "" : "s"}. This can take up to a minute; the comparison above stays as it is.`
                  : ""}
              </p>
            </div>
          </div>
        )}

        {phase.name === "done" && <AnalysisView analysis={phase.analysis} onViewChange={onViewChange} />}
      </div>
    </section>
  );
}

function ViewChangeButton({
  analysis,
  changeId,
  onViewChange,
  label,
}: {
  analysis: ChangeAnalysis;
  changeId: string;
  onViewChange: (id: string) => void;
  label?: string;
}) {
  const reference = analysis.references[changeId];
  if (!reference) return null;
  return (
    <button
      type="button"
      onClick={() => onViewChange(changeId)}
      aria-label={`View change in the comparison: ${reference.type}, ${reference.location}`}
      className="rounded-[3px] border border-rule-strong bg-paper px-2 py-0.5 text-[0.8rem] font-medium text-signal hover:bg-signal-soft"
    >
      {label ?? "View change"}
    </button>
  );
}

function AnalysisView({ analysis, onViewChange }: { analysis: ChangeAnalysis; onViewChange: (id: string) => void }) {
  const mayMatter = [...analysis.changes]
    .filter((item) => item.analysis.significance === "important" || item.analysis.significance === "notable")
    .sort((a, b) => (a.analysis.significance === b.analysis.significance ? 0 : a.analysis.significance === "important" ? -1 : 1));
  const withheld = withheldSentence(analysis);
  const provider = PROVIDER_NAMES[analysis.provider.name] ?? "the configured AI service";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[1.05rem] font-semibold">AI Change Summary</h3>
        <ul className="mt-1 space-y-0.5 text-[0.85rem] text-ink-soft">
          {coverageSentences(analysis).map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      </div>

      <section aria-labelledby="ai-what-changed">
        <h4 id="ai-what-changed" className="font-semibold">
          1. What changed
        </h4>
        {analysis.summary.length === 0 ? (
          <p className="mt-1 text-[0.9rem] text-ink-soft">
            No overall summary could be matched to the comparison evidence. The explanations below are
            each checked individually.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {analysis.summary.map((sentence) => (
              <li key={sentence.text} className="text-[0.95rem]">
                <p>{sentence.text}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.78rem] text-ink-soft">
                  <span>Based on:</span>
                  {sentence.changeIds.slice(0, 6).map((changeId) => (
                    <ViewChangeButton
                      key={changeId}
                      analysis={analysis}
                      changeId={changeId}
                      onViewChange={onViewChange}
                      label={analysis.references[changeId]?.location}
                    />
                  ))}
                  {sentence.changeIds.length > 6 && <span>and {sentence.changeIds.length - 6} more</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ai-may-matter">
        <h4 id="ai-may-matter" className="font-semibold">
          2. Changes that may matter
        </h4>
        {mayMatter.length === 0 ? (
          <p className="mt-1 text-[0.9rem] text-ink-soft">
            None of the explained changes was marked important or notable.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {mayMatter.map((item) => (
              <li key={item.changeId} className="flex flex-wrap items-baseline gap-2 text-[0.92rem]">
                <SignificanceBadge significance={item.analysis.significance} />
                <span className="font-medium">{item.comparison.location}</span>
                <span className="text-ink-soft">— {item.analysis.whyItMayMatter}</span>
                <ViewChangeButton analysis={analysis} changeId={item.changeId} onViewChange={onViewChange} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ai-each-change">
        <h4 id="ai-each-change" className="font-semibold">
          3. Change by change
        </h4>
        <div className="mt-2 space-y-3">
          {analysis.changes.map((item) => (
            <ExplainedChange key={item.changeId} item={item} analysis={analysis} onViewChange={onViewChange} />
          ))}
        </div>
      </section>

      {analysis.unchanged.length > 0 && (
        <section aria-labelledby="ai-unchanged">
          <h4 id="ai-unchanged" className="font-semibold">
            4. What did not change
          </h4>
          <p className="text-[0.75rem] text-ink-soft">From the comparison, not from AI.</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[0.9rem]">
            {analysis.unchanged.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ai-limitations">
        <h4 id="ai-limitations" className="font-semibold">
          {analysis.unchanged.length > 0 ? "5." : "4."} Limitations
        </h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[0.88rem] text-ink-soft">
          {analysis.limitations.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
          {withheld && <li>{withheld}</li>}
          <li>
            Explanations written by {provider} ({analysis.provider.model}) and checked by DiffNexa against
            the comparison evidence before they were shown.
          </li>
        </ul>
      </section>
    </div>
  );
}

function SignificanceBadge({ significance }: { significance: Significance }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[2px] border px-1.5 py-0.5 text-[0.72rem] font-semibold ${SIGNIFICANCE_STYLE[significance]}`}
    >
      {SIGNIFICANCE_LABELS[significance]}
    </span>
  );
}

function ExplainedChange({
  item,
  analysis,
  onViewChange,
}: {
  item: AnalysedChange;
  analysis: ChangeAnalysis;
  onViewChange: (id: string) => void;
}) {
  const { comparison } = item;
  const cited = comparison.evidence.filter((evidence) => item.analysis.evidenceRefs.includes(evidence.ref));
  return (
    <article
      aria-label={`${SIGNIFICANCE_LABELS[item.analysis.significance]}: ${comparison.type}, ${comparison.location}`}
      className="rounded-[3px] border border-rule p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SignificanceBadge significance={item.analysis.significance} />
        <p className="min-w-0 font-medium">
          {comparison.type} <span className="font-normal text-ink-soft">· {comparison.location}</span>
        </p>
        <span className="ml-auto">
          <ViewChangeButton analysis={analysis} changeId={item.changeId} onViewChange={onViewChange} />
        </span>
      </div>

      <dl className="mt-2 grid gap-x-3 gap-y-1 text-[0.88rem] sm:grid-cols-[8.5rem_1fr]">
        <dt className="text-ink-soft">Original</dt>
        <dd className="break-words">{comparison.original ?? <span className="text-ink-soft">— (not in the original)</span>}</dd>
        <dt className="text-ink-soft">Revised</dt>
        <dd className="break-words">{comparison.revised ?? <span className="text-ink-soft">— (not in the revised)</span>}</dd>
        {comparison.difference && (
          <>
            <dt className="text-ink-soft">Difference</dt>
            <dd className="tabular">{comparison.difference}</dd>
          </>
        )}
        {comparison.signals.map((signal) => (
          <dd key={signal} className="text-[0.82rem] text-ink-soft sm:col-start-2">
            {signal}
          </dd>
        ))}
      </dl>
      <p className="mt-0.5 text-[0.72rem] text-ink-soft">Values above are from the comparison, not from AI.</p>

      <div className="mt-2 border-l-2 border-signal pl-3">
        <p className="text-[0.72rem] font-semibold tracking-wide text-ink-soft uppercase">AI explanation</p>
        <p className="text-[0.95rem]">{item.analysis.explanation}</p>
        <p className="mt-1 text-[0.72rem] font-semibold tracking-wide text-ink-soft uppercase">Why it may matter</p>
        <p className="text-[0.92rem]">{item.analysis.whyItMayMatter}</p>
      </div>

      {cited.length > 0 && (
        <div className="mt-2">
          <p className="text-[0.72rem] font-semibold tracking-wide text-ink-soft uppercase">Evidence</p>
          <ul className="text-[0.82rem]">
            {cited.map((evidence) => (
              <li key={evidence.ref} className="break-words">
                <span className="text-ink-soft">
                  {evidence.side === "original" ? "Original" : "Revised"} · {evidence.location}
                  {evidence.excerpt ? ": " : ""}
                </span>
                {evidence.excerpt && <q>{evidence.excerpt}</q>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

"use client";

import { PROVIDER_NAMES, SIGNIFICANCE_LABELS, type ChangeAnalysis } from "@/lib/analysis";

/**
 * The AI's explanation of the active change, under its evidence.
 *
 * Always a separate, labelled section, so the reader can tell what DiffNexa
 * detected and proved from what AI wrote about it. Nothing is shown here until
 * the person has asked for AI analysis, and only statements the engine checked
 * against the evidence ever reach this component.
 */
export function AIExplanation({
  changeId,
  analysis,
  analystHref,
}: {
  changeId: string;
  analysis: ChangeAnalysis | null;
  /** Where AI Change Analyst is on the page, when it is offered for this result. */
  analystHref: string | null;
}) {
  const item = analysis?.changes.find((entry) => entry.changeId === changeId) ?? null;
  const provider = analysis ? (PROVIDER_NAMES[analysis.provider.name] ?? "the configured AI service") : null;

  return (
    <div className="mt-3 rounded-[3px] border border-dashed border-rule-strong">
      <h4 className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-dashed border-rule-strong px-2.5 py-1 text-[0.72rem] font-semibold tracking-wide text-ink-soft uppercase">
        AI explanation
        <span className="font-medium normal-case">Optional · second step</span>
      </h4>
      <div className="p-2.5 text-[0.85rem]">
        {!analysis ? (
          <p className="text-ink-soft">
            Not requested. The evidence above is complete without it.
            {analystHref && (
              <>
                {" "}
                <a href={analystHref} className="font-medium text-signal underline underline-offset-2">
                  Go to AI Change Analyst
                </a>
              </>
            )}
          </p>
        ) : !item ? (
          <p className="text-ink-soft">
            AI Change Analyst did not explain this change. The evidence above is complete without it.
          </p>
        ) : (
          <>
            <p>
              <span className="rounded-[2px] border border-rule-strong px-1.5 py-0.5 text-[0.72rem] font-semibold">
                {SIGNIFICANCE_LABELS[item.analysis.significance]}
              </span>
            </p>
            <p className="mt-1.5">{item.analysis.explanation}</p>
            <p className="mt-1.5 text-[0.72rem] font-semibold tracking-wide text-ink-soft uppercase">Why it may matter</p>
            <p>{item.analysis.whyItMayMatter}</p>
            <p className="mt-1.5 text-[0.72rem] text-ink-soft">
              Written by {provider} ({analysis.provider.model}) and checked by DiffNexa against the comparison evidence.
              The evidence above remains the source of truth.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

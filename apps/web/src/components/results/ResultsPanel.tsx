"use client";

import { useState } from "react";

import { ChangeCard } from "@/components/results/ChangeCard";
import { Alert } from "@/components/ui/Alert";
import { groupChanges, summarize, type ComparisonResponse } from "@/lib/comparison";

export function ResultsPanel({ result }: { result: ComparisonResponse }) {
  const [showNoise, setShowNoise] = useState(false);

  const meaningful = result.changes.filter((change) => !change.isNoise);
  const noise = result.changes.filter((change) => change.isNoise);
  const shown = showNoise ? result.changes : meaningful;
  const groups = groupChanges(shown);

  return (
    <section aria-labelledby="results-heading" className="mt-6">
      <div className="rounded-[var(--radius-panel)] border border-rule bg-paper">
        <header className="border-b border-rule p-4 md:p-5">
          <h2 id="results-heading" className="text-[1.25rem] font-semibold">
            {summarize(meaningful.length)}
          </h2>
          <p className="tabular mt-1 text-[0.9rem] text-ink-soft">
            Compared {result.documents.previous.pageCount} pages against{" "}
            {result.documents.revised.pageCount} pages in{" "}
            {(result.processingMs / 1000).toFixed(1)} seconds.
          </p>

          {noise.length > 0 && (
            <label className="mt-3 flex items-center gap-2 text-[0.9rem]">
              <input
                type="checkbox"
                checked={showNoise}
                onChange={(event) => setShowNoise(event.target.checked)}
                className="h-4 w-4"
              />
              <span>
                Also show {noise.length} change{noise.length === 1 ? "" : "s"} that look like page
                numbering, repeated headers or text that only moved
              </span>
            </label>
          )}
        </header>

        {result.diagnostics.notes.length > 0 && (
          <div className="space-y-2 border-b border-rule p-4 md:p-5">
            {result.diagnostics.notes.map((note) => (
              <Alert key={note} tone="planned" title="Worth knowing">
                {note}
              </Alert>
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <p className="p-4 text-ink-soft md:p-5">
            These two documents contain the same text, numbers and dates. Nothing was found to
            report.
          </p>
        ) : (
          <div className="divide-y divide-rule">
            {groups.map((group) => (
              <section key={group.id} className="p-4 md:p-5">
                <h3 className="mb-1 text-[0.8rem] font-semibold tracking-wide text-ink-soft">
                  {group.title} ({group.items.length})
                </h3>
                <div>
                  {group.items.map((change) => (
                    <ChangeCard key={change.id} change={change} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="border-t border-rule p-4 text-[0.8rem] text-ink-soft md:p-5">
          Every change above was found by comparing the documents directly, and each one points to
          the page it came from. No AI was used.
        </footer>
      </div>
    </section>
  );
}

"use client";

import { Button } from "@/components/ui/Button";
import type { ComparisonError as ComparisonErrorPayload } from "@/lib/comparison";

/**
 * What went wrong, what it means, and what to do about it.
 *
 * Each known failure gets its own explanation and next step. Crucially, an
 * error is only described as a damaged file when the engine actually examined
 * the file and found it damaged — a failure to reach the engine, a timeout or a
 * rejected upload all say what really happened instead.
 */
const EXPLANATIONS: Record<string, { title: string; whatNext: string }> = {
  not_pdf: {
    title: "That file isn't a PDF",
    whatNext: "Check you picked the right file. Renaming a file to .pdf doesn't convert it.",
  },
  empty_file: {
    title: "That file is empty",
    whatNext: "Choose the document again, or re-save it and upload the new copy.",
  },
  file_too_large: {
    title: "That document is too large",
    whatNext: "Try a smaller file, or split the document and compare the relevant part.",
  },
  too_many_pages: {
    title: "That document has too many pages",
    whatNext: "Compare a shorter document, or the section you care about.",
  },
  password_protected: {
    title: "That document is password protected",
    whatNext:
      "Open it in your PDF reader, save a copy without the password, and upload that copy instead.",
  },
  corrupted: {
    title: "That document couldn't be read",
    whatNext:
      "The file appears to be damaged or incomplete. Re-download or re-export it and try again.",
  },
  no_pages: {
    title: "That document has no pages",
    whatNext: "Choose a different file.",
  },
  extraction_failed: {
    title: "That document couldn't be read",
    whatNext: "Try opening it and saving a fresh copy as PDF, then upload that.",
  },
  engine_unavailable: {
    title: "The comparison service isn't reachable",
    whatNext:
      "Nothing is wrong with your documents. The service that compares them isn't responding right now — try again in a moment.",
  },
  timeout: {
    title: "The comparison took too long",
    whatNext:
      "Your documents are fine, but they took longer than expected. Try again, or compare shorter documents.",
  },
  network: {
    title: "The connection dropped",
    whatNext: "Check your internet connection and try again. Your documents were not changed.",
  },
};

const FALLBACK = {
  title: "The comparison couldn't be completed",
  whatNext: "Please try again. If it keeps happening, try re-saving your documents as PDF.",
};

export function ComparisonError({
  error,
  onRetry,
}: {
  error: ComparisonErrorPayload;
  onRetry: () => void;
}) {
  const explanation = EXPLANATIONS[error.code] ?? FALLBACK;
  const side = error.side === "previous" ? "previous" : error.side === "revised" ? "new" : null;
  // Only a fault found in a specific file is worth blaming on that file.
  const fileProblem = side !== null;

  return (
    <section
      role="alert"
      className="mt-6 rounded-[var(--radius-panel)] border border-removed/40 bg-[#fdf0f0] p-4 md:p-5"
    >
      <h2 className="text-[1.05rem] font-semibold text-removed">{explanation.title}</h2>
      {fileProblem && (
        <p className="mt-1 text-[0.9rem] font-medium">
          This is about your {side} document.
        </p>
      )}
      <p className="mt-2 max-w-prose">{explanation.whatNext}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {!fileProblem && (
          <Button onClick={onRetry} className="px-3 py-1.5 text-[0.9rem]">
            Try again
          </Button>
        )}
        {fileProblem && (
          <p className="text-[0.85rem] text-ink-soft">
            Use “Replace file” above to choose a different {side} document.
          </p>
        )}
      </div>
    </section>
  );
}

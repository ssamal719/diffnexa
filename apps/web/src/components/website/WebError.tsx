"use client";

import { Button } from "@/components/ui/Button";
import type { WebFailure } from "@/lib/web-report";

/**
 * What went wrong, and what to do about it.
 *
 * Each failure gets its own explanation. Crucially, a page is never described
 * as damaged when the real problem was reaching it, reading it, or the baseline
 * file — saying "damaged" about a working page sends people looking for a
 * problem that does not exist.
 */
const EXPLANATIONS: Record<string, { title: string; whatNext: string; retry: boolean }> = {
  url_not_allowed: {
    title: "This address can't be checked",
    whatNext:
      "DiffNexa reads public web pages only. Addresses on a private network, and sites that ask not to be read automatically, can't be checked.",
    retry: false,
  },
  url_unreachable: {
    title: "DiffNexa couldn't reach this page",
    whatNext: "Check the address opens in your browser, then try again. The site may also be down.",
    retry: true,
  },
  url_not_html: {
    title: "That address isn't a web page",
    whatNext: "It looks like a file rather than a page. To compare two PDFs, use PDF Compare.",
    retry: false,
  },
  page_needs_javascript: {
    title: "This page builds its content in the browser",
    whatNext:
      "DiffNexa can't read pages that assemble themselves after loading. Pages that work today are ones whose text is in the page itself.",
    retry: false,
  },
  page_too_large: {
    title: "This page is too large to read",
    whatNext: "Try a specific page rather than a very long one.",
    retry: false,
  },
  snapshot_mismatch: {
    title: "This baseline is for a different page",
    whatNext: "Choose the baseline you downloaded for this address, or capture a new one.",
    retry: false,
  },
  snapshot_unreadable: {
    title: "That file isn't a DiffNexa baseline",
    whatNext:
      "Choose the file you downloaded when you captured the page. It ends in .diffnexa.json.",
    retry: false,
  },
  fetch_timeout: {
    title: "This page took too long to respond",
    whatNext: "It may be slow right now. Try again in a moment.",
    retry: true,
  },
  engine_unavailable: {
    title: "DiffNexa can't check pages right now",
    whatNext: "Nothing is wrong with the address you entered. Please try again shortly.",
    retry: true,
  },
  bad_request: {
    title: "Something was missing",
    whatNext: "Enter the address of the page you want to check and try again.",
    retry: false,
  },
};

const FALLBACK = {
  title: "That didn't work",
  whatNext: "Please try again. If it keeps happening, check the address opens in your browser.",
  retry: true,
};

export function WebError({ failure, onRetry }: { failure: WebFailure; onRetry?: () => void }) {
  const explanation = EXPLANATIONS[failure.code] ?? FALLBACK;

  return (
    <section
      role="alert"
      className="mt-6 rounded-[var(--radius-panel)] border border-removed/40 bg-[#fdf0f0] p-4 md:p-5"
    >
      <h2 className="text-[1.05rem] font-semibold text-removed">{explanation.title}</h2>
      <p className="mt-2 max-w-prose">{explanation.whatNext}</p>
      {explanation.retry && onRetry && (
        <Button onClick={onRetry} className="mt-3 px-3 py-1.5 text-[0.9rem]">
          Try again
        </Button>
      )}
    </section>
  );
}

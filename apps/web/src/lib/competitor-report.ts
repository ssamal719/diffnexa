/**
 * Competitor Monitor's presentation layer.
 *
 * Everything here is presentation over what the engine returned. The changes,
 * their values, their evidence and their signals all come from the API; this
 * decides how they are grouped and worded, and nothing else.
 *
 * The wording rule for the whole tool: a signal says *where* a change sits on
 * the page. "Touches Pricing & Commercial" is an observation about location.
 * Whether the change is significant, or what the competitor intends by it, is
 * not something a comparison of two captures can know, and nothing here says.
 */

import type { WebChange, WebComparison } from "@/lib/web-report";

// ---------------------------------------------------------------- page types

/**
 * What kind of page this is. The reader's own label: it is kept in their
 * baseline file, shown in the report, and never sent to the engine, so it
 * cannot change how the page is read or compared.
 */
export const PAGE_TYPES = [
  { id: "homepage", label: "Homepage" },
  { id: "pricing", label: "Pricing" },
  { id: "product", label: "Product" },
  { id: "features", label: "Features" },
  { id: "plans", label: "Plans" },
  { id: "changelog", label: "Changelog" },
  { id: "documentation", label: "Documentation" },
  { id: "other", label: "Other" },
] as const;

export type PageTypeId = (typeof PAGE_TYPES)[number]["id"];

export function pageTypeLabel(id: string | null | undefined): string {
  return PAGE_TYPES.find((type) => type.id === id)?.label ?? "Other";
}

export const MAX_COMPETITOR_NAME = 80;

/** Tidies the name someone typed; the result is shown back to them only. */
export function cleanCompetitorName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_COMPETITOR_NAME);
}

// ---------------------------------------------------------------- the API shape

export type CompetitorSignalId =
  | "pricing_commercial"
  | "product_features"
  | "messaging_positioning"
  | "plans_packaging"
  | "calls_to_action"
  | "content_sections"
  | "links_destinations"
  | "seo_metadata"
  | "other";

export type ChangeSignal = {
  signal: CompetitorSignalId;
  label: string;
  basis: string;
  matchedText: string;
  reason: string;
  summary: string;
};

export type SignalSummary = {
  id: CompetitorSignalId;
  label: string;
  blurb: string;
  changeCount: number;
  changeIds: string[];
};

export type CompetitorChange = WebChange & { competitorSignal?: ChangeSignal | null };

export type CompetitorComparison = Omit<WebComparison, "changes"> & {
  changes: CompetitorChange[];
  competitor: {
    signalsVersion: string;
    signals: SignalSummary[];
    changedSignals: CompetitorSignalId[];
  };
};

// ---------------------------------------------------------------- baselines

/**
 * The file a person downloads and keeps.
 *
 * It wraps the capture with the labels they chose, so when they come back the
 * file itself says which competitor and page it belongs to. The capture inside
 * is exactly what the engine produced and is passed back untouched.
 */
export type CompetitorBaselineFile = {
  diffnexa: "competitor-baseline";
  version: 1;
  competitor: string;
  pageType: string;
  capturedAt: string;
  url: string;
  title: string | null;
  snapshot: Record<string, unknown>;
};

export type CapturedSnapshot = {
  source: { url: string; final_url: string; fetched_at: string };
  metadata: { title: string | null };
  content_sha256: string;
  nodes: unknown[];
};

export function buildBaselineFile(
  snapshot: CapturedSnapshot,
  competitor: string,
  pageType: string,
): CompetitorBaselineFile {
  return {
    diffnexa: "competitor-baseline",
    version: 1,
    competitor: cleanCompetitorName(competitor),
    pageType,
    capturedAt: snapshot.source.fetched_at,
    url: snapshot.source.final_url,
    title: snapshot.metadata.title,
    snapshot: snapshot as unknown as Record<string, unknown>,
  };
}

export type ReadBaseline =
  | {
      ok: true;
      snapshot: Record<string, unknown>;
      competitor: string | null;
      pageType: string | null;
      url: string | null;
      capturedAt: string | null;
    }
  | { ok: false; message: string };

const NOT_A_BASELINE =
  "That file isn't a DiffNexa baseline. Choose the .diffnexa-snapshot.json file you downloaded when you captured the page.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capturedAtOf(snapshot: Record<string, unknown>): string | null {
  const source = snapshot.source as { fetched_at?: unknown } | undefined;
  return typeof source?.fetched_at === "string" ? source.fetched_at : null;
}

/**
 * Reads a file the person chose.
 *
 * Accepts a Competitor Monitor baseline, a Policy Monitor baseline and a plain
 * capture from Website Change Detector, because the capture inside each is the
 * same thing. The engine validates the capture strictly either way; this only
 * finds it and the labels around it.
 */
export function readBaselineFile(text: string): ReadBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: NOT_A_BASELINE };
  }
  if (!isRecord(parsed)) return { ok: false, message: NOT_A_BASELINE };

  const kind = parsed.diffnexa;
  if ((kind === "competitor-baseline" || kind === "policy-baseline") && isRecord(parsed.snapshot)) {
    return {
      ok: true,
      snapshot: parsed.snapshot,
      competitor:
        kind === "competitor-baseline" && typeof parsed.competitor === "string"
          ? cleanCompetitorName(parsed.competitor) || null
          : null,
      pageType:
        kind === "competitor-baseline" && typeof parsed.pageType === "string" && isPageType(parsed.pageType)
          ? parsed.pageType
          : null,
      url: typeof parsed.url === "string" ? parsed.url : null,
      capturedAt: capturedAtOf(parsed.snapshot),
    };
  }

  if ("content_sha256" in parsed && "nodes" in parsed) {
    const source = parsed.source as { final_url?: unknown } | undefined;
    return {
      ok: true,
      snapshot: parsed,
      competitor: null,
      pageType: null,
      url: typeof source?.final_url === "string" ? source.final_url : null,
      capturedAt: capturedAtOf(parsed),
    };
  }

  return { ok: false, message: NOT_A_BASELINE };
}

function isPageType(id: string): id is PageTypeId {
  return PAGE_TYPES.some((type) => type.id === id);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "competitor"
  );
}

export function baselineFilename(baseline: CompetitorBaselineFile): string {
  const host = (() => {
    try {
      return new URL(baseline.url).hostname.replace(/^www\./, "");
    } catch {
      return "page";
    }
  })();
  const day = baseline.capturedAt.slice(0, 10);
  return `${slug(baseline.competitor || host)}-${baseline.pageType}-${day}.diffnexa-snapshot.json`;
}

/** A name for the competitor when the baseline file carried none. */
export function fallbackCompetitorName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------- signals

export function signalOf(change: CompetitorChange): ChangeSignal | null {
  return change.competitorSignal ?? null;
}

export type SignalGroup = {
  id: CompetitorSignalId;
  label: string;
  blurb: string;
  changes: CompetitorChange[];
};

/**
 * The changes, grouped by signal, in the taxonomy's order.
 *
 * Every change in the list given lands in exactly one group, and a change with
 * no signal (which the engine never sends, but a hand-edited response might)
 * goes to Other rather than vanishing. Nothing is dropped by grouping.
 */
export function groupBySignal(
  result: CompetitorComparison,
  changes: CompetitorChange[],
): SignalGroup[] {
  const order = result.competitor.signals;
  const buckets = new Map<string, CompetitorChange[]>(order.map((signal) => [signal.id, []]));
  for (const change of changes) {
    const id = signalOf(change)?.signal ?? "other";
    (buckets.get(id) ?? buckets.get("other") ?? []).push(change);
  }
  return order
    .map((signal) => ({
      id: signal.id,
      label: signal.label,
      blurb: signal.blurb,
      changes: buckets.get(signal.id) ?? [],
    }))
    .filter((group) => group.changes.length > 0);
}

/** Signals with at least one change, for the summary at the top of the report. */
export function changedSignals(result: CompetitorComparison): SignalSummary[] {
  return result.competitor.signals.filter((signal) => signal.changeCount > 0);
}

export function changesForSignal(result: CompetitorComparison, id: string): CompetitorChange[] {
  return result.changes.filter((change) => (signalOf(change)?.signal ?? "other") === id);
}

/**
 * The report's headline. "No changes found" is followed, in the report, by a
 * sentence that is careful about what it claims: the page reads the same as the
 * baseline — not that the competitor has changed nothing.
 */
export function headline(total: number): string {
  return total === 0 ? "No changes found" : `${total} change${total === 1 ? "" : "s"} found`;
}

export const NO_CHANGES_SENTENCE =
  "This page says the same as it did when you captured your baseline.";

// ---------------------------------------------------------------- errors

/**
 * Error wording specific to this tool. Everything else is Website Change
 * Detector's, because the failures are the same ones.
 */
export const COMPETITOR_ERRORS = {
  url_unreachable: {
    title: "Could not fetch this page",
    whatNext: "Check the address opens in your browser, then try again. The site may also be down.",
    retry: true,
  },
  fetch_timeout: {
    title: "Could not fetch this page in time",
    whatNext: "It may be slow right now. Try again in a moment.",
    retry: true,
  },
  url_not_allowed: {
    title: "This address can't be checked",
    whatNext:
      "DiffNexa reads public web pages only. Addresses on a private network, and sites that ask not to be read automatically, can't be checked.",
    retry: false,
  },
  snapshot_unreadable: {
    title: "That file isn't a valid baseline",
    whatNext:
      "Choose the file you downloaded when you captured this page. Its name ends in .diffnexa-snapshot.json.",
    retry: false,
  },
  snapshot_mismatch: {
    title: "This baseline is for a different page",
    whatNext:
      "The baseline you chose was captured from another address. Choose the baseline for this page, or capture a new one.",
    retry: false,
  },
} as const;

/**
 * Price Monitor's presentation layer.
 *
 * Everything here is presentation over what the engine returned: the changes,
 * their values, their evidence and their price categories all come from the
 * API. This decides how they are grouped and worded, and nothing else.
 *
 * The wording rule for the whole tool: state what the page says, never what it
 * means. "$29 → $39" is shown exactly so; nothing here calls a price high, low,
 * better, worse or a deal.
 */

import type { WebChange, WebComparison } from "@/lib/web-report";

// ---------------------------------------------------------------- page types

/**
 * What kind of page this is. The reader's own label: kept in their baseline
 * file and shown in the report, never sent to the engine, so it cannot change
 * how the page is read or compared.
 */
export const PAGE_TYPES = [
  { id: "product", label: "Product" },
  { id: "subscription_plan", label: "Subscription Plan" },
  { id: "saas_pricing", label: "SaaS Pricing" },
  { id: "service_pricing", label: "Service Pricing" },
  { id: "pricing_table", label: "Pricing Table" },
  { id: "other", label: "Other" },
] as const;

export type PageTypeId = (typeof PAGE_TYPES)[number]["id"];

export function pageTypeLabel(id: string | null | undefined): string {
  return PAGE_TYPES.find((type) => type.id === id)?.label ?? "Other";
}

function isPageType(id: string): id is PageTypeId {
  return PAGE_TYPES.some((type) => type.id === id);
}

export const MAX_PRODUCT_NAME = 80;

export function cleanProductName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_PRODUCT_NAME);
}

// ---------------------------------------------------------------- the API shape

export type PriceCategoryId =
  | "price"
  | "discount_sale"
  | "original_price"
  | "currency"
  | "billing_period"
  | "product_plan"
  | "availability"
  | "pricing_details"
  | "other";

export type ChangePriceCategory = {
  category: PriceCategoryId;
  label: string;
  basis: string;
  matchedText: string;
  reason: string;
};

export type PriceCategorySummary = {
  id: PriceCategoryId;
  label: string;
  blurb: string;
  changeCount: number;
  changeIds: string[];
};

export type PriceChange = WebChange & { priceCategory?: ChangePriceCategory | null };

export type PriceComparison = Omit<WebComparison, "changes"> & {
  changes: PriceChange[];
  price: {
    rulesVersion: string;
    categories: PriceCategorySummary[];
    changedCategories: PriceCategoryId[];
  };
};

// ---------------------------------------------------------------- baselines

/**
 * The file a person downloads and keeps: the capture exactly as the engine
 * produced it, wrapped with the labels they chose. Not a new snapshot format —
 * the capture inside is the same one every webpage tool uses.
 */
export type PriceBaselineFile = {
  diffnexa: "price-baseline";
  version: 1;
  product: string;
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
  product: string,
  pageType: string,
): PriceBaselineFile {
  return {
    diffnexa: "price-baseline",
    version: 1,
    product: cleanProductName(product),
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
      product: string | null;
      pageType: string | null;
      url: string | null;
      capturedAt: string | null;
    }
  | { ok: false; message: string };

const NOT_A_BASELINE =
  "That file isn't a DiffNexa baseline. Choose the .diffnexa-snapshot.json file you downloaded when you captured the page.";

const WRAPPERS = new Set(["price-baseline", "competitor-baseline", "policy-baseline"]);

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
 * Accepts a Price Monitor baseline, the baselines of the other webpage tools
 * and a plain capture, because the capture inside is the same thing. Labels are
 * only taken from a Price Monitor file. The engine validates the capture itself
 * strictly either way; this only finds it.
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
  if (typeof kind === "string" && WRAPPERS.has(kind) && isRecord(parsed.snapshot)) {
    const own = kind === "price-baseline";
    return {
      ok: true,
      snapshot: parsed.snapshot,
      product: own && typeof parsed.product === "string" ? cleanProductName(parsed.product) || null : null,
      pageType:
        own && typeof parsed.pageType === "string" && isPageType(parsed.pageType) ? parsed.pageType : null,
      url: typeof parsed.url === "string" ? parsed.url : null,
      capturedAt: capturedAtOf(parsed.snapshot),
    };
  }

  if ("content_sha256" in parsed && "nodes" in parsed) {
    const source = parsed.source as { final_url?: unknown } | undefined;
    return {
      ok: true,
      snapshot: parsed,
      product: null,
      pageType: null,
      url: typeof source?.final_url === "string" ? source.final_url : null,
      capturedAt: capturedAtOf(parsed),
    };
  }

  return { ok: false, message: NOT_A_BASELINE };
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "product"
  );
}

export function baselineFilename(baseline: PriceBaselineFile): string {
  const day = baseline.capturedAt.slice(0, 10);
  const pageType = slug(baseline.pageType);
  return `${slug(baseline.product || fallbackProductName(baseline.url))}-${pageType}-${day}.diffnexa-snapshot.json`;
}

/** A name to show when the baseline file carried none. */
export function fallbackProductName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------- categories

export function categoryOf(change: PriceChange): ChangePriceCategory | null {
  return change.priceCategory ?? null;
}

export type CategoryGroup = {
  id: PriceCategoryId;
  label: string;
  blurb: string;
  changes: PriceChange[];
};

/**
 * The changes grouped by category, in the rules' order.
 *
 * Every change lands in exactly one group. A change with no category (which
 * the engine never sends) goes to Other Changes rather than vanishing. The
 * categories are labels, not filters: nothing is dropped by grouping.
 */
export function groupByCategory(result: PriceComparison, changes: PriceChange[]): CategoryGroup[] {
  const order = result.price.categories;
  const buckets = new Map<string, PriceChange[]>(order.map((category) => [category.id, []]));
  for (const change of changes) {
    const id = categoryOf(change)?.category ?? "other";
    (buckets.get(id) ?? buckets.get("other") ?? []).push(change);
  }
  return order
    .map((category) => ({
      id: category.id,
      label: category.label,
      blurb: category.blurb,
      changes: buckets.get(category.id) ?? [],
    }))
    .filter((group) => group.changes.length > 0);
}

export function changedCategories(result: PriceComparison): PriceCategorySummary[] {
  return result.price.categories.filter((category) => category.changeCount > 0);
}

export function headline(total: number): string {
  return total === 0 ? "No changes found" : `${total} change${total === 1 ? "" : "s"} found`;
}

export const NO_CHANGES_SENTENCE =
  "This page says the same as it did when you captured your baseline.";

// ---------------------------------------------------------------- errors

/** Wording specific to this tool; every other failure uses the shared wording. */
export const PRICE_ERRORS = {
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

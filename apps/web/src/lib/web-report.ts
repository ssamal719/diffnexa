/**
 * Turning a webpage comparison into the report the interface shows.
 *
 * Everything here is presentation over what the engine already decided:
 * grouping, counting, filtering and wording. No value shown to a person is
 * invented — old values, new values, differences, sections and evidence all
 * come from the comparison.
 *
 * Website-native throughout. A webpage has no pages, so "where" is answered by
 * the headings a reader can see: Pricing › Enterprise, not page 7.
 */

// ---------------------------------------------------------------- the API shape

export type WebEvidence = {
  side: "old" | "new";
  scope: "node" | "document" | "page";
  nodeId: string | null;
  path: string | null;
  sectionPath: string[];
  field: string | null;
  excerpt: string | null;
};

export type WebChange = {
  id: string;
  seq: number;
  type: string;
  kind: "added" | "removed" | "modified" | "moved";
  category: string;
  subtype: string | null;
  label: string | null;
  oldValue: string | null;
  newValue: string | null;
  delta: string | null;
  confidence: number;
  isNoise: boolean;
  noiseReason: string | null;
  sections: string[];
  evidence: WebEvidence[];
};

export type WebComparison = {
  engineVersion: string;
  processingMs: number;
  documents: {
    previous: { url?: string; sha256: string; nodeCount?: number };
    revised: { url?: string; sha256: string; nodeCount?: number };
  };
  counts: { total: number; meaningful: number; noise: number };
  changes: WebChange[];
  diagnostics: {
    notes: string[];
    previousWarnings: string[];
    revisedWarnings: string[];
    needsJavascript: boolean;
  };
};

export type Baseline = {
  schema_version: string;
  source: { url: string; final_url: string; fetched_at: string };
  metadata: { title: string | null };
  nodes: unknown[];
  content_sha256: string;
};

export type WebFailure = { code: string; message: string };

// ---------------------------------------------------------------- vocabulary

/** The kinds of change this tool can find, in the words a reader would use. */
export const WEB_CATEGORIES = [
  { id: "content", label: "Wording", blurb: "Text added, removed or rewritten" },
  { id: "values", label: "Numbers", blurb: "Prices, amounts and quantities" },
  { id: "dates", label: "Dates", blurb: "Dates and deadlines" },
  { id: "tables", label: "Tables", blurb: "Rows, columns and cell values" },
  { id: "links", label: "Links", blurb: "Where a link points" },
  { id: "details", label: "Page details", blurb: "Title, description and canonical link" },
] as const;

export type WebCategoryId = (typeof WEB_CATEGORIES)[number]["id"];

export type EditKind = "added" | "removed" | "changed" | "moved";

export const EDIT_LABEL: Record<EditKind, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  moved: "Moved",
};

/** A symbol as well as a word, so meaning never rests on colour alone. */
export const EDIT_MARK: Record<EditKind, string> = {
  added: "+",
  removed: "−",
  changed: "±",
  moved: "→",
};

export function categoryOf(change: WebChange): WebCategoryId {
  if (change.subtype === "table_cell" || change.category === "table") return "tables";
  if (change.category === "number" || change.category === "identifier") return "values";
  if (change.category === "date") return "dates";
  if (change.category === "link") return "links";
  if (change.category === "metadata") return "details";
  return "content";
}

export function editKindOf(change: WebChange): EditKind {
  return change.kind === "modified" ? "changed" : change.kind;
}

/**
 * What this change is, in plain words.
 *
 * The engine's own names — NUMBER_CHANGED and the like — never reach the screen.
 */
export function headlineFor(change: WebChange): string {
  const kind = editKindOf(change);
  const category = categoryOf(change);

  if (category === "details") {
    const names: Record<string, string> = {
      title: "Page title",
      meta_description: "Page description",
      canonical_url: "Canonical link",
      address: "Page address",
    };
    return names[change.subtype ?? ""] ?? "Page details";
  }
  if (category === "values") return "Number changed";
  if (category === "dates") return "Date changed";
  if (category === "links") {
    return { added: "Link added", removed: "Link removed", changed: "Link now points elsewhere", moved: "Link moved" }[
      kind
    ];
  }
  if (category === "tables") {
    if (change.subtype === "row") {
      return kind === "added" ? "Table row added" : kind === "removed" ? "Table row removed" : "Table row changed";
    }
    return "Table value changed";
  }
  if (change.subtype === "heading") {
    return { added: "Heading added", removed: "Heading removed", changed: "Heading renamed", moved: "Heading moved" }[
      kind
    ];
  }
  if (change.subtype === "list_item") {
    return { added: "List item added", removed: "List item removed", changed: "List item changed", moved: "List item moved" }[
      kind
    ];
  }
  return { added: "Text added", removed: "Text removed", changed: "Text rewritten", moved: "Text moved" }[kind];
}

/** Where the change sits, as a reader would describe it. */
export function locationOf(change: WebChange): string | null {
  if (change.sections.length > 0) return change.sections[0];
  if (categoryOf(change) === "details") return "Whole page";
  return change.label ?? null;
}

// ---------------------------------------------------------------- sections

export type SectionNode = {
  path: string;
  name: string;
  depth: number;
  count: number;
  children: SectionNode[];
};

/**
 * The page's headings, with how many changes sit under each.
 *
 * This is the website's answer to "where did it change": the same structure a
 * reader sees on the page, not a made-up map.
 */
export function sectionTree(changes: WebChange[]): SectionNode[] {
  const counts = new Map<string, number>();

  for (const change of changes) {
    const section = change.sections[0];
    if (!section) continue;
    const parts = section.split(" › ");
    // Every ancestor gets the count too, so a parent reads as a total.
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const key = parts.slice(0, depth).join(" › ");
      counts.set(key, (counts.get(key) ?? 0) + (depth === parts.length ? 1 : 0));
    }
  }

  const roots: SectionNode[] = [];
  const byPath = new Map<string, SectionNode>();

  for (const path of [...counts.keys()].sort()) {
    const parts = path.split(" › ");
    const node: SectionNode = {
      path,
      name: parts[parts.length - 1],
      depth: parts.length - 1,
      count: counts.get(path) ?? 0,
      children: [],
    };
    byPath.set(path, node);
    const parentPath = parts.slice(0, -1).join(" › ");
    const parent = parentPath ? byPath.get(parentPath) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const total = (node: SectionNode): number =>
    node.count + node.children.reduce((sum, child) => sum + total(child), 0);
  const fill = (node: SectionNode): SectionNode => ({
    ...node,
    count: total(node),
    children: node.children.map(fill),
  });

  return roots.map(fill);
}

// ---------------------------------------------------------------- the report

export type WebCategorySummary = {
  id: WebCategoryId;
  label: string;
  blurb: string;
  count: number;
};

export type WebReport = {
  changes: WebChange[];
  minor: WebChange[];
  total: number;
  sectionsAffected: number;
  categories: WebCategorySummary[];
  mix: { kind: EditKind; count: number }[];
  sections: SectionNode[];
  url: string;
  notes: string[];
};

function inReadingOrder(a: WebChange, b: WebChange): number {
  return a.seq - b.seq;
}

export function buildWebReport(result: WebComparison): WebReport {
  const meaningful = result.changes.filter((change) => !change.isNoise).sort(inReadingOrder);
  const minor = result.changes.filter((change) => change.isNoise).sort(inReadingOrder);

  const categories = WEB_CATEGORIES.map((category) => ({
    ...category,
    count: meaningful.filter((change) => categoryOf(change) === category.id).length,
  }));

  const mix = (["added", "removed", "changed", "moved"] as EditKind[])
    .map((kind) => ({ kind, count: meaningful.filter((c) => editKindOf(c) === kind).length }))
    .filter((entry) => entry.count > 0);

  const sections = sectionTree(meaningful);
  const affected = new Set(meaningful.map((c) => c.sections[0]).filter(Boolean)).size;

  return {
    changes: meaningful,
    minor,
    total: meaningful.length,
    sectionsAffected: affected,
    categories,
    mix,
    sections,
    url: result.documents.revised.url ?? result.documents.previous.url ?? "",
    notes: result.diagnostics.notes,
  };
}

// ---------------------------------------------------------------- filtering

export type WebFilters = {
  categories: WebCategoryId[];
  kinds: EditKind[];
  sections: string[];
  query: string;
  includeMinor: boolean;
};

export const NO_WEB_FILTERS: WebFilters = {
  categories: [],
  kinds: [],
  sections: [],
  query: "",
  includeMinor: false,
};

export function hasWebFilters(filters: WebFilters): boolean {
  return (
    filters.categories.length > 0 ||
    filters.kinds.length > 0 ||
    filters.sections.length > 0 ||
    filters.query.trim() !== ""
  );
}

/** Searches everything a person can see: values, headings, sections and evidence. */
function matches(change: WebChange, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    change.label,
    change.oldValue,
    change.newValue,
    change.delta,
    headlineFor(change),
    ...change.sections,
    ...change.evidence.map((item) => item.excerpt),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function applyWebFilters(report: WebReport, filters: WebFilters): WebChange[] {
  const pool = filters.includeMinor
    ? [...report.changes, ...report.minor].sort(inReadingOrder)
    : report.changes;

  return pool.filter((change) => {
    if (filters.categories.length > 0 && !filters.categories.includes(categoryOf(change))) return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(editKindOf(change))) return false;
    if (filters.sections.length > 0) {
      const section = change.sections[0] ?? "";
      // Selecting a parent section includes everything beneath it.
      if (!filters.sections.some((chosen) => section === chosen || section.startsWith(`${chosen} › `))) {
        return false;
      }
    }
    return matches(change, filters.query);
  });
}

export function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

// ---------------------------------------------------------------- wording

export function summariseWeb(report: WebReport): string {
  if (report.total === 0) return "No changes found";
  const changes = `${report.total} change${report.total === 1 ? "" : "s"}`;
  if (report.sectionsAffected === 0) return `${changes} found`;
  const sections = `${report.sectionsAffected} section${report.sectionsAffected === 1 ? "" : "s"}`;
  return `${changes} across ${sections}`;
}

export function formatCapturedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A readable name for a page: its title, or its address without the scheme. */
export function describePage(baseline: Baseline): string {
  return baseline.metadata.title?.trim() || baseline.source.final_url.replace(/^https?:\/\//, "");
}

export function baselineFilename(baseline: Baseline): string {
  const host = (() => {
    try {
      return new URL(baseline.source.final_url).hostname.replace(/^www\./, "");
    } catch {
      return "webpage";
    }
  })();
  const day = baseline.source.fetched_at.slice(0, 10);
  return `${host}-${day}.diffnexa.json`;
}

// ---------------------------------------------------------------- addresses

export type UrlCheck = { ok: true; url: string } | { ok: false; message: string };

/**
 * A first look at what someone typed, so obvious mistakes are caught before a
 * request is made. The server checks the address properly; this is courtesy,
 * not security.
 */
export function checkUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: "Enter the address of the page you want to check." };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, message: "That doesn't look like a web address. Try something like example.com/pricing." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, message: "DiffNexa can only check pages that open in a web browser." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, message: "Remove the username and password from the address and try again." };
  }
  // Checked before the domain rule, so "localhost" is explained for what it is
  // rather than being told it is missing a .com.
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[)/i.test(parsed.hostname)) {
    return { ok: false, message: "DiffNexa can only check pages that are available publicly on the internet." };
  }
  if (!parsed.hostname.includes(".")) {
    return { ok: false, message: "That address is missing a domain, such as .com or .org." };
  }

  return { ok: true, url: parsed.toString() };
}

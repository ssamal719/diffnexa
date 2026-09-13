/**
 * The Policy and Terms Monitor's presentation layer.
 *
 * Everything here is presentation over what the engine returned. The changes,
 * their values, their evidence and their topics all come from the API; this
 * decides how they are grouped and worded, and nothing else.
 *
 * The wording rule that governs the whole tool: a topic says *where* a change
 * sits in an agreement. "Touches Data retention" is an observation about
 * location. Whether that change is good or bad for the reader is a legal
 * judgement, and this product does not make one.
 */

import type { WebChange, WebComparison } from "@/lib/web-report";

// ---------------------------------------------------------------- policy types

/**
 * The kinds of document someone monitors. This is the reader's own label for
 * the page: it is recorded with their baseline and never changes how the page
 * is read or compared.
 */
export const POLICY_TYPES = [
  { id: "privacy_policy", label: "Privacy Policy" },
  { id: "terms_of_service", label: "Terms of Service" },
  { id: "terms_and_conditions", label: "Terms & Conditions" },
  { id: "data_processing_agreement", label: "Data Processing Agreement" },
  { id: "subprocessor_list", label: "Subprocessor List" },
  { id: "security_policy", label: "Security Policy" },
  { id: "cookie_policy", label: "Cookie Policy" },
  { id: "refund_policy", label: "Refund / Return Policy" },
  { id: "other", label: "Other Policy" },
] as const;

export type PolicyTypeId = (typeof POLICY_TYPES)[number]["id"];

export function policyTypeLabel(id: string | null | undefined): string {
  return POLICY_TYPES.find((type) => type.id === id)?.label ?? "Other Policy";
}

// ---------------------------------------------------------------- the API shape

export type PolicySignal = {
  topic: string;
  label: string;
  source: "heading" | "text";
  matchedText: string;
  summary: string;
};

export type TopicStatus = "changed" | "present" | "not_found";

export type PolicyTopicSummary = {
  id: string;
  label: string;
  blurb: string;
  status: TopicStatus;
  changeCount: number;
  sections: string[];
};

export type PolicyChange = WebChange & { policyTopics?: PolicySignal[] };

export type PolicyComparison = Omit<WebComparison, "changes"> & {
  changes: PolicyChange[];
  policy: {
    signalsVersion: string;
    topics: PolicyTopicSummary[];
    changedTopics: string[];
    classifiedChanges: number;
    unclassifiedChanges: number;
  };
};

// ---------------------------------------------------------------- baselines

/**
 * The file a person downloads and keeps.
 *
 * It wraps the capture with the label they chose, so when they return months
 * later the file itself says which page it belongs to and what they called it.
 * The capture inside is exactly what the engine produced and is passed back
 * untouched.
 */
export type PolicyBaselineFile = {
  diffnexa: "policy-baseline";
  version: 1;
  policyType: string;
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
  policyType: string,
): PolicyBaselineFile {
  return {
    diffnexa: "policy-baseline",
    version: 1,
    policyType,
    capturedAt: snapshot.source.fetched_at,
    url: snapshot.source.final_url,
    title: snapshot.metadata.title,
    snapshot: snapshot as unknown as Record<string, unknown>,
  };
}

export type ReadBaseline =
  | { ok: true; snapshot: Record<string, unknown>; policyType: string | null; url: string | null }
  | { ok: false; message: string };

/**
 * Reads a file the person chose.
 *
 * Accepts both a policy baseline and a plain capture from Website Change
 * Detector, because the capture inside is the same thing and refusing it would
 * be pedantry rather than safety. The engine validates it strictly either way.
 */
export function readBaselineFile(text: string): ReadBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file isn't a DiffNexa baseline. Choose the file you downloaded." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: "That file isn't a DiffNexa baseline. Choose the file you downloaded." };
  }

  const wrapper = parsed as Partial<PolicyBaselineFile> & Record<string, unknown>;
  if (wrapper.diffnexa === "policy-baseline" && typeof wrapper.snapshot === "object") {
    return {
      ok: true,
      snapshot: wrapper.snapshot as Record<string, unknown>,
      policyType: typeof wrapper.policyType === "string" ? wrapper.policyType : null,
      url: typeof wrapper.url === "string" ? wrapper.url : null,
    };
  }

  if ("content_sha256" in wrapper && "nodes" in wrapper) {
    const source = wrapper.source as { final_url?: string } | undefined;
    return { ok: true, snapshot: wrapper, policyType: null, url: source?.final_url ?? null };
  }

  return {
    ok: false,
    message: "That file isn't a DiffNexa baseline. Choose the file you downloaded when you captured the page.",
  };
}

export function baselineFilename(baseline: PolicyBaselineFile): string {
  const host = (() => {
    try {
      return new URL(baseline.url).hostname.replace(/^www\./, "");
    } catch {
      return "policy";
    }
  })();
  const day = baseline.capturedAt.slice(0, 10);
  return `${host}-${baseline.policyType.replace(/_/g, "-")}-${day}.diffnexa.json`;
}

// ---------------------------------------------------------------- topics

export function topicsOf(change: PolicyChange): PolicySignal[] {
  return change.policyTopics ?? [];
}

/** Topics with at least one change, in the order the API listed them. */
export function changedTopics(result: PolicyComparison): PolicyTopicSummary[] {
  return result.policy.topics.filter((topic) => topic.status === "changed");
}

/** Topics the page contains where nothing changed. */
export function unchangedTopics(result: PolicyComparison): PolicyTopicSummary[] {
  return result.policy.topics.filter((topic) => topic.status === "present");
}

/** Topics whose wording was not recognised in the page at all. */
export function notFoundTopics(result: PolicyComparison): PolicyTopicSummary[] {
  return result.policy.topics.filter((topic) => topic.status === "not_found");
}

/**
 * What a status means, in words that claim only what was checked.
 *
 * "No detected changes in this topic" is deliberate. "Unchanged" would sound
 * like a guarantee, and the honest claim is narrower: nothing was detected.
 */
export const STATUS_WORDING: Record<TopicStatus, string> = {
  changed: "Changes detected",
  present: "No detected changes in this topic",
  not_found: "Not found on this page",
};

export function describeSignalSource(signal: PolicySignal): string {
  const where = signal.source === "heading" ? "the section heading" : "the wording";
  return `${where} contains “${signal.matchedText}”`;
}

export function changesForTopic(result: PolicyComparison, topicId: string): PolicyChange[] {
  return result.changes.filter((change) =>
    topicsOf(change).some((signal) => signal.topic === topicId),
  );
}

export function unclassifiedChanges(result: PolicyComparison): PolicyChange[] {
  return result.changes.filter((change) => topicsOf(change).length === 0 && !change.isNoise);
}

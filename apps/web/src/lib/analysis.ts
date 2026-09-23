/**
 * AI Change Analyst: the shared, browser-safe part.
 *
 * AI Change Analyst explains changes DiffNexa's deterministic comparison has
 * already found. It is a second, optional step: nothing here runs until the
 * person asks for it, and the comparison on screen is never changed by it.
 *
 * What is sent for analysis is the comparison result itself — its changes,
 * their evidence and the tool's own classifications — never the person's
 * files. `analysisPayload` picks exactly those parts, in a fixed order, so the
 * site's server can confirm they are what the engine returned (see
 * analysis-seal.ts) before anything reaches an AI service.
 */

import errorsContract from "@/generated/errors.json";

export const ANALYSIS_TOOLS = ["pdf", "web", "policy", "competitor", "price", "docx", "excel"] as const;
export type AnalysisTool = (typeof ANALYSIS_TOOLS)[number];

/** The response header that carries a comparison result's seal. */
export const SEAL_HEADER = "x-diffnexa-analysis-seal";

/**
 * The parts of each tool's result that AI analysis uses. Everything else — the
 * grids of every cell in a workbook, timings, file fingerprints — stays out.
 */
const PARTS: Record<AnalysisTool, readonly string[]> = {
  pdf: ["engineVersion", "counts", "changes"],
  web: ["engineVersion", "counts", "changes"],
  policy: ["engineVersion", "counts", "changes", "policy"],
  competitor: ["engineVersion", "counts", "changes"],
  price: ["engineVersion", "counts", "changes"],
  docx: ["engineVersion", "counts", "groups", "changes"],
  excel: ["engineVersion", "counts", "groups", "sheets", "changes"],
};

export function isAnalysisTool(value: unknown): value is AnalysisTool {
  return typeof value === "string" && (ANALYSIS_TOOLS as readonly string[]).includes(value);
}

/**
 * The part of a comparison result sent for analysis, always built the same way,
 * so the same result always gives the same payload (and the same seal).
 */
export function analysisPayload(tool: AnalysisTool, result: unknown): Record<string, unknown> {
  const source = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const part of PARTS[tool]) {
    if (source[part] !== undefined) payload[part] = source[part];
  }
  return payload;
}

// ---------------------------------------------------------------- the analysis, as the engine returns it

export type Significance = "important" | "notable" | "minor" | "unclear";

export type AnalysisEvidence = {
  ref: string;
  side: "original" | "revised";
  location: string;
  excerpt: string | null;
};

export type AnalysedChange = {
  changeId: string;
  /** What the comparison says. Deterministic; shown as such. */
  comparison: {
    type: string;
    kind: string;
    category: string;
    location: string;
    original: string | null;
    revised: string | null;
    difference: string | null;
    signals: string[];
    details: string[];
    evidence: AnalysisEvidence[];
  };
  /** What AI says about it, already checked against the comparison. */
  analysis: {
    significance: Significance;
    explanation: string;
    whyItMayMatter: string;
    evidenceRefs: string[];
  };
};

export type ChangeAnalysis = {
  engineVersion: string;
  tool: AnalysisTool;
  status: "complete" | "partial" | "nothing_to_explain";
  provider: { name: string; model: string };
  coverage: {
    totalChanges: number;
    excludedNoise: number;
    eligible: number;
    analyzed: number;
    notAnalyzedIds: string[];
    prioritised: boolean;
  };
  summary: { text: string; changeIds: string[] }[];
  changes: AnalysedChange[];
  /** How the comparison names each change cited above. */
  references: Record<string, { type: string; location: string }>;
  unchanged: string[];
  withheld: { statements: number; reasons: Record<string, number> };
  limitations: string[];
};

export type AnalysisFailure = { code: string; message: string };

// ---------------------------------------------------------------- wording

export type AIErrorCode = keyof typeof errorsContract.ai_messages;
export const AI_ERROR_MESSAGES: Record<AIErrorCode, string> = errorsContract.ai_messages;

export function aiErrorMessage(code: string): string | null {
  return code in AI_ERROR_MESSAGES ? AI_ERROR_MESSAGES[code as AIErrorCode] : null;
}

export const SIGNIFICANCE_LABELS: Record<Significance, string> = {
  important: "Important change",
  notable: "Notable change",
  minor: "Minor change",
  unclear: "Significance unclear",
};

/** Said before anything is sent, so no one is surprised by where their data goes. */
export const AI_DISCLOSURE =
  "If you ask for AI analysis, the changes listed in this comparison and the short evidence " +
  "excerpts behind them are sent to the AI service this site uses. Your complete files are never " +
  "sent, and nothing is stored.";

export const PROVIDER_NAMES: Record<string, string> = {
  gemini: "Google Gemini",
  openai_compatible: "an OpenAI-compatible AI service",
};

/** "AI analysis covered X of Y detected changes." and why, when not all. */
export function coverageSentences(analysis: ChangeAnalysis): string[] {
  const { coverage } = analysis;
  const sentences = [
    `AI analysis covered ${coverage.analyzed} of ${coverage.totalChanges} detected change${coverage.totalChanges === 1 ? "" : "s"}.`,
  ];
  if (coverage.excludedNoise > 0) {
    sentences.push(
      `${coverage.excludedNoise} change${coverage.excludedNoise === 1 ? " was" : "s were"} classed as noise by the comparison and not sent.`,
    );
  }
  if (coverage.notAnalyzedIds.length > 0) {
    sentences.push(
      `${coverage.notAnalyzedIds.length} change${coverage.notAnalyzedIds.length === 1 ? " has" : "s have"} no AI explanation; ${
        coverage.notAnalyzedIds.length === 1 ? "it is" : "they are"
      } still listed in the comparison.`,
    );
  }
  if (coverage.prioritised) {
    sentences.push("Changes to numbers, dates, links, tables and classified topics were explained first.");
  }
  return sentences;
}

export function withheldSentence(analysis: ChangeAnalysis): string | null {
  const count = analysis.withheld.statements;
  if (count === 0) return null;
  return `${count} AI statement${count === 1 ? " was" : "s were"} not shown because ${
    count === 1 ? "it" : "they"
  } could not be matched to the comparison evidence.`;
}

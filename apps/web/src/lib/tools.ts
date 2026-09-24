/**
 * The tools DiffNexa offers, listed once.
 *
 * The header, footer, homepage, related-tool links, structured data and
 * sitemap all read this, so they cannot describe the same tool differently or
 * forget one. Every description says only what the V1 tool does: the file
 * tools compare two files; the web tools compare a public page with a
 * baseline the person saved. Nothing here watches pages, sends alerts or uses
 * AI to find changes.
 */

export type ToolGroup = "compare" | "monitor";

export type Tool = {
  href: string;
  name: string;
  group: ToolGroup;
  /** The card and page description: what the tool does, in one sentence. */
  summary: string;
  /** A few words for the navigation menu. */
  menuLine: string;
  /** Tools a reader of this one is most likely to want next. */
  related: string[];
};

export const GROUPS: Record<ToolGroup, { label: string; heading: string; blurb: string }> = {
  compare: {
    label: "Compare",
    heading: "Compare two files",
    blurb: "Upload an original and a revised version. Both are compared in memory and not stored.",
  },
  monitor: {
    label: "Web Monitoring",
    heading: "Check a web page against your baseline",
    blurb:
      "Save a copy of a public page as it reads today, keep the file, and compare the live page with it whenever you choose.",
  },
};

export const TOOLS: readonly Tool[] = [
  {
    href: "/pdf-compare",
    name: "PDF Compare",
    group: "compare",
    summary: "Compare two PDF versions and see changes in text, numbers, dates and pages.",
    menuLine: "Two PDF versions, page by page",
    related: ["/docx-compare", "/excel-compare"],
  },
  {
    href: "/docx-compare",
    name: "DOCX Compare",
    group: "compare",
    summary: "Compare two Word documents and find changes in text, numbers, dates, lists and tables.",
    menuLine: "Two Word documents, by heading",
    related: ["/pdf-compare", "/excel-compare"],
  },
  {
    href: "/excel-compare",
    name: "Excel Compare",
    group: "compare",
    summary: "Compare two Excel workbooks and find changed cells, formulas, rows, columns, sheets and links.",
    menuLine: "Two workbooks, cell by cell",
    related: ["/pdf-compare", "/docx-compare"],
  },
  {
    href: "/website-compare",
    name: "Website Change Detector",
    group: "monitor",
    summary: "Compare a public web page against a baseline you saved and see exactly what changed.",
    menuLine: "Any public page against your baseline",
    related: ["/policy-monitor", "/competitor-monitor", "/price-monitor"],
  },
  {
    href: "/policy-monitor",
    name: "Policy & Terms Monitor",
    group: "monitor",
    summary:
      "Compare a privacy policy or terms page against a baseline you saved, and see which part of the document changed.",
    menuLine: "Privacy policies, terms and similar pages",
    related: ["/website-compare", "/competitor-monitor"],
  },
  {
    href: "/competitor-monitor",
    name: "Competitor Monitor",
    group: "monitor",
    summary: "Compare a competitor’s public page against your saved baseline and see what changed.",
    menuLine: "Competitor pricing, product and feature pages",
    related: ["/price-monitor", "/website-compare"],
  },
  {
    href: "/price-monitor",
    name: "Price Monitor",
    group: "monitor",
    summary: "Compare a public pricing or product page against your saved baseline and see what changed.",
    menuLine: "Prices, plans and availability",
    related: ["/competitor-monitor", "/website-compare"],
  },
];

export function toolByHref(href: string): Tool {
  const tool = TOOLS.find((item) => item.href === href);
  if (!tool) throw new Error(`Unknown tool ${href}`);
  return tool;
}

export function toolsIn(group: ToolGroup): Tool[] {
  return TOOLS.filter((tool) => tool.group === group);
}

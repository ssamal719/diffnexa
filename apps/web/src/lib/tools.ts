/**
 * The tools DiffNexa offers, listed once.
 *
 * The header and the homepage both read this, so they cannot describe the same
 * tool differently or forget one.
 */
export const TOOLS = [
  {
    href: "/pdf-compare",
    name: "PDF Compare",
    summary:
      "Compare two PDF versions and find changes in text, numbers, dates, and pages.",
  },
  {
    href: "/website-compare",
    name: "Website Change Detector",
    summary:
      "Capture a public webpage and later compare it against your saved baseline to see what changed.",
  },
  {
    href: "/policy-monitor",
    name: "Policy & Terms Monitor",
    summary:
      "Compare a public policy or terms page against a baseline you saved, and see which part of the document changed.",
  },
  {
    href: "/competitor-monitor",
    name: "Competitor Monitor",
    summary: "Track changes on competitor webpages and see exactly what changed.",
  },
  {
    href: "/price-monitor",
    name: "Price Monitor",
    summary: "Track changes on public pricing and product pages and see exactly what changed.",
  },
  {
    href: "/docx-compare",
    name: "DOCX Compare",
    summary:
      "Compare two Word documents and find changes in text, numbers, dates, lists, and tables.",
  },
] as const;

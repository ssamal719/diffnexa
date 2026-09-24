/**
 * Search and sharing metadata for every public page, in one place.
 *
 * Each page gets its own title and description written for what someone would
 * search for, a canonical address, and matching Open Graph and Twitter
 * details. The wording follows the product's rule: say only what is true. The
 * comparison is deterministic, so no description calls it AI; the web tools
 * compare against a baseline the person saved, so none promises watching,
 * alerts or schedules.
 *
 * Structured data (JSON-LD) is built here too, from facts only: names,
 * addresses and descriptions. No ratings, reviews, prices or user counts,
 * because none exist.
 */

import type { Metadata } from "next";

import { SITE_NAME, TAGLINE, absoluteUrl } from "@/lib/site";
import { TOOLS, toolByHref } from "@/lib/tools";

export type ToolPath =
  | "/pdf-compare"
  | "/docx-compare"
  | "/excel-compare"
  | "/website-compare"
  | "/policy-monitor"
  | "/competitor-monitor"
  | "/price-monitor";

/** Pages about DiffNexa itself, rather than tools. */
export type InfoPath = "/ai-change-analyst" | "/about" | "/contact" | "/privacy-policy" | "/terms-of-service" | "/bot";

export type PagePath = "/" | ToolPath | InfoPath;

/**
 * The information pages, in the order the sitemap lists them, with the name
 * each is given in its breadcrumb and the kind of page schema.org calls it.
 */
export const INFO_PAGES: { path: InfoPath; name: string; schemaType: "WebPage" | "AboutPage" | "ContactPage" }[] = [
  { path: "/ai-change-analyst", name: "AI Change Analyst", schemaType: "WebPage" },
  { path: "/about", name: "About", schemaType: "AboutPage" },
  { path: "/contact", name: "Contact", schemaType: "ContactPage" },
  { path: "/privacy-policy", name: "Privacy Policy", schemaType: "WebPage" },
  { path: "/terms-of-service", name: "Terms of Service", schemaType: "WebPage" },
  { path: "/bot", name: "DiffNexaBot", schemaType: "WebPage" },
];

/** The one address people can write to. */
export const CONTACT_EMAIL = "info@diffnexa.com";

export const PAGE_SEO: Record<PagePath, { title: string; description: string }> = {
  "/": {
    title: "DiffNexa — Document & Web Page Comparison Tools",
    description:
      "Compare PDF, Word and Excel files, or check a public web page against a saved baseline. DiffNexa shows every change with evidence you can verify.",
  },
  "/pdf-compare": {
    title: "PDF Compare — Compare Two PDF Files and Find Changes | DiffNexa",
    description:
      "Compare two PDF files and find changed text, numbers, dates and pages, with the page and the exact wording behind every change. No account needed.",
  },
  "/docx-compare": {
    title: "DOCX Compare — Compare Word Documents and Find Changes | DiffNexa",
    description:
      "Compare two Word (.docx) documents and find changes in text, headings, numbers, dates, lists and tables, with the exact wording behind each one.",
  },
  "/excel-compare": {
    title: "Excel Compare — Compare Two Excel Files for Changes | DiffNexa",
    description:
      "Compare two Excel (.xlsx) workbooks side by side and find changed cells, values, formulas, rows, columns, sheets and links, with evidence for each.",
  },
  "/website-compare": {
    title: "Website Change Detector — Find Changes on a Web Page | DiffNexa",
    description:
      "Save a baseline of a public web page, then compare the page with it later to find changed wording, numbers, dates, tables, links and page details.",
  },
  "/policy-monitor": {
    title: "Policy & Terms Monitor — Find Changes to Policy Pages | DiffNexa",
    description:
      "Compare a privacy policy, terms of service or subprocessor list against your saved baseline and see what changed, and which part of the document it is in.",
  },
  "/competitor-monitor": {
    title: "Competitor Monitor — Track Changes on Competitor Web Pages | DiffNexa",
    description:
      "Compare a competitor’s public pricing, product or features page with your saved baseline and see what changed: prices, plans, features, buttons and wording.",
  },
  "/price-monitor": {
    title: "Price Monitor — Track Changes to Public Pricing Pages | DiffNexa",
    description:
      "Compare a public pricing or product page with your saved baseline to find changed prices, currencies, billing periods, plans and availability, with evidence.",
  },
  "/ai-change-analyst": {
    title: "AI Change Analyst — How Detected Changes Are Explained | DiffNexa",
    description:
      "An optional step that explains changes DiffNexa has already found. It runs only when you ask, never decides what changed, and cites the evidence it used.",
  },
  "/about": {
    title: "About DiffNexa — Document & Web Page Comparison Tools",
    description:
      "Why DiffNexa exists, how its comparison works, what each tool does and does not do, and why every change it reports comes with evidence you can check.",
  },
  "/contact": {
    title: "Contact DiffNexa — Get in Touch",
    description:
      "Email DiffNexa at info@diffnexa.com with product questions, bug reports, privacy requests, legal questions, feedback or business enquiries.",
  },
  "/privacy-policy": {
    title: "Privacy Policy | DiffNexa",
    description:
      "How DiffNexa handles the files you compare, the web pages you check, AI Change Analyst requests, Google Analytics cookies and any future advertising.",
  },
  "/terms-of-service": {
    title: "Terms of Service | DiffNexa",
    description:
      "The terms for using DiffNexa: acceptable use, the files and addresses you submit, the limits of automated comparison results, and liability.",
  },
  "/bot": {
    title: "DiffNexaBot — How It Reads Public Web Pages | DiffNexa",
    description:
      "DiffNexaBot fetches one public web page when a DiffNexa visitor asks to check it. It follows robots.txt, runs no JavaScript and loads nothing else.",
  },
};

/** Complete metadata for one public page. Titles are absolute: each already names DiffNexa once. */
export function pageMetadata(path: PagePath): Metadata {
  const { title, description } = PAGE_SEO[path];
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: SITE_NAME,
      locale: "en",
      title,
      description,
    },
    twitter: { card: "summary", title, description },
  };
}

// ---------------------------------------------------------------- structured data

type JsonLd = Record<string, unknown>;

/** The site itself, for the homepage. */
export function websiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: PAGE_SEO["/"].description,
    slogan: TAGLINE,
    hasPart: TOOLS.map((tool) => ({ "@type": "WebPage", name: tool.name, url: absoluteUrl(tool.href) })),
  };
}

/**
 * One tool, described as the web application it is, with the breadcrumb from
 * the homepage. Only facts the page itself states: name, address, what it does,
 * and that it runs in a web browser.
 */
export function toolJsonLd(path: ToolPath): JsonLd[] {
  const tool = toolByHref(path);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: tool.name,
      url: absoluteUrl(path),
      description: PAGE_SEO[path].description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any (runs in a web browser)",
      browserRequirements: "A current web browser with JavaScript enabled",
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
        { "@type": "ListItem", position: 2, name: tool.name, item: absoluteUrl(path) },
      ],
    },
  ];
}

/**
 * An information page: what kind of page it is, where it sits in the site,
 * and its breadcrumb. The contact page names the address to write to — the
 * only fact about the organisation stated anywhere, because it is the only one
 * DiffNexa publishes.
 */
export function infoPageJsonLd(path: InfoPath): JsonLd[] {
  const page = INFO_PAGES.find((item) => item.path === path)!;
  const main: JsonLd = {
    "@context": "https://schema.org",
    "@type": page.schemaType,
    name: PAGE_SEO[path].title,
    url: absoluteUrl(path),
    description: PAGE_SEO[path].description,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") },
  };
  if (page.schemaType === "ContactPage") {
    main.mainEntity = { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/"), email: CONTACT_EMAIL };
  }
  return [
    main,
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
        { "@type": "ListItem", position: 2, name: page.name, item: absoluteUrl(path) },
      ],
    },
  ];
}

/** JSON for a script tag, with "<" escaped so no value can close the tag early. */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

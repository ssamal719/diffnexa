/**
 * Metadata, structured data, sitemap and robots.
 *
 * The rule these enforce is the same one that governs the product: say only
 * what is true. Comparison is deterministic, so nothing may describe it as
 * AI-powered; the web tools compare against a baseline the person saved, so
 * none may promise watching, alerts or schedules; and no page may claim a
 * rating, review, price or user count that does not exist.
 */

import { describe, expect, it, vi } from "vitest";

import { metadata as rootMetadata, TOOLS } from "@/app/layout";
import { metadata as homeMetadata } from "@/app/page";
import { metadata as competitorMetadata } from "@/app/competitor-monitor/page";
import { metadata as docxMetadata } from "@/app/docx-compare/page";
import { metadata as excelMetadata } from "@/app/excel-compare/page";
import { metadata as pdfMetadata } from "@/app/pdf-compare/page";
import { metadata as policyMetadata } from "@/app/policy-monitor/page";
import { metadata as priceMetadata } from "@/app/price-monitor/page";
import { metadata as webMetadata } from "@/app/website-compare/page";
import { metadata as aiMetadata } from "@/app/ai-change-analyst/page";
import { metadata as aboutMetadata } from "@/app/about/page";
import { metadata as botMetadata } from "@/app/bot/page";
import { metadata as contactMetadata } from "@/app/contact/page";
import { metadata as privacyMetadata } from "@/app/privacy-policy/page";
import { metadata as termsMetadata } from "@/app/terms-of-service/page";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { INFO_PAGES, PAGE_SEO, infoPageJsonLd, serializeJsonLd, toolJsonLd, websiteJsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { toolByHref } from "@/lib/tools";

const TOOL_PAGES = [
  { name: "home", metadata: homeMetadata, path: "/" },
  { name: "pdf-compare", metadata: pdfMetadata, path: "/pdf-compare" },
  { name: "website-compare", metadata: webMetadata, path: "/website-compare" },
  { name: "policy-monitor", metadata: policyMetadata, path: "/policy-monitor" },
  { name: "competitor-monitor", metadata: competitorMetadata, path: "/competitor-monitor" },
  { name: "price-monitor", metadata: priceMetadata, path: "/price-monitor" },
  { name: "docx-compare", metadata: docxMetadata, path: "/docx-compare" },
  { name: "excel-compare", metadata: excelMetadata, path: "/excel-compare" },
];

/** The pages about DiffNexa itself. */
const INFO = [
  { name: "ai-change-analyst", metadata: aiMetadata, path: "/ai-change-analyst" },
  { name: "about", metadata: aboutMetadata, path: "/about" },
  { name: "contact", metadata: contactMetadata, path: "/contact" },
  { name: "privacy-policy", metadata: privacyMetadata, path: "/privacy-policy" },
  { name: "terms-of-service", metadata: termsMetadata, path: "/terms-of-service" },
  { name: "bot", metadata: botMetadata, path: "/bot" },
];

const PAGES = [...TOOL_PAGES, ...INFO];

type PageMetadata = (typeof PAGES)[number]["metadata"];

function titleOf(metadata: PageMetadata): string {
  const title = metadata.title;
  if (typeof title === "string") return title;
  if (title && typeof title === "object" && "absolute" in title) return String(title.absolute);
  return "";
}

function og(metadata: PageMetadata): Record<string, unknown> {
  return (metadata.openGraph ?? {}) as Record<string, unknown>;
}

function twitter(metadata: PageMetadata): Record<string, unknown> {
  return (metadata.twitter ?? {}) as Record<string, unknown>;
}

describe("the tools", () => {
  it("are listed once, grouped as files to compare and web pages to check", () => {
    expect(TOOLS.map((tool) => tool.href)).toEqual([
      "/pdf-compare",
      "/docx-compare",
      "/excel-compare",
      "/website-compare",
      "/policy-monitor",
      "/competitor-monitor",
      "/price-monitor",
    ]);
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      "PDF Compare",
      "DOCX Compare",
      "Excel Compare",
      "Website Change Detector",
      "Policy & Terms Monitor",
      "Competitor Monitor",
      "Price Monitor",
    ]);
    expect(TOOLS.map((tool) => tool.group)).toEqual([
      "compare", "compare", "compare", "monitor", "monitor", "monitor", "monitor",
    ]);
    for (const tool of TOOLS) expect(tool.summary.length).toBeGreaterThan(30);
  });

  it("have one entry per public tool page", () => {
    const toolPages = TOOL_PAGES.filter((page) => page.path !== "/").map((page) => page.path);
    expect(TOOLS.map((tool) => tool.href).sort()).toEqual(toolPages.sort());
  });

  it("describe the web tools as comparisons against a saved baseline, never as watching", () => {
    for (const tool of TOOLS.filter((item) => item.group === "monitor")) {
      expect(tool.summary, tool.name).toMatch(/baseline/i);
      const wording = `${tool.summary} ${tool.menuLine}`.toLowerCase();
      for (const claim of [
        "\\bai\\b", "automatic", "automated", "alerts?", "scheduled?", "monitors? for you", "real-time",
        "legal advice", "compliance", "risks?", "history",
      ]) {
        expect(wording, `${tool.name} claims ${claim}`).not.toMatch(new RegExp(claim));
      }
    }
  });

  it("link each tool to related tools that exist, never to itself", () => {
    for (const tool of TOOLS) {
      expect(tool.related.length, tool.name).toBeGreaterThanOrEqual(2);
      for (const href of tool.related) {
        expect(href).not.toBe(tool.href);
        expect(() => toolByHref(href)).not.toThrow();
      }
    }
    expect(toolByHref("/pdf-compare").related).toEqual(["/docx-compare", "/excel-compare"]);
    expect(toolByHref("/website-compare").related).toEqual(["/policy-monitor", "/competitor-monitor", "/price-monitor"]);
    expect(toolByHref("/policy-monitor").related).toEqual(["/website-compare", "/competitor-monitor"]);
  });
});

describe("page metadata", () => {
  it("gives every page the title and description written for it", () => {
    for (const page of PAGES) {
      const seo = PAGE_SEO[page.path as keyof typeof PAGE_SEO];
      expect(titleOf(page.metadata), page.name).toBe(seo.title);
      expect(page.metadata.description, page.name).toBe(seo.description);
    }
    expect(titleOf(homeMetadata)).toBe("DiffNexa — Document & Web Page Comparison Tools");
    expect(titleOf(pdfMetadata)).toBe("PDF Compare — Compare Two PDF Files and Find Changes | DiffNexa");
    expect(titleOf(docxMetadata)).toBe("DOCX Compare — Compare Word Documents and Find Changes | DiffNexa");
    expect(titleOf(excelMetadata)).toBe("Excel Compare — Compare Two Excel Files for Changes | DiffNexa");
    expect(titleOf(webMetadata)).toBe("Website Change Detector — Find Changes on a Web Page | DiffNexa");
    expect(titleOf(policyMetadata)).toBe("Policy & Terms Monitor — Find Changes to Policy Pages | DiffNexa");
    expect(titleOf(competitorMetadata)).toBe("Competitor Monitor — Track Changes on Competitor Web Pages | DiffNexa");
    expect(titleOf(priceMetadata)).toBe("Price Monitor — Track Changes to Public Pricing Pages | DiffNexa");
    expect(titleOf(aboutMetadata)).toBe("About DiffNexa — Document & Web Page Comparison Tools");
    expect(titleOf(contactMetadata)).toBe("Contact DiffNexa — Get in Touch");
    expect(titleOf(privacyMetadata)).toBe("Privacy Policy | DiffNexa");
    expect(titleOf(termsMetadata)).toBe("Terms of Service | DiffNexa");
  });

  it("names DiffNexa exactly once in every title, and never lets the template add it again", () => {
    for (const page of PAGES) {
      expect(page.metadata.title, page.name).toEqual({ absolute: titleOf(page.metadata) });
      // \b keeps the crawler's own name, DiffNexaBot, from counting as a second mention.
      expect(titleOf(page.metadata).match(/\bDiffNexa\b/g)?.length, page.name).toBe(1);
      expect(titleOf(page.metadata).length, page.name).toBeLessThanOrEqual(70);
    }
  });

  it("gives every public page a canonical URL", () => {
    for (const page of PAGES) {
      expect(page.metadata.alternates?.canonical).toBe(page.path);
    }
  });

  it("gives every public page a distinct title and description of a useful length", () => {
    const titles = PAGES.map((page) => titleOf(page.metadata));
    const descriptions = PAGES.map((page) => String(page.metadata.description));
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const description of descriptions) {
      expect(description.length).toBeGreaterThan(110);
      expect(description.length).toBeLessThanOrEqual(160);
    }
  });

  it("gives every public page matching Open Graph and Twitter details", () => {
    for (const page of PAGES) {
      expect(og(page.metadata).type, page.name).toBe("website");
      expect(og(page.metadata).url, page.name).toBe(page.path);
      expect(og(page.metadata).siteName, page.name).toBe("DiffNexa");
      expect(og(page.metadata).title, page.name).toBe(titleOf(page.metadata));
      expect(og(page.metadata).description, page.name).toBe(page.metadata.description);
      expect(twitter(page.metadata).card, page.name).toBe("summary");
      expect(twitter(page.metadata).title, page.name).toBe(titleOf(page.metadata));
      expect(twitter(page.metadata).description, page.name).toBe(page.metadata.description);
    }
  });

  it("resolves every address against the real domain, never localhost", () => {
    expect(SITE_URL).toBe("https://diffnexa.com");
    expect(String(rootMetadata.metadataBase)).toBe("https://diffnexa.com/");
  });

  it("never claims the comparison uses AI", () => {
    // The tools and the homepage. The AI Change Analyst page is about AI and is
    // checked separately below; the privacy policy must name it to disclose it.
    const wording = [
      ...TOOL_PAGES.map((page) => `${titleOf(page.metadata)} ${page.metadata.description}`),
      String(rootMetadata.description),
      ...TOOLS.map((tool) => `${tool.summary} ${tool.menuLine}`),
    ]
      .join(" ")
      .toLowerCase();
    expect(wording).not.toMatch(/\bai[- ]?(powered|driven|based)?\b/);
    expect(wording).not.toContain("artificial intelligence");
    expect(wording).not.toContain("machine learning");
  });

  it("does not repeat words for the sake of it", () => {
    for (const page of PAGES) {
      const counts = new Map<string, number>();
      for (const word of String(page.metadata.description).toLowerCase().split(/\W+/).filter((w) => w.length > 4)) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
      for (const [word, count] of counts) {
        expect(count, `${page.name}: "${word}" repeats ${count} times`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("describes AI Change Analyst as an optional explanation, never as what finds changes", () => {
    const description = String(aiMetadata.description);
    expect(description).toContain("already found");
    expect(description).toContain("only when you ask");
    expect(description).toContain("never decides what changed");
    expect(description.toLowerCase()).not.toMatch(/ai-powered|detects changes|finds changes/);
  });

  it("claims no advertising, certification or approval anywhere in page metadata", () => {
    const wording = PAGES.map((page) => `${titleOf(page.metadata)} ${page.metadata.description}`)
      .join(" ")
      .toLowerCase();
    for (const claim of ["adsense approved", "google-approved", "certified", "gdpr compliant", "soc 2", "iso 27001"]) {
      expect(wording, claim).not.toContain(claim);
    }
  });

  it("keeps the site-wide description honest and short", () => {
    expect(String(rootMetadata.description).length).toBeLessThan(200);
  });
});

describe("what each tool page claims", () => {
  function wording(metadata: PageMetadata): string {
    return `${titleOf(metadata)} ${metadata.description} ${og(metadata).title} ${og(metadata).description}`.toLowerCase();
  }

  function claimsNone(metadata: PageMetadata, claims: string[]) {
    for (const claim of claims) {
      expect(wording(metadata), `claims ${claim}`).not.toMatch(new RegExp(`\\b${claim}\\b`));
    }
  }

  it("policy: describes the baseline workflow, and claims no watching, verdicts or advice", () => {
    expect(String(policyMetadata.description)).toContain("baseline");
    expect(String(policyMetadata.description)).toMatch(/compare/i);
    claimsNone(policyMetadata, [
      "ai", "ai-powered", "automatic", "automatically", "automated", "alerts?", "scheduled?", "continuous",
      "legal advice", "compliance", "risks?", "crawls?", "history",
    ]);
  });

  it("competitor: claims no watching, screenshots or verdicts", () => {
    expect(String(competitorMetadata.description)).toContain("baseline");
    claimsNone(competitorMetadata, [
      "ai", "automatic", "automatically", "automated", "alerts?", "scheduled?", "continuous",
      "real-time", "crawls?", "history", "screenshots?", "threats?", "risks?", "opportunit(y|ies)",
    ]);
  });

  it("price: claims no watching and judges no price", () => {
    expect(String(priceMetadata.description)).toContain("baseline");
    claimsNone(priceMetadata, [
      "ai", "automatic", "automatically", "alerts?", "scheduled?", "real-time", "notifications?",
      "cheapest", "best price", "deals?", "forecast", "predict", "amazon", "history",
    ]);
  });

  it("docx: claims no visual, formatting or legacy .doc comparison", () => {
    claimsNone(docxMetadata, ["ai", "automatic", "visual", "images?", "formatting", "\\.doc\\b", "legacy", "pdf", "important"]);
  });

  it("excel: claims no formatting, chart, macro or .xls comparison", () => {
    claimsNone(excelMetadata, ["ai", "automatic", "formatting", "charts?", "images?", "macros?", "xls", "xlsm", "important"]);
  });

  it("pdf: claims no table, image or scanned-page comparison", () => {
    claimsNone(pdfMetadata, ["ai", "automatic", "tables?", "images?", "scanned", "ocr"]);
  });
});

describe("structured data", () => {
  const FORBIDDEN = ["aggregateRating", "review", "offers", "price", "ratingValue", "userInteractionCount", "author", "founder"];

  function keysOf(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(keysOf);
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
    }
    return [];
  }

  it("describes the site and every tool as valid JSON-LD with real addresses", () => {
    const blocks = [websiteJsonLd(), ...TOOLS.flatMap((tool) => toolJsonLd(tool.href as never))];
    for (const block of blocks) {
      const parsed = JSON.parse(serializeJsonLd(block));
      expect(parsed["@context"]).toBe("https://schema.org");
      expect(["WebSite", "WebApplication", "BreadcrumbList"]).toContain(parsed["@type"]);
      for (const url of JSON.stringify(parsed).match(/https?:\/\/[^"]+/g) ?? []) {
        if (url.startsWith("https://schema.org")) continue;
        expect(url.startsWith("https://diffnexa.com/")).toBe(true);
      }
    }
  });

  it("states only facts: no ratings, reviews, prices, people or user counts", () => {
    const keys = keysOf([
      websiteJsonLd(),
      ...TOOLS.flatMap((tool) => toolJsonLd(tool.href as never)),
      ...INFO_PAGES.flatMap((page) => infoPageJsonLd(page.path)),
    ]);
    for (const key of FORBIDDEN) expect(keys, key).not.toContain(key);
    for (const key of ["address", "telephone", "foundingDate", "legalName", "sameAs", "logo", "numberOfEmployees"]) {
      expect(keys, key).not.toContain(key);
    }
  });

  it("describes each information page as the kind of page it is, with a breadcrumb", () => {
    const types = Object.fromEntries(INFO_PAGES.map((page) => [page.path, infoPageJsonLd(page.path)[0]["@type"]]));
    expect(types).toEqual({
      "/ai-change-analyst": "WebPage",
      "/about": "AboutPage",
      "/contact": "ContactPage",
      "/privacy-policy": "WebPage",
      "/terms-of-service": "WebPage",
      "/bot": "WebPage",
    });
    for (const page of INFO_PAGES) {
      const [main, crumbs] = infoPageJsonLd(page.path).map((block) => JSON.parse(serializeJsonLd(block)));
      expect(main.url).toBe(`https://diffnexa.com${page.path}`);
      expect(crumbs["@type"]).toBe("BreadcrumbList");
      expect(crumbs.itemListElement[1]).toEqual({
        "@type": "ListItem",
        position: 2,
        name: page.name,
        item: `https://diffnexa.com${page.path}`,
      });
    }
  });

  it("names only the published contact address on the contact page", () => {
    const [contact] = infoPageJsonLd("/contact");
    expect(contact.mainEntity).toEqual({
      "@type": "Organization",
      name: "DiffNexa",
      url: "https://diffnexa.com/",
      email: "info@diffnexa.com",
    });
  });

  it("gives each tool a breadcrumb from the homepage", () => {
    const [app, crumbs] = toolJsonLd("/docx-compare");
    expect(app.name).toBe("DOCX Compare");
    expect(app.url).toBe("https://diffnexa.com/docx-compare");
    expect(crumbs.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "DiffNexa", item: "https://diffnexa.com/" },
      { "@type": "ListItem", position: 2, name: "DOCX Compare", item: "https://diffnexa.com/docx-compare" },
    ]);
  });

  it("cannot be broken out of its script tag", () => {
    expect(serializeJsonLd({ name: "</script><script>alert(1)</script>" })).not.toContain("<");
  });
});

describe("the sitemap", () => {
  it("lists exactly the public pages, each once", () => {
    const paths = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(paths.sort()).toEqual(
      [
        "/",
        "/competitor-monitor",
        "/docx-compare",
        "/excel-compare",
        "/pdf-compare",
        "/policy-monitor",
        "/price-monitor",
        "/website-compare",
        "/ai-change-analyst",
        "/about",
        "/contact",
        "/privacy-policy",
        "/terms-of-service",
        "/bot",
      ].sort(),
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("uses the real domain by default, never localhost", () => {
    for (const entry of sitemap()) {
      expect(entry.url.startsWith("https://diffnexa.com/")).toBe(true);
      expect(entry.url).not.toContain("localhost");
      expect(entry.url).not.toContain("onrender.com");
    }
    expect(String(robots().sitemap)).toBe("https://diffnexa.com/sitemap.xml");
  });

  it("uses the configured site address when a build sets one", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://diffnexa.example");
    const { default: configuredSitemap } = await import("@/app/sitemap");
    const { default: configuredRobots } = await import("@/app/robots");

    for (const entry of configuredSitemap()) {
      expect(entry.url.startsWith("https://diffnexa.example/")).toBe(true);
    }
    expect(String(configuredRobots().sitemap)).toBe("https://diffnexa.example/sitemap.xml");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("lists no API or machinery routes", () => {
    const urls = sitemap().map((entry) => entry.url).join(" ");
    expect(urls).not.toContain("/api");
    expect(urls).not.toContain("pdf-worker");
  });

  it("uses absolute URLs", () => {
    for (const entry of sitemap()) {
      expect(() => new URL(entry.url)).not.toThrow();
      expect(entry.url).not.toContain("//pdf");
    }
  });
});

describe("robots", () => {
  it("allows the public pages", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0]! : rules!;
    expect(rule.allow).toBe("/");
    const disallowed = [rule.disallow ?? []].flat();
    for (const page of PAGES) {
      expect(disallowed).not.toContain(page.path);
    }
  });

  it("keeps machinery out of search results", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0]! : rules!;
    const disallowed = [rule.disallow ?? []].flat();
    expect(disallowed).toContain("/api/");
    expect(disallowed).toContain("/pdf-worker");
  });

  it("points at the sitemap", () => {
    expect(String(robots().sitemap)).toMatch(/\/sitemap\.xml$/);
  });
});

/**
 * Metadata, sitemap and robots.
 *
 * The rule these enforce is the same one that governs the product: say only
 * what is true. V1 comparison is deterministic, so nothing may describe it as
 * AI-powered, and no page may promise a capability that does not exist.
 */

import { describe, expect, it, vi } from "vitest";

import { metadata as rootMetadata, TOOLS } from "@/app/layout";
import { metadata as homeMetadata } from "@/app/page";
import { metadata as competitorMetadata } from "@/app/competitor-monitor/page";
import { metadata as docxMetadata } from "@/app/docx-compare/page";
import { metadata as pdfMetadata } from "@/app/pdf-compare/page";
import { metadata as policyMetadata } from "@/app/policy-monitor/page";
import { metadata as priceMetadata } from "@/app/price-monitor/page";
import { metadata as webMetadata } from "@/app/website-compare/page";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

const PAGES = [
  { name: "home", metadata: homeMetadata, path: "/" },
  { name: "pdf-compare", metadata: pdfMetadata, path: "/pdf-compare" },
  { name: "website-compare", metadata: webMetadata, path: "/website-compare" },
  { name: "policy-monitor", metadata: policyMetadata, path: "/policy-monitor" },
  { name: "competitor-monitor", metadata: competitorMetadata, path: "/competitor-monitor" },
  { name: "price-monitor", metadata: priceMetadata, path: "/price-monitor" },
  { name: "docx-compare", metadata: docxMetadata, path: "/docx-compare" },
];

function titleOf(metadata: (typeof PAGES)[number]["metadata"]): string {
  const title = metadata.title;
  if (typeof title === "string") return title;
  if (title && typeof title === "object" && "absolute" in title) return String(title.absolute);
  return "";
}

describe("the tools", () => {
  it("are listed once, so the header and homepage cannot disagree", () => {
    expect(TOOLS.map((tool) => tool.href)).toEqual([
      "/pdf-compare",
      "/website-compare",
      "/policy-monitor",
      "/competitor-monitor",
      "/price-monitor",
      "/docx-compare",
    ]);
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      "PDF Compare",
      "Website Change Detector",
      "Policy & Terms Monitor",
      "Competitor Monitor",
      "Price Monitor",
      "DOCX Compare",
    ]);
    for (const tool of TOOLS) expect(tool.summary.length).toBeGreaterThan(30);
    expect(TOOLS.find((tool) => tool.href === "/competitor-monitor")?.summary).toBe(
      "Track changes on competitor webpages and see exactly what changed.",
    );
  });

  it("have one entry per public tool page", () => {
    const toolPages = PAGES.filter((page) => page.path !== "/").map((page) => page.path);
    expect(TOOLS.map((tool) => tool.href).sort()).toEqual(toolPages.sort());
  });

  it("describe the policy tool without claiming more than it does", () => {
    const policy = TOOLS.find((tool) => tool.href === "/policy-monitor")!;
    expect(policy.summary).toMatch(/baseline/i);
    const wording = policy.summary.toLowerCase();
    for (const claim of [
      "\\bai\\b", "automatic", "automated", "alerts?", "scheduled?", "monitors? for you",
      "legal advice", "compliance", "risks?", "history",
    ]) {
      expect(wording, `claims ${claim}`).not.toMatch(new RegExp(claim));
    }
  });
});

describe("page metadata", () => {
  it("gives the homepage the agreed title and description", () => {
    expect(titleOf(homeMetadata)).toBe("DiffNexa — Compare Documents and Web Pages");
    expect(homeMetadata.description).toBe(
      "Compare PDF documents and public web pages to see exactly what changed, with clear evidence you can verify.",
    );
  });

  it("gives every public page a canonical URL", () => {
    for (const page of PAGES) {
      expect(page.metadata.alternates?.canonical).toBe(page.path);
    }
  });

  it("gives every public page a distinct title and description", () => {
    const titles = PAGES.map((page) => titleOf(page.metadata));
    const descriptions = PAGES.map((page) => String(page.metadata.description));
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const description of descriptions) {
      expect(description.length).toBeGreaterThan(70);
      expect(description.length).toBeLessThan(200);
    }
  });

  it("gives every public page Open Graph details", () => {
    for (const page of PAGES) {
      const openGraph = page.metadata.openGraph as Record<string, unknown> | undefined;
      expect(openGraph?.type).toBe("website");
      expect(String(openGraph?.title).length).toBeGreaterThan(10);
      expect(String(openGraph?.description).length).toBeGreaterThan(40);
    }
  });

  it("never claims the comparison uses AI", () => {
    const wording = [
      ...PAGES.map((page) => `${titleOf(page.metadata)} ${page.metadata.description}`),
      String(rootMetadata.description),
      ...TOOLS.map((tool) => tool.summary),
    ]
      .join(" ")
      .toLowerCase();
    expect(wording).not.toMatch(/\bai[- ]?(powered|driven|based)?\b/);
    expect(wording).not.toContain("artificial intelligence");
    expect(wording).not.toContain("machine learning");
  });

  it("does not repeat the site name inside the homepage title template", () => {
    // The layout appends " | DiffNexa"; the homepage title is absolute so it
    // does not become "DiffNexa ... | DiffNexa".
    expect(titleOf(homeMetadata).match(/DiffNexa/g)?.length).toBe(1);
  });

  it("keeps the site-wide description honest and short", () => {
    expect(String(rootMetadata.description).length).toBeLessThan(200);
  });
});

describe("the policy monitor page", () => {
  it("has a title naming the product and what it finds", () => {
    const title = titleOf(policyMetadata);
    expect(title).toContain("Policy");
    expect(title.length).toBeLessThan(70);
  });

  it("describes the real workflow in its description", () => {
    const description = String(policyMetadata.description);
    expect(description).toContain("baseline");
    expect(description).toMatch(/compare/i);
  });

  it("claims no capability the product does not have", () => {
    const wording = [
      titleOf(policyMetadata),
      String(policyMetadata.description),
      String((policyMetadata.openGraph as Record<string, unknown>)?.title),
      String((policyMetadata.openGraph as Record<string, unknown>)?.description),
    ]
      .join(" ")
      .toLowerCase();

    const forbidden = [
      "ai",
      "ai-powered",
      "automatic",
      "automatically",
      "automated",
      "alerts?",
      "scheduled?",
      "continuous",
      "legal advice",
      "compliance",
      "risks?",
      "crawls?",
      "history",
    ];
    for (const claim of forbidden) {
      expect(wording, `claims ${claim}`).not.toMatch(new RegExp(`\\b${claim}\\b`));
    }
  });

  it("does not repeat the same phrase for the sake of it", () => {
    const description = String(policyMetadata.description).toLowerCase();
    const counts = new Map<string, number>();
    for (const word of description.split(/\W+/).filter((w) => w.length > 4)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    for (const [word, count] of counts) {
      expect(count, `"${word}" repeats ${count} times`).toBeLessThanOrEqual(2);
    }
  });
});

describe("the competitor monitor page", () => {
  it("has exactly the agreed title and description", () => {
    expect(titleOf(competitorMetadata)).toBe(
      "Competitor Monitor — Track What Changes on Competitor Websites",
    );
    expect(competitorMetadata.description).toBe(
      "Compare a competitor’s public webpage with your saved baseline and see exactly what changed, with evidence for every detected change.",
    );
  });

  it("is canonical at its own address, with matching Open Graph details", () => {
    expect(competitorMetadata.alternates?.canonical).toBe("/competitor-monitor");
    const openGraph = competitorMetadata.openGraph as Record<string, unknown>;
    expect(openGraph.url).toBe("/competitor-monitor");
    expect(openGraph.title).toBe(titleOf(competitorMetadata));
    expect(openGraph.description).toBe(competitorMetadata.description);
  });

  it("does not have the site name appended to a title that already names the product", () => {
    expect(competitorMetadata.title).toEqual({ absolute: titleOf(competitorMetadata) });
  });

  it("claims no capability the product does not have", () => {
    const wording = `${titleOf(competitorMetadata)} ${competitorMetadata.description}`.toLowerCase();
    for (const claim of [
      "ai", "automatic", "automatically", "automated", "alerts?", "scheduled?", "continuous",
      "real-time", "crawls?", "history", "screenshots?", "threats?", "risks?", "opportunit(y|ies)",
    ]) {
      expect(wording, `claims ${claim}`).not.toMatch(new RegExp(`\\b${claim}\\b`));
    }
  });
});

describe("the price monitor page", () => {
  it("has the agreed title, with the site name added once by the template", async () => {
    expect(titleOf(priceMetadata)).toBe("Price Monitor — Track Changes on Public Pricing Pages");
    const openGraph = priceMetadata.openGraph as Record<string, unknown>;
    expect(openGraph.title).toBe("Price Monitor — Track Changes on Public Pricing Pages | DiffNexa");
    const { metadata: root } = await import("@/app/layout");
    const template = (root.title as { template: string }).template;
    expect(template.replace("%s", titleOf(priceMetadata))).toBe(
      "Price Monitor — Track Changes on Public Pricing Pages | DiffNexa",
    );
  });

  it("has the agreed description, canonical and Open Graph address", () => {
    expect(priceMetadata.description).toBe(
      "Compare a public pricing or product page with your saved baseline and see exactly what changed, with evidence you can verify.",
    );
    expect(priceMetadata.alternates?.canonical).toBe("/price-monitor");
    expect((priceMetadata.openGraph as Record<string, unknown>).url).toBe("/price-monitor");
  });

  it("claims no capability the product does not have and judges no price", () => {
    const openGraph = priceMetadata.openGraph as Record<string, unknown>;
    const wording = `${titleOf(priceMetadata)} ${priceMetadata.description} ${openGraph.title} ${openGraph.description}`.toLowerCase();
    for (const claim of [
      "ai", "automatic", "automatically", "alerts?", "scheduled?", "real-time", "notifications?",
      "cheapest", "best price", "deals?", "forecast", "predict", "amazon", "history",
    ]) {
      expect(wording, `claims ${claim}`).not.toMatch(new RegExp(`\\b${claim}\\b`));
    }
  });

  it("describes the tool card in the agreed words", () => {
    expect(TOOLS.find((tool) => tool.href === "/price-monitor")?.summary).toBe(
      "Track changes on public pricing and product pages and see exactly what changed.",
    );
  });
});

describe("the docx compare page", () => {
  it("has the agreed title, with the site name added once by the template", async () => {
    expect(titleOf(docxMetadata)).toBe("DOCX Compare — Compare Word Documents and Find Changes");
    const openGraph = docxMetadata.openGraph as Record<string, unknown>;
    expect(openGraph.title).toBe("DOCX Compare — Compare Word Documents and Find Changes | DiffNexa");
    const { metadata: root } = await import("@/app/layout");
    const template = (root.title as { template: string }).template;
    expect(template.replace("%s", titleOf(docxMetadata))).toBe(
      "DOCX Compare — Compare Word Documents and Find Changes | DiffNexa",
    );
  });

  it("has the agreed description, canonical and Open Graph address", () => {
    expect(docxMetadata.description).toBe(
      "Compare two DOCX documents and see exactly what changed, with evidence you can verify.",
    );
    expect(docxMetadata.alternates?.canonical).toBe("/docx-compare");
    expect((docxMetadata.openGraph as Record<string, unknown>).url).toBe("/docx-compare");
  });

  it("claims no capability the product does not have", () => {
    const openGraph = docxMetadata.openGraph as Record<string, unknown>;
    const wording = `${titleOf(docxMetadata)} ${docxMetadata.description} ${openGraph.title} ${openGraph.description}`.toLowerCase();
    for (const claim of [
      "ai", "automatic", "visual", "images?", "formatting", "\\.doc\\b", "legacy", "pdf", "important",
    ]) {
      expect(wording, `claims ${claim}`).not.toMatch(new RegExp(`\\b${claim}\\b`));
    }
  });

  it("describes the tool card in the agreed words", () => {
    const tool = TOOLS.find((item) => item.href === "/docx-compare");
    expect(tool?.name).toBe("DOCX Compare");
    expect(tool?.summary).toBe(
      "Compare two Word documents and find changes in text, numbers, dates, lists, and tables.",
    );
  });

  it("is in the sitemap once", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.filter((url) => url.endsWith("/docx-compare"))).toHaveLength(1);
  });
});

describe("the sitemap", () => {
  it("lists exactly the public pages", () => {
    const paths = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(paths.sort()).toEqual([
      "/",
      "/competitor-monitor",
      "/docx-compare",
      "/pdf-compare",
      "/policy-monitor",
      "/price-monitor",
      "/website-compare",
    ].sort());
  });

  it("includes the price monitor route once", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.filter((url) => url.endsWith("/price-monitor"))).toHaveLength(1);
  });

  it("includes the competitor monitor route", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("http://localhost:3000/competitor-monitor");
    expect(urls.filter((url) => url.endsWith("/competitor-monitor"))).toHaveLength(1);
  });

  it("includes the policy monitor route", () => {
    const paths = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(paths).toContain("/policy-monitor");
  });

  it("uses the configured site address rather than a hard-coded one", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://diffnexa.example");
    const { default: configuredSitemap } = await import("@/app/sitemap");
    const { default: configuredRobots } = await import("@/app/robots");

    for (const entry of configuredSitemap()) {
      expect(entry.url.startsWith("https://diffnexa.example/")).toBe(true);
      expect(entry.url).not.toContain("localhost");
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

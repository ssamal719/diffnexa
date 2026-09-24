/**
 * @vitest-environment jsdom
 *
 * The pages about DiffNexa itself — About, Contact, Privacy Policy, Terms of
 * Service, AI Change Analyst, DiffNexaBot — and the written content of the tool
 * pages.
 *
 * The promises under test: every page has one H1, a breadcrumb and structured
 * data; the privacy policy discloses analytics and future advertising the way
 * Google asks, without claiming advertising runs today; nothing claims an
 * approval, certification or company fact DiffNexa has not published; the
 * contact page has no form that goes nowhere; every tool page explains itself
 * with its own questions; and the pages link to each other as a reader needs.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOOLS } from "@/lib/tools";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
afterEach(cleanup);

const INFO = [
  ["/about", "About", () => import("@/app/about/page"), "AboutPage"],
  ["/contact", "Contact", () => import("@/app/contact/page"), "ContactPage"],
  ["/privacy-policy", "Privacy Policy", () => import("@/app/privacy-policy/page"), "WebPage"],
  ["/terms-of-service", "Terms of Service", () => import("@/app/terms-of-service/page"), "WebPage"],
  ["/ai-change-analyst", "AI Change Analyst", () => import("@/app/ai-change-analyst/page"), "WebPage"],
  ["/bot", "DiffNexaBot", () => import("@/app/bot/page"), "WebPage"],
] as const;

const TOOL_PAGES = [
  ["/pdf-compare", () => import("@/app/pdf-compare/page")],
  ["/docx-compare", () => import("@/app/docx-compare/page")],
  ["/excel-compare", () => import("@/app/excel-compare/page")],
  ["/website-compare", () => import("@/app/website-compare/page")],
  ["/policy-monitor", () => import("@/app/policy-monitor/page")],
  ["/competitor-monitor", () => import("@/app/competitor-monitor/page")],
  ["/price-monitor", () => import("@/app/price-monitor/page")],
] as const;

async function show(load: () => Promise<{ default: () => React.JSX.Element }>) {
  const { default: Page } = await load();
  return render(<Page />);
}

function hrefs(root: ParentNode = document): string[] {
  return Array.from(root.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

function text(): string {
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
}

/** Claims DiffNexa cannot make. */
const NEVER = [
  /adsense[- ]approved/i,
  /google[- ]approved/i,
  /adsense[- ]compliant/i,
  /gdpr[- ](certified|compliant)/i,
  /soc ?2/i,
  /iso ?27001/i,
  /industry[- ]leading/i,
  /most accurate/i,
  /trusted by/i,
  /millions of/i,
  /thousands of (users|customers|teams)/i,
  /enterprise[- ]grade/i,
  /\bbest\b/i,
  /coming soon/i,
  /lorem ipsum/i,
  /ca-pub-\d/i,
  /registered office/i,
  /company (registration|number)/i,
  /\bgst(in)?\b/i,
  /governed by the laws of/i,
  /\+\d[\d\s-]{7,}/,
];

describe.each(INFO)("the %s page", (path, name, load, schemaType) => {
  it("has one H1, a breadcrumb naming it, and its structured data in the HTML", async () => {
    const { container } = await show(load);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "DiffNexa" }).getAttribute("href")).toBe("/");
    expect(crumbs.querySelector('[aria-current="page"]')?.textContent).toBe(name);
    const types = Array.from(container.querySelectorAll('script[type="application/ld+json"]')).flatMap((script) =>
      JSON.parse(script.textContent!).map((item: { "@type": string }) => item["@type"]),
    );
    expect(types).toEqual([schemaType, "BreadcrumbList"]);
    expect(path).toMatch(/^\//);
  });

  it("keeps a sensible heading order", async () => {
    await show(load);
    const levels = screen.getAllByRole("heading").map((node) => Number(node.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `jump at heading ${i}`).toBeLessThanOrEqual(1);
    }
  });

  it("makes no claim DiffNexa cannot support", async () => {
    await show(load);
    for (const claim of NEVER) expect(text(), String(claim)).not.toMatch(claim);
  });

  it("gives every in-page link a target that exists", async () => {
    await show(load);
    for (const href of hrefs().filter((value) => value.startsWith("#"))) {
      expect(document.getElementById(href.slice(1)), href).toBeTruthy();
    }
  });
});

describe("the privacy policy", () => {
  const load = () => import("@/app/privacy-policy/page");

  it("says plainly that no advertising runs today", async () => {
    await show(load);
    expect(text()).toContain("DiffNexa does not currently show advertising.");
  });

  it("carries the disclosures Google asks of advertising publishers, for when advertising is enabled", async () => {
    await show(load);
    const section = document.getElementById("advertising")!.parentElement!;
    const words = text();
    expect(words).toContain(
      "Third-party vendors, including Google, use cookies to serve ads based on a user's prior visits to this website or other websites.",
    );
    expect(words).toContain(
      "Google's use of advertising cookies enables it and its partners to serve ads to users based on their visits to this site and/or other sites on the Internet.",
    );
    expect(hrefs(section)).toEqual(expect.arrayContaining(["https://www.google.com/settings/ads", "https://www.aboutads.info"]));
  });

  it("describes the analytics that is actually installed, and how to opt out", async () => {
    await show(load);
    const words = text();
    expect(words).toContain("Google Analytics 4");
    expect(words).toContain("_ga");
    expect(hrefs()).toEqual(
      expect.arrayContaining(["https://tools.google.com/dlpage/gaoptout", "https://policies.google.com/technologies/partner-sites"]),
    );
  });

  it("names the hosting providers and describes file handling without overclaiming", async () => {
    await show(load);
    const words = text();
    expect(words).toContain("Hostinger");
    expect(words).toContain("Render");
    expect(words).toContain("temporary file");
    expect(words).not.toMatch(/never (touch|written to) (the )?disk/i);
    expect(words).not.toMatch(/end-to-end encrypt|encrypted at rest/i);
  });

  it("points to the contact page and the terms", async () => {
    await show(load);
    expect(hrefs()).toEqual(expect.arrayContaining(["/contact", "/terms-of-service", "mailto:info@diffnexa.com"]));
  });
});

describe("the terms of service", () => {
  const load = () => import("@/app/terms-of-service/page");

  it("says results have limits and important ones should be verified", async () => {
    await show(load);
    const words = text();
    expect(words).toContain("does not guarantee that it will find every change");
    expect(words).toContain("Verify important results yourself");
    expect(words).toContain("does not provide legal, financial, tax, compliance or other professional advice");
  });

  it("points to the contact page and the privacy policy", async () => {
    await show(load);
    expect(hrefs()).toEqual(expect.arrayContaining(["/contact", "/privacy-policy", "mailto:info@diffnexa.com"]));
  });
});

describe("the contact page", () => {
  const load = () => import("@/app/contact/page");

  it("offers the email address, and no form that could not send anything", async () => {
    const { container } = await show(load);
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelectorAll("input, textarea")).toHaveLength(0);
    const mail = hrefs().filter((href) => href.startsWith("mailto:"));
    expect(new Set(mail)).toEqual(new Set(["mailto:info@diffnexa.com"]));
    expect(screen.getAllByText("info@diffnexa.com").length).toBeGreaterThan(0);
  });

  it("explains what to write about, and links to About, Privacy and Terms", async () => {
    await show(load);
    for (const reason of ["Product questions", "Bug reports", "Privacy requests", "Legal questions", "Feedback", "Partnerships and business"]) {
      expect(screen.getByText(reason)).toBeTruthy();
    }
    expect(hrefs()).toEqual(expect.arrayContaining(["/about", "/privacy-policy", "/terms-of-service"]));
  });
});

describe("the about page", () => {
  it("links to every tool and to AI Change Analyst", async () => {
    await show(() => import("@/app/about/page"));
    expect(hrefs()).toEqual(expect.arrayContaining([...TOOLS.map((tool) => tool.href), "/ai-change-analyst", "/contact"]));
  });
});

describe("the AI Change Analyst page", () => {
  it("answers the questions people ask about AI, and links to every tool it works in", async () => {
    await show(() => import("@/app/ai-change-analyst/page"));
    for (const question of [
      "Does AI determine whether a change happened?",
      "Does AI generate evidence?",
      "What happens if AI is unavailable?",
    ]) {
      expect(screen.getByText(question)).toBeTruthy();
    }
    expect(hrefs()).toEqual(expect.arrayContaining(TOOLS.map((tool) => tool.href)));
  });
});

describe("the DiffNexaBot page", () => {
  it("shows exactly the user agent the page fetcher sends", async () => {
    const engine = readFileSync(
      join(import.meta.dirname, "..", "..", "engine", "diffnexa_engine", "web", "urls.py"),
      "utf8",
    );
    const agent = engine.match(/user_agent: str = "([^"]+)"/)![1];
    await show(() => import("@/app/bot/page"));
    expect(screen.getByText(agent)).toBeTruthy();
    expect(agent).toContain("https://diffnexa.com/bot");
  });
});

describe("the tool pages' written content", () => {
  async function questionsOn(load: (typeof TOOL_PAGES)[number][1]) {
    await show(load);
    const faq = document.getElementById("faq") ?? document.getElementById("questions");
    const questions = Array.from(faq!.closest("section")!.querySelectorAll("dt")).map((dt) => dt.textContent!.trim());
    cleanup();
    return questions;
  }

  it.each(TOOL_PAGES)("%s explains what it is, what happens to your data, its limits and its AI step", async (path, load) => {
    await show(load);
    const ids = Array.from(document.querySelectorAll("section[aria-labelledby]")).map((s) => s.getAttribute("aria-labelledby"));
    expect(ids.some((id) => id?.startsWith("what-is-")), "what is").toBe(true);
    expect(ids, "data").toContain("privacy");
    expect(ids.some((id) => ["limitations", "limits", "not-compared"].includes(id!)), "limits").toBe(true);
    expect(ids, "AI step").toContain("ai-change-analyst");
    expect(hrefs()).toEqual(expect.arrayContaining(["/ai-change-analyst", "/privacy-policy", ...TOOLS.find((t) => t.href === path)!.related]));
  });

  it("asks each page's own questions, not the same ones everywhere", async () => {
    const byPage = new Map<string, string[]>();
    for (const [path, load] of TOOL_PAGES) byPage.set(path, await questionsOn(load));
    for (const [path, questions] of byPage) {
      expect(questions.length, path).toBeGreaterThanOrEqual(5);
      expect(new Set(questions).size, `${path} repeats a question`).toBe(questions.length);
      const own = questions.filter((question) =>
        [...byPage].every(([other, theirs]) => other === path || !theirs.includes(question)),
      );
      expect(own.length, `${path} has too few questions of its own`).toBeGreaterThanOrEqual(2);
    }
    const everywhere = [...byPage.values()][0].filter((question) => [...byPage.values()].every((qs) => qs.includes(question)));
    expect(everywhere).toEqual([]);
  });
});

describe("contact addresses across the site", () => {
  it("uses only info@diffnexa.com", () => {
    const root = join(import.meta.dirname, "..", "src");
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) {
          for (const match of readFileSync(full, "utf8").matchAll(/[a-z0-9._-]+@diffnexa\.com/gi)) found.add(match[0]);
        }
      }
    };
    walk(root);
    expect([...found]).toEqual(["info@diffnexa.com"]);
  });
});

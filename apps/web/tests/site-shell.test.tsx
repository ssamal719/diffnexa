/**
 * @vitest-environment jsdom
 *
 * The site around the tools: header, footer, 404 page, and the shared top and
 * bottom of every tool page.
 *
 * The promises under test: every tool is one real link away from every page;
 * menus work with a keyboard and say what state they are in; the current page
 * is marked; the footer links only to things that exist; every tool page has
 * one H1, a breadcrumb, related tools and structured data in its HTML.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import NotFound, { metadata as notFoundMetadata } from "@/app/not-found";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { TOOLS, toolByHref } from "@/lib/tools";

let currentPath = "/";
vi.mock("next/navigation", () => ({ usePathname: () => currentPath }));

afterEach(cleanup);
beforeEach(() => {
  currentPath = "/";
});

const TOOL_PAGES = [
  ["/pdf-compare", () => import("@/app/pdf-compare/page")],
  ["/docx-compare", () => import("@/app/docx-compare/page")],
  ["/excel-compare", () => import("@/app/excel-compare/page")],
  ["/website-compare", () => import("@/app/website-compare/page")],
  ["/policy-monitor", () => import("@/app/policy-monitor/page")],
  ["/competitor-monitor", () => import("@/app/competitor-monitor/page")],
  ["/price-monitor", () => import("@/app/price-monitor/page")],
] as const;

describe("the header", () => {
  it("groups the tools into files to compare and web pages to check", () => {
    render(<SiteHeader />);
    const compare = screen.getByRole("button", { name: /^Compare/ });
    const monitor = screen.getByRole("button", { name: /^Web Monitoring/ });
    const inList = (button: HTMLElement) =>
      Array.from(document.getElementById(button.getAttribute("aria-controls")!)!.querySelectorAll("a")).map((a) =>
        a.getAttribute("href"),
      );
    expect(inList(compare)).toEqual(["/pdf-compare", "/docx-compare", "/excel-compare"]);
    expect(inList(monitor)).toEqual(["/website-compare", "/policy-monitor", "/competitor-monitor", "/price-monitor"]);
  });

  it("opens and closes a menu, saying so to assistive technology", () => {
    render(<SiteHeader />);
    const compare = screen.getByRole("button", { name: /^Compare/ });
    const list = document.getElementById(compare.getAttribute("aria-controls")!)!;
    expect(compare.getAttribute("aria-expanded")).toBe("false");
    expect(list.className).toContain("lg:hidden");
    fireEvent.click(compare);
    expect(compare.getAttribute("aria-expanded")).toBe("true");
    expect(list.className).toContain("lg:grid");
    // Opening one menu closes the other.
    fireEvent.click(screen.getByRole("button", { name: /^Web Monitoring/ }));
    expect(compare.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes with Escape and returns focus to the menu's button", () => {
    render(<SiteHeader />);
    const compare = screen.getByRole("button", { name: /^Compare/ });
    fireEvent.click(compare);
    within(document.getElementById(compare.getAttribute("aria-controls")!)!).getAllByRole("link")[0].focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(compare.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(compare);
  });

  it("closes when someone clicks elsewhere on the page", () => {
    render(
      <>
        <SiteHeader />
        <p>Elsewhere</p>
      </>,
    );
    const monitor = screen.getByRole("button", { name: /^Web Monitoring/ });
    fireEvent.click(monitor);
    fireEvent.mouseDown(screen.getByText("Elsewhere"));
    expect(monitor.getAttribute("aria-expanded")).toBe("false");
  });

  it("marks the page you are on, and its group", () => {
    currentPath = "/policy-monitor";
    render(<SiteHeader />);
    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/policy-monitor"]);
    expect(screen.getByRole("button", { name: /^Web Monitoring/ }).className).toContain("text-signal");
    expect(screen.getByRole("button", { name: /^Compare/ }).className).not.toContain("text-signal");
  });

  it("links home from the brand, and to how DiffNexa and its AI step work", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "DiffNexa home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "How it works" }).getAttribute("href")).toBe("/#how-it-works");
    expect(screen.getByRole("link", { name: "AI Change Analyst" }).getAttribute("href")).toBe("/#ai-change-analyst");
  });
});

describe("the footer", () => {
  it("links to every tool once, and only to pages and sections that exist", () => {
    render(<SiteFooter />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href")!);
    for (const tool of TOOLS) expect(hrefs.filter((href) => href === tool.href)).toHaveLength(1);
    const known = new Set(["/", ...TOOLS.map((tool) => tool.href), "/#how-it-works", "/#ai-change-analyst", "/#your-data"]);
    for (const href of hrefs) expect(known.has(href), href).toBe(true);
  });

  it("does not list legal or company pages that have not been written", () => {
    render(<SiteFooter />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const missing of ["privacy policy", "terms of service", "about us", "contact", "careers", "blog"]) {
      expect(text, missing).not.toContain(missing);
    }
  });

  it("carries the brand and copyright", () => {
    render(<SiteFooter />);
    expect(screen.getByText("Know What Changed.")).toBeTruthy();
    expect(document.body.textContent).toMatch(/© \d{4} DiffNexa\. All rights reserved\./);
  });

  it("points at homepage sections that really exist", () => {
    render(<HomePage />);
    for (const id of ["how-it-works", "ai-change-analyst", "your-data", "tools"]) {
      expect(document.getElementById(id), id).toBeTruthy();
    }
  });
});

describe("the homepage", () => {
  it("offers the two ways in, as real links", () => {
    render(<HomePage />);
    const compare = screen.getAllByRole("link", { name: "Compare a Document" });
    const monitor = screen.getAllByRole("link", { name: "Monitor a Web Page" });
    expect(compare.every((link) => link.getAttribute("href") === "/pdf-compare")).toBe(true);
    expect(monitor.every((link) => link.getAttribute("href") === "/website-compare")).toBe(true);
  });

  it("introduces AI Change Analyst as a second step, not the product", () => {
    render(<HomePage />);
    const heading = screen.getByRole("heading", { name: "Understand the changes, after they are found." });
    expect(heading.tagName).toBe("H2");
    expect(document.body.textContent).toContain(
      "AI Change Analyst explains changes already detected by DiffNexa's deterministic comparison. It does not independently decide what changed.",
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toMatch(/\bAI\b/);
  });

  it("explains in three steps how a comparison works", () => {
    render(<HomePage />);
    const section = document.getElementById("how-it-works")!;
    const steps = within(section).getAllByRole("listitem");
    expect(steps.map((step) => step.querySelector("h3")?.textContent)).toEqual([
      "Step 1: Compare",
      "Step 2: Find",
      "Step 3: Prove",
    ]);
  });

  it("says plainly what happens to files, pages, AI requests and analytics", () => {
    render(<HomePage />);
    const text = document.getElementById("your-data")!.textContent ?? "";
    expect(text).toContain("compared in memory, and discarded");
    expect(text).toContain("The baseline is a file you download and keep");
    expect(text).toContain("Only when you ask");
    expect(text).toContain("Google Analytics");
  });

  it("labels its sample result as an example", () => {
    render(<HomePage />);
    expect(screen.getByText("Example result")).toBeTruthy();
  });

  it("describes the site to search engines with facts only", () => {
    const { container } = render(<HomePage />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    const data = JSON.parse(script.textContent!);
    expect(data["@type"]).toBe("WebSite");
    expect(data.url).toBe("https://diffnexa.com/");
    expect(data.hasPart).toHaveLength(TOOLS.length);
  });
});

describe.each(TOOL_PAGES)("the %s page", (path, load) => {
  async function renderPage() {
    const { default: Page } = await load();
    return render(<Page />);
  }

  it("has one H1, a breadcrumb naming the tool, and structured data in its HTML", async () => {
    const { container } = await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "DiffNexa" }).getAttribute("href")).toBe("/");
    expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe(toolByHref(path).name);
    const types = Array.from(container.querySelectorAll('script[type="application/ld+json"]')).flatMap((script) =>
      JSON.parse(script.textContent!).map((item: { "@type": string }) => item["@type"]),
    );
    expect(types).toEqual(["WebApplication", "BreadcrumbList"]);
  });

  it("links to its related tools", async () => {
    await renderPage();
    const section = screen.getByRole("region", { name: "Related tools" });
    const hrefs = within(section).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(toolByHref(path).related);
  });

  it("keeps a sensible heading order", async () => {
    await renderPage();
    const levels = screen.getAllByRole("heading").map((node) => Number(node.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `jump at heading ${i}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("the 404 page", () => {
  it("says the page does not exist and offers every real page instead", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This page does not exist.");
    expect(screen.getByRole("link", { name: "Go to the homepage" }).getAttribute("href")).toBe("/");
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    for (const tool of TOOLS) expect(hrefs).toContain(tool.href);
  });

  it("is kept out of search results", () => {
    expect(notFoundMetadata.robots).toEqual({ index: false, follow: true });
  });
});

/**
 * @vitest-environment jsdom
 *
 * The homepage and the site header, rendered.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HomePage from "@/app/page";
import { metadata as rootMetadata } from "@/app/layout";
import { SiteHeader } from "@/components/site/SiteHeader";
import { TOOLS } from "@/lib/tools";

afterEach(cleanup);

describe("the homepage", () => {
  it("leads with the positioning line", () => {
    render(<HomePage />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Know What Changed.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("says what DiffNexa does without overclaiming", () => {
    render(<HomePage />);
    expect(document.body.textContent).toContain(
      "compares documents and web pages to show exactly what changed",
    );
    expect(document.body.textContent?.toLowerCase()).not.toContain("ai-powered");
  });

  it("presents both tools with a description and a link", () => {
    render(<HomePage />);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(TOOLS.length);

    for (const tool of TOOLS) {
      const card = cards.find((element) => element.textContent?.includes(tool.name));
      expect(card, `no card for ${tool.name}`).toBeTruthy();
      expect(card!.textContent).toContain(tool.summary);
      const link = within(card!).getByRole("link", { name: `Open ${tool.name}` });
      expect(link.getAttribute("href")).toBe(tool.href);
    }
  });

  it("uses ordinary crawlable links to every tool", () => {
    render(<HomePage />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/pdf-compare");
    expect(hrefs).toContain("/website-compare");
    expect(hrefs).toContain("/policy-monitor");
    expect(hrefs).toContain("/competitor-monitor");
    expect(hrefs).toContain("/price-monitor");
    expect(hrefs).toContain("/docx-compare");
    expect(hrefs).toContain("/excel-compare");
  });

  it("shows a card for every tool, each linking to its own page", () => {
    render(<HomePage />);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(7);

    for (const tool of TOOLS) {
      const card = cards.find((element) => element.textContent?.includes(tool.name));
      expect(card, `no card for ${tool.name}`).toBeTruthy();
      const link = within(card!).getByRole("link", { name: `Open ${tool.name}` });
      expect(link.getAttribute("href")).toBe(tool.href);
    }
  });

  it("describes the policy tool as a comparison against a saved baseline", () => {
    render(<HomePage />);
    const card = screen
      .getAllByRole("article")
      .find((element) => element.textContent?.includes("Policy & Terms Monitor"))!;
    expect(card.textContent).toContain("baseline");
    expect(card.textContent).toContain("which part of the document changed");
  });

  it("describes Competitor Monitor in the agreed words", () => {
    render(<HomePage />);
    const card = screen
      .getAllByRole("article")
      .find((element) => element.textContent?.includes("Competitor Monitor"))!;
    expect(card.textContent).toContain(
      "Track changes on competitor webpages and see exactly what changed.",
    );
  });

  it("claims nothing the tools cannot do", () => {
    render(<HomePage />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const claim of [
      "ai-powered", "artificial intelligence", "we monitor", "we alert", "automatically checks",
      "risk score", "compliance", "legal advice", "24/7",
    ]) {
      expect(text, `claims ${claim}`).not.toContain(claim);
    }
  });

  it("keeps the existing tools described as before", () => {
    render(<HomePage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Compare two PDF versions and find changes in text, numbers, dates, and pages.");
    expect(text).toContain(
      "Capture a public webpage and later compare it against your saved baseline to see what changed.",
    );
  });

  it("explains how it works in the page text, not behind a script", () => {
    render(<HomePage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Evidence for every change");
    expect(text).toContain("deterministic");
    expect(text).toContain("no AI decides what changed");
  });

  it("keeps a sensible heading order", () => {
    render(<HomePage />);
    const levels = screen.getAllByRole("heading", { hidden: true }).map((node) => Number(node.tagName.slice(1)));
    expect(Math.min(...levels)).toBe(1);
    expect(Math.max(...levels)).toBeLessThanOrEqual(3);
  });
});

describe("the policy monitor page", () => {
  it("has exactly one H1, saying what the tool does", async () => {
    const { default: PolicyMonitorPage } = await import("@/app/policy-monitor/page");
    render(<PolicyMonitorPage />);

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("See what changed in a policy or terms page");
  });

  it("explains the real workflow in the page text", async () => {
    const { default: PolicyMonitorPage } = await import("@/app/policy-monitor/page");
    render(<PolicyMonitorPage />);
    const text = document.body.textContent ?? "";

    expect(text).toContain("baseline");
    expect(text).toContain("Capture the page");
    expect(text).toContain("stays on your computer");
    expect(text).toContain("Check when you choose");
  });

  it("separates itself from Website Change Detector", async () => {
    const { default: PolicyMonitorPage } = await import("@/app/policy-monitor/page");
    render(<PolicyMonitorPage />);
    expect(screen.getByRole("heading", { name: /Policy Monitor or Website Change Detector/ })).toBeTruthy();
  });

  it("states plainly what it does not do", async () => {
    const { default: PolicyMonitorPage } = await import("@/app/policy-monitor/page");
    render(<PolicyMonitorPage />);
    const text = (document.body.textContent ?? "").toLowerCase();

    expect(text).toContain("does not watch pages for you");
    expect(text).toContain("no scheduled checking");
    expect(text).toContain("judgement for you or your lawyer");
  });

  it("makes no claim of AI, risk scoring or compliance assessment", async () => {
    const { default: PolicyMonitorPage } = await import("@/app/policy-monitor/page");
    render(<PolicyMonitorPage />);
    const text = (document.body.textContent ?? "").toLowerCase();

    for (const claim of ["ai-powered", "artificial intelligence", "risk score", "compliance check",
                         "legally significant", "guaranteed", "we alert you"]) {
      expect(text).not.toContain(claim);
    }
  });

  it("uses a sensible heading order", async () => {
    const { default: PolicyMonitorPage } = await import("@/app/policy-monitor/page");
    render(<PolicyMonitorPage />);
    const levels = screen.getAllByRole("heading").map((node) => Number(node.tagName.slice(1)));
    expect(Math.min(...levels)).toBe(1);
    expect(Math.max(...levels)).toBeLessThanOrEqual(3);
  });
});

describe("site navigation", () => {
  function renderHeader() {
    // The real header the layout renders, not a copy of it.
    const { container } = render(<SiteHeader />);
    return container;
  }

  it("links to every tool from the header", () => {
    const container = renderHeader();
    const nav = container.querySelector('nav[aria-label="Tools"]')!;
    const links = Array.from(nav.querySelectorAll("a"));

    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      TOOLS.map((tool) => tool.href),
    );
    expect(links.map((link) => link.textContent)).toEqual(TOOLS.map((tool) => tool.name));
  });

  it("makes Policy Monitor directly reachable", () => {
    const container = renderHeader();
    const link = Array.from(container.querySelectorAll("a")).find(
      (anchor) => anchor.getAttribute("href") === "/policy-monitor",
    );
    expect(link).toBeTruthy();
    expect(link!.textContent).toBe("Policy & Terms Monitor");
  });

  it("wraps rather than overflowing on a narrow screen", () => {
    const container = renderHeader();
    const nav = container.querySelector('nav[aria-label="Tools"]')!;
    const row = nav.parentElement!;
    // Both the row and the nav wrap, so three tool names cannot force a
    // horizontal scrollbar on a phone.
    expect(row.className).toContain("flex-wrap");
    expect(nav.className).toContain("flex-wrap");
  });

  it("names the navigation for assistive technology", () => {
    const container = renderHeader();
    expect(container.querySelector('nav[aria-label="Tools"]')).toBeTruthy();
  });

  it("keeps the site-wide metadata unchanged", () => {
    expect(rootMetadata.description).toBe(
      "Compare PDF documents and public web pages to see exactly what changed, with clear evidence you can verify.",
    );
  });
});

describe("the competitor monitor page", () => {
  it("is reachable from the header", () => {
    const { container } = render(<SiteHeader />);
    const link = Array.from(container.querySelectorAll("a")).find(
      (anchor) => anchor.getAttribute("href") === "/competitor-monitor",
    );
    expect(link?.textContent).toBe("Competitor Monitor");
  });

  it("has exactly one H1, saying what the tool does", async () => {
    const { default: CompetitorMonitorPage } = await import("@/app/competitor-monitor/page");
    render(<CompetitorMonitorPage />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("See what changed on a competitor's webpage");
  });

  it("states the V1 limits plainly", async () => {
    const { default: CompetitorMonitorPage } = await import("@/app/competitor-monitor/page");
    render(<CompetitorMonitorPage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("It does not watch pages for you");
    expect(text).toContain("no scheduled checking, no alerts and no saved history");
    expect(text).toContain("It reads one public page at a time");
    expect(text).toContain("behind a login");
    expect(text).toContain("build their content in the browser");
    expect(text).toContain("does not compare screenshots");
  });

  it("claims nothing it cannot do and judges nothing", async () => {
    const { default: CompetitorMonitorPage } = await import("@/app/competitor-monitor/page");
    render(<CompetitorMonitorPage />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const word of [
      "ai-powered", "we monitor", "we alert", "real-time", "threat", "risk", "opportunit",
      "strategic", "winning", "losing", "aggressive", "major competitor move", "important change",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("keeps a sensible heading order", async () => {
    const { default: CompetitorMonitorPage } = await import("@/app/competitor-monitor/page");
    render(<CompetitorMonitorPage />);
    const levels = screen.getAllByRole("heading").map((node) => Number(node.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `jump at heading ${i}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("the price monitor page", () => {
  it("has a card with the agreed words and an Open Price Monitor button", () => {
    render(<HomePage />);
    const cards = screen.getAllByRole("article").filter((element) =>
      element.textContent?.includes("Price Monitor"),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain(
      "Track changes on public pricing and product pages and see exactly what changed.",
    );
    const button = within(cards[0]).getByRole("link", { name: "Open Price Monitor" });
    expect(button.getAttribute("href")).toBe("/price-monitor");
  });

  it("is in the header exactly once, alongside Competitor Monitor", () => {
    const { container } = render(<SiteHeader />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.filter((href) => href === "/price-monitor")).toHaveLength(1);
    expect(hrefs.filter((href) => href === "/competitor-monitor")).toHaveLength(1);
  });

  it("has exactly one H1, saying what the tool does", async () => {
    const { default: PriceMonitorPage } = await import("@/app/price-monitor/page");
    render(<PriceMonitorPage />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("See what changed on a pricing or product page");
  });

  it("states the V1 limits and what counts as a price", async () => {
    const { default: PriceMonitorPage } = await import("@/app/price-monitor/page");
    render(<PriceMonitorPage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("It does not watch prices for you");
    expect(text).toContain("no scheduled checking, no price alerts");
    expect(text).toContain("behind a login");
    expect(text).toContain("build their content in the browser");
    expect(text).toContain("“10 users”, “a 14-day trial” and “99% uptime” are not prices");
  });

  it("claims nothing it cannot do and judges no price", async () => {
    const { default: PriceMonitorPage } = await import("@/app/price-monitor/page");
    render(<PriceMonitorPage />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const phrase of [
      "we monitor", "we alert", "real-time", "cheapest", "best price", "great offer", "better deal",
      "worse deal", "good price", "undercut", "forecast", "amazon", "affiliate", "ai-powered",
    ]) {
      expect(text, phrase).not.toContain(phrase);
    }
  });

  it("keeps a sensible heading order", async () => {
    const { default: PriceMonitorPage } = await import("@/app/price-monitor/page");
    render(<PriceMonitorPage />);
    const levels = screen.getAllByRole("heading").map((node) => Number(node.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `jump at heading ${i}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("the docx compare card", () => {
  it("has the agreed words and an Open DOCX Compare button", () => {
    render(<HomePage />);
    const cards = screen.getAllByRole("article").filter((element) =>
      element.textContent?.includes("DOCX Compare"),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain(
      "Compare two Word documents and find changes in text, numbers, dates, lists, and tables.",
    );
    const button = within(cards[0]).getByRole("link", { name: "Open DOCX Compare" });
    expect(button.getAttribute("href")).toBe("/docx-compare");
  });

  it("is in the header exactly once", () => {
    const { container } = render(<SiteHeader />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.filter((href) => href === "/docx-compare")).toHaveLength(1);
  });
});

describe("the excel compare card", () => {
  it("has the agreed words and an Open Excel Compare button", () => {
    render(<HomePage />);
    const cards = screen.getAllByRole("article").filter((element) => element.textContent?.includes("Excel Compare"));
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain(
      "Compare two Excel workbooks side by side and find changed cells, formulas, rows, columns and sheets.",
    );
    const button = within(cards[0]).getByRole("link", { name: "Open Excel Compare" });
    expect(button.getAttribute("href")).toBe("/excel-compare");
  });

  it("is in the header exactly once", () => {
    const { container } = render(<SiteHeader />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.filter((href) => href === "/excel-compare")).toHaveLength(1);
  });
});

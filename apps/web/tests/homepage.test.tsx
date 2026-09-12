/**
 * @vitest-environment jsdom
 *
 * The homepage and the site header, rendered.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HomePage from "@/app/page";
import { TOOLS } from "@/app/layout";

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

  it("uses ordinary crawlable links", () => {
    render(<HomePage />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/pdf-compare");
    expect(hrefs).toContain("/website-compare");
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

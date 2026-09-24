/**
 * Linked scrolling: which paragraphs are paired, and where the other pane goes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ContentView } from "@/lib/content-view";
import { anchorPairs, mapScroll } from "@/lib/linked-scroll";

function view(original: string[], revised: string[], marks: ContentView["marks"] = []): ContentView {
  const nodes = (texts: string[]) => texts.map((text, index) => ({ id: `n${index}`, role: "paragraph", text }));
  return { original: { nodes: nodes(original) }, revised: { nodes: nodes(revised) }, marks } as unknown as ContentView;
}

describe("anchorPairs", () => {
  it("pairs unchanged paragraphs that occur once in each version", () => {
    const pairs = anchorPairs(view(["A", "B", "C"], ["A", "New", "B", "C"]));
    expect(pairs).toEqual([
      { original: "n0", revised: "n0" },
      { original: "n1", revised: "n2" },
      { original: "n2", revised: "n3" },
    ]);
  });

  it("does not pair text that repeats, because it cannot tell which is which", () => {
    const pairs = anchorPairs(view(["Same", "Same", "X"], ["Same", "X"]));
    expect(pairs).toEqual([{ original: "n2", revised: "n1" }]);
  });

  it("pairs a reworded paragraph through the change that cites it on both sides", () => {
    const marks = [
      { change: "c0", side: "original", node: "n1", start: 0, end: 3 },
      { change: "c0", side: "revised", node: "n1", start: 0, end: 3 },
    ] as ContentView["marks"];
    const pairs = anchorPairs(view(["A", "Old words", "C"], ["A", "New words", "C"], marks));
    expect(pairs).toContainEqual({ original: "n1", revised: "n1" });
  });

  it("keeps reading order in both versions, so a moved paragraph never drags a pane backwards", () => {
    const pairs = anchorPairs(view(["A", "B", "C", "D"], ["A", "D", "B", "C"]));
    const orderOf = (side: "original" | "revised") => pairs.map((pair) => Number(pair[side].slice(1)));
    for (const side of ["original", "revised"] as const) {
      const order = orderOf(side);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
    expect(pairs).toHaveLength(3);
  });

  it("finds anchors throughout the example agreement", () => {
    const result = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "docx-example.json"), "utf8"));
    const pairs = anchorPairs(result.view);
    expect(pairs.length).toBeGreaterThan(25);
  });
});

describe("mapScroll", () => {
  it("interpolates between anchors", () => {
    expect(mapScroll(150, [100, 200], [300, 500])).toBe(400);
  });

  it("keeps the same distance before the first anchor and after the last", () => {
    expect(mapScroll(40, [100, 200], [300, 500])).toBe(240);
    expect(mapScroll(260, [100, 200], [300, 500])).toBe(560);
  });

  it("moves in step when there are no anchors", () => {
    expect(mapScroll(123, [], [])).toBe(123);
  });
});

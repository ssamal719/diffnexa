/**
 * The read-only document view: showing what the evidence cites, exactly, in
 * the text the comparison read — never rewriting or reordering it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { blocksOf, citedText, marksFor, readView, segmentsOf, type ViewNode } from "@/lib/content-view";

const WEB = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "workspace-web.json"), "utf8"));

describe("reading the view", () => {
  it("accepts the engine's view and ignores anything else", () => {
    expect(readView(WEB.view)).not.toBeNull();
    expect(readView(undefined)).toBeNull();
    expect(readView({ original: {}, revised: { nodes: [] }, marks: [] })).toBeNull();
    expect(readView("view")).toBeNull();
  });
});

describe("marks", () => {
  it("split a block's text without losing or changing a character", () => {
    const text = "The standard plan costs 50,000 per year.";
    const segments = segmentsOf(text, [{ change: "c1", start: 24, end: 30 }]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.find((segment) => segment.changes.includes("c1"))?.text).toBe("50,000");
  });

  it("keep overlapping evidence from two changes apart", () => {
    const segments = segmentsOf("abcdef", [
      { change: "a", start: 0, end: 4 },
      { change: "b", start: 2, end: 6 },
    ]);
    expect(segments).toEqual([
      { text: "ab", changes: ["a"] },
      { text: "cd", changes: ["a", "b"] },
      { text: "ef", changes: ["b"] },
    ]);
  });

  it("point at the exact words each change in a real result cites", () => {
    const view = readView(WEB.view)!;
    for (const change of WEB.changes) {
      for (const evidence of change.evidence) {
        const side = evidence.side === "old" ? "original" : "revised";
        const marks = marksFor(view, side);
        if (evidence.field) {
          expect(marks.fields.get(evidence.field)).toContain(change.id);
          continue;
        }
        const cited = (marks.nodes.get(evidence.nodeId) ?? []).filter((mark) => mark.change === change.id);
        expect(cited.length, `${change.id} ${evidence.nodeId}`).toBeGreaterThan(0);
        const node = view[side].nodes.find((item) => item.id === evidence.nodeId)!;
        const marked = cited.map((mark) => node.text.slice(mark.start, mark.end)).join(" ");
        // The engine's excerpt is the cited words, normalised; every one of them is in what is marked.
        for (const word of (evidence.excerpt ?? "").split(/\s+/).filter(Boolean)) {
          expect(marked.replace(/\s+/g, " ")).toContain(word);
        }
      }
    }
  });

  it("name a changed block by what it says", () => {
    const view = readView(WEB.view)!;
    const heading = WEB.changes.find((change: { subtype: string }) => change.subtype === "heading");
    expect(citedText(view, heading.evidence)).toBe("Termination");
    expect(citedText(null, heading.evidence)).toBeNull();
  });
});

describe("tables", () => {
  it("lay consecutive cells out as rows, keeping everything else in reading order", () => {
    const cell = (id: string, table: number, row: number, column: number): ViewNode => ({
      id,
      role: "table_cell",
      text: id,
      table: [table, row, column],
    });
    const blocks = blocksOf([
      { id: "p1", role: "paragraph", text: "Before" },
      cell("a", 0, 0, 0),
      cell("b", 0, 0, 1),
      cell("c", 0, 1, 0),
      cell("d", 0, 1, 1),
      { id: "p2", role: "paragraph", text: "Between" },
      cell("e", 1, 0, 0),
    ]);
    expect(blocks.map((block) => block.type)).toEqual(["node", "table", "node", "table"]);
    const first = blocks[1] as Extract<(typeof blocks)[number], { type: "table" }>;
    expect(first.rows.map((row) => row.map((node) => node.id))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

/**
 * Turning a DOCX comparison into what the page shows.
 *
 * The fixture is real engine output: two Word documents built with python-docx
 * and compared by the engine (see tests/fixtures/docx-comparison.json). These
 * check that nothing is lost, invented or judged on the way to the screen.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GROUP_BLURBS,
  NO_CHANGES_HEADLINE,
  NO_CHANGES_SENTENCE,
  filterChanges,
  groupChanges,
  headline,
  headlineFor,
  locationOf,
  readingNotes,
  showsValuesInline,
  type DocxChange,
  type DocxComparison,
} from "@/lib/docx-report";
import { checkDocxBytes } from "@/lib/validation";

const RESULT: DocxComparison = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "docx-comparison.json"), "utf8"),
);

function find(predicate: (change: DocxChange) => boolean): DocxChange {
  const found = RESULT.changes.find(predicate);
  if (!found) throw new Error("fixture is missing an expected change");
  return found;
}

describe("the headline", () => {
  it("counts the changes found, in plain words", () => {
    expect(headline(0)).toBe(NO_CHANGES_HEADLINE);
    expect(NO_CHANGES_HEADLINE).toBe("No changes found");
    expect(NO_CHANGES_SENTENCE).toBe("This document says the same as the original.");
    expect(headline(1)).toBe("1 change found");
    expect(headline(7)).toBe("7 changes found");
    expect(headline(RESULT.changes.length)).toBe("11 changes found");
  });
});

describe("groups", () => {
  it("show every change exactly once", () => {
    const shown = groupChanges(RESULT).flatMap((group) => group.changes.map((change) => change.id));
    expect(shown.sort()).toEqual(RESULT.changes.map((change) => change.id).sort());
  });

  it("follow the engine's order and leave out empty groups", () => {
    expect(groupChanges(RESULT).map((group) => group.label)).toEqual([
      "Text changes",
      "Headings",
      "Lists",
      "Tables",
      "Numbers",
      "Dates",
      "Structure",
      "Other",
    ]);
    const onlyTables = groupChanges(RESULT, RESULT.changes.filter((change) => change.group === "tables"));
    expect(onlyTables.map((group) => group.id)).toEqual(["tables"]);
  });

  it("keep reading order inside a group", () => {
    for (const group of groupChanges(RESULT)) {
      const seqs = group.changes.map((change) => change.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    }
  });

  it("are described without judging anything", () => {
    const words = [...Object.values(GROUP_BLURBS), ...RESULT.changes.map(headlineFor)].join(" ").toLowerCase();
    for (const judgement of [
      "important", "minor", "major", "critical", "better", "worse", "risky", "favorable", "unfavorable",
    ]) {
      expect(words).not.toContain(judgement);
    }
  });
});

describe("each change", () => {
  it("gets a plain-language headline", () => {
    expect(headlineFor(find((c) => c.category === "metadata"))).toBe("Document title changed");
    expect(headlineFor(find((c) => c.subtype === "heading"))).toBe("Words added to a heading");
    expect(headlineFor(find((c) => c.category === "number" && c.subtype === null))).toBe("Number changed");
    expect(headlineFor(find((c) => c.category === "date"))).toBe("Date changed");
    expect(headlineFor(find((c) => c.group === "text" && c.kind === "modified"))).toBe("Text changed");
    expect(headlineFor(find((c) => c.group === "text" && c.kind === "added"))).toBe("Text added");
    expect(headlineFor(find((c) => c.subtype === "list_item"))).toBe("List item added");
    expect(headlineFor(find((c) => c.subtype === "heading_level"))).toBe("Heading level changed");
    expect(headlineFor(find((c) => c.subtype === "table_cell"))).toBe("Number in a table changed");
    expect(headlineFor(find((c) => c.subtype === "row"))).toBe("Table row added");
    expect(headlineFor(find((c) => c.category === "link"))).toBe("Link now points elsewhere");
  });

  it("says where it is, from the evidence the engine cited", () => {
    expect(locationOf(find((c) => c.subtype === "table_cell"))).toBe("Revised: Table 1, row 2, column 2");
    expect(locationOf(find((c) => c.subtype === "heading_level"))).toBe("Revised: Heading 3, paragraph 10");
    expect(locationOf(find((c) => c.category === "metadata"))).toBe("Document properties");
  });

  it("shows values side by side where comparing them is the point", () => {
    expect(showsValuesInline(find((c) => c.category === "date"))).toBe(true);
    expect(showsValuesInline(find((c) => c.subtype === "table_cell"))).toBe(true);
    expect(showsValuesInline(find((c) => c.group === "text" && c.kind === "added"))).toBe(false);
  });

  it("has evidence with a location on every piece", () => {
    for (const change of RESULT.changes) {
      expect(change.evidence.length).toBeGreaterThan(0);
      for (const item of change.evidence) expect(item.location.length).toBeGreaterThan(0);
    }
  });
});

describe("search and filters", () => {
  it("search what a reader can see, including locations", () => {
    expect(filterChanges(RESULT, { query: "row 2, column 2", group: null }).map((c) => c.subtype)).toEqual([
      "table_cell",
    ]);
    expect(filterChanges(RESULT, { query: "mediation", group: null })).toHaveLength(1);
    expect(filterChanges(RESULT, { query: "", group: "tables" })).toHaveLength(2);
    expect(filterChanges(RESULT, { query: "mediation", group: "tables" })).toHaveLength(0);
  });
});

describe("notes about what was not compared", () => {
  it("name the document they are about", () => {
    const notes = readingNotes({
      ...RESULT,
      diagnostics: {
        ...RESULT.diagnostics,
        previousWarnings: ["Contains 1 image or other embedded object. Their content is not compared."],
        revisedWarnings: [],
      },
    });
    expect(notes).toEqual([
      {
        title: "About the original document",
        text: "Contains 1 image or other embedded object. Their content is not compared.",
      },
    ]);
  });
});

describe("the first check in the browser", () => {
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

  it("accepts a ZIP container and refuses the rest with the shared codes", () => {
    expect(checkDocxBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toEqual({ ok: true });
    expect(checkDocxBytes(new Uint8Array(0))).toEqual({ ok: false, code: "docx_empty_file" });
    expect(checkDocxBytes(new TextEncoder().encode("%PDF-1.7"))).toEqual({ ok: false, code: "docx_not_docx" });
    expect(checkDocxBytes(new Uint8Array([...ole, 0, 0]))).toEqual({ ok: false, code: "docx_legacy_doc" });
  });

  it("tells a password-protected document from an old .doc, as the engine does", () => {
    const name = Array.from("EncryptedPackage").flatMap((char) => [char.charCodeAt(0), 0]);
    expect(checkDocxBytes(new Uint8Array([...ole, 0, 0, ...name]))).toEqual({
      ok: false,
      code: "docx_encrypted",
    });
  });
});

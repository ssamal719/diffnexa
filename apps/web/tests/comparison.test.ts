import { describe, expect, it } from "vitest";

import {
  changeLocation,
  describePages,
  describeType,
  excerptFor,
  groupChanges,
  groupOf,
  summarize,
  type Change,
} from "@/lib/comparison";

function change(overrides: Partial<Change> = {}): Change {
  return {
    id: "c0",
    seq: 0,
    type: "NUMBER_CHANGED",
    kind: "modified",
    category: "number",
    label: "Total Vacancies",
    oldValue: "627",
    newValue: "654",
    delta: "+27 (+4.31%)",
    confidence: 1,
    isNoise: false,
    noiseReason: null,
    oldPages: [2],
    newPages: [2],
    evidence: [
      { side: "old", page: 2, excerpt: "Total Vacancies: 627", bbox: null, wordCount: 3 },
      { side: "new", page: 2, excerpt: "Total Vacancies: 654", bbox: null, wordCount: 3 },
    ],
    ...overrides,
  };
}

describe("summary wording", () => {
  it("reads naturally for every count", () => {
    expect(summarize(0)).toBe("No changes found");
    expect(summarize(1)).toBe("1 change found");
    expect(summarize(12)).toBe("12 changes found");
  });
});

describe("page wording", () => {
  it("lists pages the way a person would say them", () => {
    expect(describePages([])).toBeNull();
    expect(describePages([3])).toBe("page 3");
    expect(describePages([2, 4])).toBe("pages 2 and 4");
    expect(describePages([1, 2, 5])).toBe("pages 1, 2 and 5");
  });

  it("shows a move across pages as a journey", () => {
    expect(changeLocation(change({ oldPages: [1], newPages: [3] }))).toBe("page 1 → page 3");
    expect(changeLocation(change())).toBe("page 2");
    expect(changeLocation(change({ oldPages: [], newPages: [4] }))).toBe("page 4");
    expect(changeLocation(change({ oldPages: [], newPages: [] }))).toBeNull();
  });
});

describe("change type names", () => {
  it("are plain language, never code", () => {
    expect(describeType("NUMBER_CHANGED")).toBe("Number changed");
    expect(describeType("PAGE_ADDED")).toBe("Page added");
    expect(describeType("TEXT_MOVED")).toBe("Text moved");
    for (const type of ["DATE_CHANGED", "TEXT_MODIFIED", "METADATA_CHANGED"] as const) {
      expect(describeType(type)).not.toMatch(/_/);
    }
  });
});

describe("grouping", () => {
  it("sorts each type into the right group", () => {
    expect(groupOf(change({ type: "NUMBER_CHANGED" }))).toBe("numbers");
    expect(groupOf(change({ type: "DATE_CHANGED" }))).toBe("dates");
    expect(groupOf(change({ type: "TEXT_ADDED" }))).toBe("text");
    expect(groupOf(change({ type: "PAGE_REMOVED" }))).toBe("pages");
    expect(groupOf(change({ type: "METADATA_CHANGED" }))).toBe("other");
  });

  it("keeps group order and drops empty groups", () => {
    const groups = groupChanges([
      change({ id: "a", type: "TEXT_ADDED" }),
      change({ id: "b", type: "NUMBER_CHANGED" }),
      change({ id: "c", type: "DATE_CHANGED" }),
    ]);
    expect(groups.map((group) => group.id)).toEqual(["numbers", "dates", "text"]);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
  });

  it("returns nothing for no changes", () => {
    expect(groupChanges([])).toEqual([]);
  });
});

describe("evidence", () => {
  it("finds the excerpt for each side", () => {
    expect(excerptFor(change(), "old")).toBe("Total Vacancies: 627");
    expect(excerptFor(change(), "new")).toBe("Total Vacancies: 654");
  });

  it("returns nothing when a side has no excerpt", () => {
    const added = change({
      kind: "added",
      oldValue: null,
      evidence: [{ side: "new", page: 2, excerpt: "New sentence.", bbox: null, wordCount: 2 }],
    });
    expect(excerptFor(added, "old")).toBeNull();
    expect(excerptFor(added, "new")).toBe("New sentence.");
  });
});

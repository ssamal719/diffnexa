/**
 * Comparison Workspace V2 — the shared state logic.
 *
 * Tool-independent: any tool's changes, described in the shared shape, are
 * searched, grouped for the navigator and stepped through the same way.
 */

import { describe, expect, it } from "vitest";

import {
  counterText,
  filterChanges,
  filterGroup,
  hasFilters,
  kindFilter,
  navigatorGroups,
  searchChanges,
  shorten,
  stepChange,
  toggleFilter,
  type WorkspaceChange,
} from "@/lib/workspace";

function change(number: number, group: string, place: string, text = ""): WorkspaceChange {
  return {
    id: `c${number - 1}`,
    number,
    group,
    groupLabel: `Sheet: ${group}`,
    title: "Value changed",
    place,
    category: "Number",
    kind: "changed",
    before: "1",
    after: "2",
    description: `Change ${number}`,
    searchText: `${group} ${place} ${text}`,
  };
}

const CHANGES = [
  change(1, "Summary", "B3", "Total monthly revenue formula"),
  change(2, "Pricing", "B3", "$299.00 $349.00"),
  change(3, "Pricing", "F5", "15 Oct 2026 1 Nov 2026"),
  change(4, "Employees", "A2", "John Carter Jonathan Carter"),
];

describe("search", () => {
  it("finds changes by any visible word, all words required", () => {
    expect(searchChanges(CHANGES, "pricing").map((c) => c.number)).toEqual([2, 3]);
    expect(searchChanges(CHANGES, "pricing 349").map((c) => c.number)).toEqual([2]);
    expect(searchChanges(CHANGES, "JONATHAN").map((c) => c.number)).toEqual([4]);
    expect(searchChanges(CHANGES, "#3").map((c) => c.number)).toEqual([3]);
    expect(searchChanges(CHANGES, "  ")).toEqual(CHANGES);
    expect(searchChanges(CHANGES, "nothing like this")).toEqual([]);
  });
});

describe("the navigator", () => {
  it("groups by sheet in the order changes are read, keeping each group in order", () => {
    const groups = navigatorGroups(CHANGES);
    expect(groups.map((g) => g.label)).toEqual(["Sheet: Summary", "Sheet: Pricing", "Sheet: Employees"]);
    expect(groups[1].changes.map((c) => c.place)).toEqual(["B3", "F5"]);
  });
});

describe("previous and next", () => {
  it("steps through the visible changes and stops at the ends", () => {
    expect(stepChange(CHANGES, "c0", 1)).toBe("c1");
    expect(stepChange(CHANGES, "c1", -1)).toBe("c0");
    expect(stepChange(CHANGES, "c3", 1)).toBe("c3");
    expect(stepChange(CHANGES, "c0", -1)).toBe("c0");
  });

  it("jumps into a search when the active change is not in it", () => {
    const pricing = searchChanges(CHANGES, "pricing");
    expect(stepChange(pricing, "c3", 1)).toBe("c1");
    expect(stepChange(pricing, "c3", -1)).toBe("c2");
    expect(stepChange([], "c0", 1)).toBeNull();
  });

  it("says where the reader is", () => {
    expect(counterText(CHANGES, 4, "c2")).toBe("Change 3 of 4");
    expect(counterText(searchChanges(CHANGES, "pricing"), 4, "c2")).toBe("Change 2 of 2 shown · 4 in total");
    expect(counterText(searchChanges(CHANGES, "pricing"), 4, "c3")).toBe("Change – of 2 shown · 4 in total");
    expect(counterText([], 0, null)).toBe("No changes");
  });
});

describe("filters", () => {
  const tagged: WorkspaceChange[] = [
    { ...change(1, "A", "B3"), kind: "changed", tags: { category: ["values"], page: ["1"] } },
    { ...change(2, "A", "B4"), kind: "added", tags: { category: ["content"], page: ["1"] } },
    { ...change(3, "B", "C1"), kind: "removed", tags: { category: ["values"], page: ["2"] } },
    { ...change(4, "B", "C2"), kind: "changed", tags: { category: ["content"], page: ["2"] }, minor: true },
  ];

  it("offers only options some change has, with their counts, and never counts minor differences", () => {
    const group = filterGroup("category", "What changed", tagged, [
      { id: "values", label: "Values" },
      { id: "tables", label: "Tables" },
      { id: "content", label: "Content" },
    ]);
    expect(group.options).toEqual([
      { id: "values", label: "Values", count: 2 },
      { id: "content", label: "Content", count: 1 },
    ]);
    expect(kindFilter(tagged).options.map((option) => option.id)).toEqual(["added", "removed", "changed"]);
  });

  it("matches any choice within a group and every group chosen", () => {
    const numbers = (list: WorkspaceChange[]) => list.map((item) => item.number);
    expect(numbers(filterChanges(tagged, {}, false))).toEqual([1, 2, 3]);
    expect(numbers(filterChanges(tagged, { category: ["values", "content"] }, false))).toEqual([1, 2, 3]);
    expect(numbers(filterChanges(tagged, { category: ["values"], page: ["2"] }, false))).toEqual([3]);
    expect(numbers(filterChanges(tagged, { kind: ["changed"] }, false))).toEqual([1]);
    expect(numbers(filterChanges(tagged, { kind: ["changed"] }, true))).toEqual([1, 4]);
  });

  it("turns a choice off when it is chosen again, and knows when nothing is chosen", () => {
    const once = toggleFilter({}, "page", "2");
    expect(once).toEqual({ page: ["2"] });
    expect(hasFilters(once)).toBe(true);
    expect(hasFilters(toggleFilter(once, "page", "2"))).toBe(false);
  });

  it("shortens a passage for the navigator without changing its words", () => {
    expect(shorten("  one   two three ")).toBe("one two three");
    const long = "word ".repeat(40).trim();
    const short = shorten(long, 30)!;
    expect(short.endsWith("…")).toBe(true);
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
    expect(shorten(null)).toBeNull();
  });
});

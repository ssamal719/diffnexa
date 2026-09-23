/**
 * Comparison Workspace V2 — the shared state logic.
 *
 * Tool-independent: any tool's changes, described in the shared shape, are
 * searched, grouped for the navigator and stepped through the same way.
 */

import { describe, expect, it } from "vitest";

import { counterText, navigatorGroups, searchChanges, stepChange, type WorkspaceChange } from "@/lib/workspace";

function change(number: number, group: string, place: string, text = ""): WorkspaceChange {
  return {
    id: `c${number - 1}`,
    number,
    group,
    groupLabel: `Sheet: ${group}`,
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

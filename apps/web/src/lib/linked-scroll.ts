/**
 * Keeping the two versions of a document in step while the reader scrolls.
 *
 * "Linked" scrolling needs to know which paragraph in one version corresponds
 * to which in the other. That is worked out from the comparison's own data,
 * never guessed from position:
 *
 * * a block cited by a change in both versions is paired with its counterpart
 *   (a reworded paragraph, a changed cell);
 * * a block whose text appears exactly once in each version, unchanged, is
 *   paired with itself;
 * * of those candidate pairs, the longest run that keeps both documents in
 *   reading order is kept, so a moved paragraph can never drag the other pane
 *   backwards.
 *
 * Scrolling one pane then moves the other so the same pair sits at the same
 * height, interpolating between neighbouring pairs. Where the documents differ
 * — an added page, a removed section — the other pane moves proportionally
 * across the difference. It is paragraph-level alignment, not pixel-perfect.
 */

import type { ContentView } from "@/lib/content-view";

export type Anchor = { original: string; revised: string };

function key(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Pairs of node ids, one per version, in reading order in both. */
export function anchorPairs(view: ContentView): Anchor[] {
  const original = view.original.nodes.filter((node) => node.role !== "link");
  const revised = view.revised.nodes.filter((node) => node.role !== "link");
  const originalIndex = new Map(original.map((node, index) => [node.id, index]));
  const revisedIndex = new Map(revised.map((node, index) => [node.id, index]));

  const candidates = new Map<number, number>();

  // Blocks a change cites in both versions: its first cited block on each side.
  const cited = new Map<string, { original?: number; revised?: number }>();
  for (const mark of view.marks) {
    if (!("node" in mark)) continue;
    const entry = cited.get(mark.change) ?? {};
    const index = mark.side === "original" ? originalIndex.get(mark.node) : revisedIndex.get(mark.node);
    if (index === undefined) continue;
    if (mark.side === "original") entry.original = Math.min(entry.original ?? index, index);
    else entry.revised = Math.min(entry.revised ?? index, index);
    cited.set(mark.change, entry);
  }
  for (const entry of cited.values()) {
    if (entry.original !== undefined && entry.revised !== undefined && !candidates.has(entry.original)) {
      candidates.set(entry.original, entry.revised);
    }
  }

  // Unchanged blocks whose text occurs exactly once in each version.
  const count = (nodes: typeof original) => {
    const counts = new Map<string, number[]>();
    nodes.forEach((node, index) => {
      const text = key(node.text);
      if (text) counts.set(text, [...(counts.get(text) ?? []), index]);
    });
    return counts;
  };
  const inOriginal = count(original);
  const inRevised = count(revised);
  for (const [text, indexes] of inOriginal) {
    const other = inRevised.get(text);
    if (indexes.length === 1 && other?.length === 1 && !candidates.has(indexes[0])) {
      candidates.set(indexes[0], other[0]);
    }
  }

  // The longest chain increasing in both documents (patience sorting).
  const pairs = [...candidates.entries()].sort((a, b) => a[0] - b[0]);
  const tails: number[] = [];
  const previous: number[] = new Array(pairs.length).fill(-1);
  const tailIndex: number[] = [];
  pairs.forEach(([, revisedAt], index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (pairs[tailIndex[middle]][1] < revisedAt) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tailIndex[low - 1];
    tails[low] = revisedAt;
    tailIndex[low] = index;
  });
  const chain: Anchor[] = [];
  let at = tailIndex.length > 0 ? tailIndex[tailIndex.length - 1] : -1;
  while (at >= 0) {
    chain.push({ original: original[pairs[at][0]].id, revised: revised[pairs[at][1]].id });
    at = previous[at];
  }
  return chain.reverse();
}

/**
 * Where the other pane should be, given one pane's scroll position.
 *
 * `from` and `to` are the anchors' top offsets (in each pane's scroll
 * coordinates), in the same order. Between two anchors the position is
 * interpolated; before the first and after the last it keeps the same distance.
 */
export function mapScroll(position: number, from: number[], to: number[]): number {
  if (from.length === 0) return position;
  if (position <= from[0]) return to[0] - (from[0] - position);
  for (let index = 0; index < from.length - 1; index += 1) {
    if (position < from[index + 1]) {
      const span = from[index + 1] - from[index];
      const fraction = span > 0 ? (position - from[index]) / span : 0;
      return to[index] + fraction * (to[index + 1] - to[index]);
    }
  }
  const last = from.length - 1;
  return to[last] + (position - from[last]);
}

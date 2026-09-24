/**
 * The read-only view of both documents that Word and webpage results carry.
 *
 * The engine lists each document's content in reading order, exactly as it
 * compared it, and turns every piece of cited evidence into a character span
 * ("mark") within that content. This file only shapes that for display:
 * splitting a block's text around its marks and laying table cells out as
 * rows. It adds, removes and rewrites nothing — what is highlighted is exactly
 * what the evidence cites.
 */

export type ViewNode = {
  id: string;
  role: string;
  text: string;
  level?: number;
  section?: string[];
  /** Zero-based table, row and column, for a table cell. */
  table?: [number, number, number];
  href?: string;
  /** Word list items: "bullet" or "number", and how deep. */
  list?: string;
  listLevel?: number;
  /** Word documents: where this is, in words a reader can find in Word. */
  place?: string;
  /** Word documents whose file records its pages: the page this node begins on. */
  page?: number;
  /** Character offsets in `text` where a new page begins, for a node that runs across pages. */
  pageBreaks?: number[];
};

export type ViewSide = { nodes: ViewNode[]; fields: Record<string, string> };

export type ViewMark =
  | { change: string; side: "original" | "revised"; node: string; start: number; end: number }
  | { change: string; side: "original" | "revised"; field: string };

export type ContentView = { original: ViewSide; revised: ViewSide; marks: ViewMark[] };

export type Side = "original" | "revised";

/** A view the workspace can draw; anything else (an older engine, a hand-made response) is ignored. */
export function readView(value: unknown): ContentView | null {
  const view = value as Partial<ContentView> | null | undefined;
  if (!view || typeof view !== "object") return null;
  if (!Array.isArray(view.original?.nodes) || !Array.isArray(view.revised?.nodes) || !Array.isArray(view.marks)) {
    return null;
  }
  return view as ContentView;
}

export type Segment = { text: string; changes: string[] };

/**
 * A block's text cut at every mark boundary, each piece listing the changes
 * that cite it. Joining the pieces gives the original text back exactly.
 */
export function segmentsOf(text: string, marks: { change: string; start: number; end: number }[]): Segment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const mark of marks) {
    cuts.add(Math.max(0, Math.min(text.length, mark.start)));
    cuts.add(Math.max(0, Math.min(text.length, mark.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;
    const changes = marks.filter((mark) => mark.start <= start && mark.end >= end).map((mark) => mark.change);
    segments.push({ text: text.slice(start, end), changes: [...new Set(changes)] });
  }
  return segments;
}

export type NodeMarks = Map<string, { change: string; start: number; end: number }[]>;

/** One side's marks, by block and by document field. */
export function marksFor(view: ContentView, side: Side): { nodes: NodeMarks; fields: Map<string, string[]> } {
  const nodes: NodeMarks = new Map();
  const fields = new Map<string, string[]>();
  for (const mark of view.marks) {
    if (mark.side !== side) continue;
    if ("field" in mark) {
      fields.set(mark.field, [...(fields.get(mark.field) ?? []), mark.change]);
    } else {
      nodes.set(mark.node, [...(nodes.get(mark.node) ?? []), { change: mark.change, start: mark.start, end: mark.end }]);
    }
  }
  return { nodes, fields };
}

export type Block =
  | { type: "node"; node: ViewNode }
  | { type: "table"; key: string; rows: ViewNode[][] };

/**
 * The blocks to draw, in reading order. Consecutive cells of one table become
 * one table of rows, so a changed cell is seen in its row, beside its
 * neighbours. Nothing is reordered across tables or paragraphs.
 */
export function blocksOf(nodes: ViewNode[]): Block[] {
  const blocks: Block[] = [];
  for (const node of nodes) {
    if (node.table) {
      const last = blocks[blocks.length - 1];
      const tableKey = `t${node.table[0]}`;
      if (last && last.type === "table" && last.key.startsWith(`${tableKey}-`)) {
        const row = last.rows.find((cells) => cells[0]?.table?.[1] === node.table![1]);
        if (row) row.push(node);
        else last.rows.push([node]);
        continue;
      }
      blocks.push({ type: "table", key: `${tableKey}-${node.id}`, rows: [[node]] });
      continue;
    }
    blocks.push({ type: "node", node });
  }
  return blocks;
}

/** A document field's name, in words: "Page title", "Document title". */
export const FIELD_LABELS: Record<string, string> = {
  "metadata.title": "Page title",
  "metadata.description": "Page description",
  "metadata.canonical": "Canonical link",
  "properties.title": "Document title",
  "properties.subject": "Document subject",
};

/** The node text around a mark, for the evidence panel: the whole block the evidence sits in. */
export function nodeById(view: ContentView, side: Side, id: string): ViewNode | null {
  return view[side].nodes.find((node) => node.id === id) ?? null;
}

/**
 * The words of the block a change's evidence cites — in the revised version
 * when it is there — so a changed heading can be named by what it says.
 */
export function citedText(
  view: ContentView | null,
  evidence: { side: "old" | "new"; nodeId: string | null }[],
): string | null {
  if (!view) return null;
  for (const wanted of ["new", "old"] as const) {
    const item = evidence.find((entry) => entry.side === wanted && entry.nodeId);
    if (!item) continue;
    const node = nodeById(view, wanted === "new" ? "revised" : "original", item.nodeId!);
    if (node?.text) return node.text;
  }
  return null;
}

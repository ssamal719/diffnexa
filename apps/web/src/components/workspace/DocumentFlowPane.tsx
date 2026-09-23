"use client";

import { memo, useEffect, useMemo, useRef } from "react";

import {
  FIELD_LABELS,
  blocksOf,
  marksFor,
  segmentsOf,
  type ContentView,
  type Side,
  type ViewNode,
} from "@/lib/content-view";
import { scrollWithin } from "@/lib/scroll";
import type { EditKind } from "@/lib/workspace";

/**
 * One version of a Word document or webpage, as the comparison read it, with
 * every change's evidence highlighted in place.
 *
 * The text is exactly what the engine extracted and compared — headings,
 * paragraphs, list items and table cells in reading order — not a rendering of
 * the original file, and the pane says so. The words a change cites are
 * marked: struck through in the original, underlined in the revised, so the
 * difference never rests on colour alone. The active change's words are
 * outlined and numbered, and the pane scrolls to them whenever a change is
 * chosen.
 */
export function DocumentFlowPane({
  side,
  view,
  label,
  activeId,
  activeKind,
  activeNumber,
  activation,
  reveal,
}: {
  side: Side;
  view: ContentView;
  /** "Original document", "Baseline capture". */
  label: string;
  activeId: string | null;
  activeKind: EditKind | null;
  activeNumber: number | null;
  activation: number;
  reveal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const marks = useMemo(() => marksFor(view, side), [view, side]);
  const blocks = useMemo(() => blocksOf(view[side].nodes), [view, side]);
  const fields = Object.entries(view[side].fields);
  // The change's number is shown once, at the first place it is marked.
  const fieldLabelled = activeId !== null && [...marks.fields.values()].some((list) => list.includes(activeId));
  const firstNode = fieldLabelled
    ? null
    : (view[side].nodes.find((node) => cites(marks.nodes.get(node.id), activeId))?.id ?? null);
  const numberFor = (id: string) => (id === firstNode ? activeNumber : null);
  const hasActive =
    activeId !== null &&
    ([...marks.nodes.values()].some((list) => list.some((mark) => mark.change === activeId)) ||
      [...marks.fields.values()].some((list) => list.includes(activeId)));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>('[data-active="true"]');
    if (target) scrollWithin(container, target, "center");
  }, [activeId, activation, reveal]);

  return (
    <div className="px-3 pb-3">
      {activeId && !hasActive && (
        <p className="mb-1.5 rounded-[3px] border border-rule bg-surface px-2 py-1 text-[0.78rem] text-ink-soft">
          {absentNote(side, activeKind)}
        </p>
      )}
      <div
        ref={containerRef}
        role="region"
        aria-label={`${label}, as compared`}
        tabIndex={0}
        className="max-h-[34rem] overflow-y-auto rounded-[3px] border border-rule bg-paper px-3 py-2 text-[0.88rem] leading-relaxed"
      >
        {fields.length > 0 && (
          <dl className="mb-2 border-b border-rule pb-2 text-[0.8rem]">
            {fields.map(([name, value]) => {
              const cited = marks.fields.get(name) ?? [];
              const active = activeId !== null && cited.includes(activeId);
              return (
                <div key={name} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-2">
                  <dt className="text-ink-soft">{FIELD_LABELS[name] ?? name}</dt>
                  <dd className="break-words">
                    {cited.length > 0 ? (
                      <Marked side={side} active={active} number={active ? activeNumber : null}>
                        {value}
                      </Marked>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {blocks.length === 0 && <p className="text-ink-soft">No text was found in this version.</p>}
        {blocks.map((block) =>
          block.type === "table" ? (
            <div key={block.key} className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[0.82rem]">
                <tbody>
                  {block.rows.map((row) => (
                    <tr key={row[0].id}>
                      {row.map((cell) => (
                        <td key={cell.id} className="border border-rule px-1.5 py-0.5 align-top break-words">
                          <NodeText
                            node={cell}
                            side={side}
                            marks={marks.nodes.get(cell.id)}
                            activeId={activeId}
                            activeNumber={numberFor(cell.id)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Block
              key={block.node.id}
              node={block.node}
              side={side}
              marks={marks.nodes.get(block.node.id)}
              activeId={cites(marks.nodes.get(block.node.id), activeId) ? activeId : null}
              activeNumber={numberFor(block.node.id)}
            />
          ),
        )}
      </div>
      <p className="mt-1 text-[0.72rem] text-ink-soft">
        The text DiffNexa read and compared, in reading order — not a picture of the original layout.
      </p>
    </div>
  );
}

function absentNote(side: Side, kind: EditKind | null): string {
  if (side === "original" && kind === "added") return "Not in the original: this was added in the revised version.";
  if (side === "revised" && kind === "removed") return "Not in the revised version: this was removed.";
  return `This change cites nothing in the ${side} version.`;
}

type MarkList = { change: string; start: number; end: number }[] | undefined;

function cites(marks: MarkList, id: string | null): boolean {
  return id !== null && (marks ?? []).some((mark) => mark.change === id);
}

const Block = memo(function Block({
  node,
  side,
  marks,
  activeId,
  activeNumber,
}: {
  node: ViewNode;
  side: Side;
  marks: MarkList;
  activeId: string | null;
  activeNumber: number | null;
}) {
  const text = <NodeText node={node} side={side} marks={marks} activeId={activeId} activeNumber={activeNumber} />;
  if (node.role === "heading") {
    const size = node.level === 1 ? "text-[1.05rem]" : node.level === 2 ? "text-[0.98rem]" : "text-[0.92rem]";
    return <p className={`mt-3 mb-1 font-semibold ${size}`}>{text}</p>;
  }
  if (node.role === "list_item") {
    const depth = Math.max(1, node.listLevel ?? 1);
    return (
      <p className="my-0.5 flex gap-2" style={{ paddingLeft: `${(depth - 1) * 1.1}rem` }}>
        <span aria-hidden="true" className="text-ink-soft">
          {node.list === "number" || node.list === "numbered" ? "–" : "•"}
        </span>
        <span className="min-w-0">{text}</span>
      </p>
    );
  }
  if (node.role === "quote") return <p className="my-1.5 border-l-2 border-rule pl-2 italic">{text}</p>;
  if (node.role === "preformatted") {
    return <p className="my-1.5 font-mono text-[0.8rem] whitespace-pre-wrap">{text}</p>;
  }
  if (node.role === "link") {
    return (
      <p className="my-1">
        {text}
        {node.href && <span className="ml-1 text-[0.75rem] break-all text-ink-soft">({node.href})</span>}
      </p>
    );
  }
  return <p className="my-1.5 break-words">{text}</p>;
});

function NodeText({
  node,
  side,
  marks,
  activeId,
  activeNumber,
}: {
  node: ViewNode;
  side: Side;
  marks: MarkList;
  activeId: string | null;
  activeNumber: number | null;
}) {
  if (!marks || marks.length === 0) return <>{node.text}</>;
  const segments = segmentsOf(node.text, marks);
  const first = activeId === null ? -1 : segments.findIndex((segment) => segment.changes.includes(activeId));
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.changes.length === 0) return <span key={index}>{segment.text}</span>;
        const active = activeId !== null && segment.changes.includes(activeId);
        return (
          <Marked key={index} side={side} active={active} number={index === first ? activeNumber : null}>
            {segment.text}
          </Marked>
        );
      })}
    </>
  );
}

function Marked({
  side,
  active,
  number,
  children,
}: {
  side: Side;
  active: boolean;
  number: number | null;
  children: string;
}) {
  const look =
    side === "original"
      ? active
        ? "bg-[#f8d7d9] line-through decoration-removed decoration-2"
        : "bg-[#fdf0f0] line-through decoration-removed/60"
      : active
        ? "bg-[#cfe8d8] underline decoration-added decoration-2 underline-offset-2"
        : "bg-[#eef7f1] underline decoration-added/60 underline-offset-2";
  return (
    <>
      {number !== null && (
        <span className="mr-0.5 rounded-[2px] bg-signal px-1 align-[1px] text-[0.68rem] font-semibold text-white no-underline">
          #{number}
        </span>
      )}
      <mark
        data-active={active ? "true" : undefined}
        className={[
          "rounded-[2px] px-0.5 text-ink",
          look,
          active ? "outline-2 outline-signal outline-solid" : "",
        ].join(" ")}
      >
        <span className="sr-only">{side === "original" ? "[original: " : "[revised: "}</span>
        {children}
        <span className="sr-only">]</span>
      </mark>
    </>
  );
}

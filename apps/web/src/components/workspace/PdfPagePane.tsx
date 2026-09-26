"use client";

import { useEffect, useRef, useState } from "react";

import { closePdf, openPdf } from "@/lib/pdf-view";
import { scrollWithin } from "@/lib/scroll";
import type { Side } from "@/lib/content-view";

export type PdfBox = {
  changeId: string;
  number: number;
  page: number;
  /** Points, top-left origin, in the page's displayed orientation — as the engine reports it. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type Zoom = "fit" | number;

/** A page and zoom the other version asked this one to follow (Linked). */
export type PaneFollow = { page: number; zoom: Zoom; token: number };

/** Where the other version is scrolled within its page, as fractions of the scrollable distance (Linked). */
export type ScrollFollow = { top: number; left: number; token: number };

type Drawn = { page: number; scale: number; width: number; height: number };

/**
 * One version of a PDF, drawn page by page from the file the person chose.
 *
 * The page comes from their own file, in their own browser; nothing is sent
 * anywhere to draw it. Every change's evidence on the page is outlined at the
 * position the comparison recorded, and the active change is numbered and
 * outlined more strongly. Choosing a change turns this version to the page
 * its evidence is on; a change with no evidence in this version leaves the
 * page where it is and says so, rather than guessing a page.
 */
export function PdfPagePane({
  side,
  file,
  pageCount,
  boxes,
  activeId,
  activePage,
  activeKind,
  activation,
  reveal,
  follow = null,
  onNavigate,
  scrollFollow = null,
  onScrolled,
}: {
  side: Side;
  file: File | null;
  pageCount: number;
  boxes: PdfBox[];
  activeId: string | null;
  /** The page this version's evidence for the active change is on, if any. */
  activePage: number | null;
  activeKind: string | null;
  activation: number;
  reveal: number;
  /** Linked: turn to this page and zoom, when the reader moved the other version. */
  follow?: PaneFollow | null;
  /** The reader turned the page or zoomed this version. */
  onNavigate?: (page: number, zoom: Zoom) => void;
  /** Linked: scroll to the same place within the page as the other version. */
  scrollFollow?: ScrollFollow | null;
  /** The reader scrolled within this version's page. */
  onScrolled?: (top: number, left: number) => void;
}) {
  const [page, setPage] = useState(() => clamp(activePage ?? 1, pageCount));
  const [handled, setHandled] = useState(activation);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [width, setWidth] = useState(0);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const name = side === "original" ? "original" : "revised";

  const [followed, setFollowed] = useState(follow?.token ?? 0);
  const expectedScroll = useRef<{ top: number; left: number } | null>(null);

  // Choosing a change turns this version to the change's page, in the same render.
  if (handled !== activation) {
    setHandled(activation);
    if (activePage !== null) setPage(clamp(activePage, pageCount));
  }

  // Linked: the other version turned the page or zoomed, so this one follows.
  if (follow && follow.token !== followed) {
    setFollowed(follow.token);
    setPage(clamp(follow.page, pageCount));
    setZoom(follow.zoom);
  }

  function navigate(nextPage: number, nextZoom: Zoom) {
    setPage(nextPage);
    setZoom(nextZoom);
    onNavigate?.(nextPage, nextZoom);
  }

  // Linked: move to the same place within the page as the other version.
  useEffect(() => {
    const element = scrollRef.current;
    if (!scrollFollow || !element) return;
    const top = Math.round(scrollFollow.top * Math.max(0, element.scrollHeight - element.clientHeight));
    const left = Math.round(scrollFollow.left * Math.max(0, element.scrollWidth - element.clientWidth));
    expectedScroll.current = { top, left };
    element.scrollTop = top;
    element.scrollLeft = left;
  }, [scrollFollow]);

  function scrolled() {
    const element = scrollRef.current;
    if (!element || !onScrolled) return;
    const expected = expectedScroll.current;
    if (expected && Math.abs(element.scrollTop - expected.top) < 2 && Math.abs(element.scrollLeft - expected.left) < 2) {
      expectedScroll.current = null; // this version moved because the other one did
      return;
    }
    const fraction = (position: number, room: number) => (room > 0 ? position / room : 0);
    onScrolled(
      fraction(element.scrollTop, element.scrollHeight - element.clientHeight),
      fraction(element.scrollLeft, element.scrollWidth - element.clientWidth),
    );
  }

  // The width available decides the "fit width" scale. A hidden pane has none, and draws nothing until shown.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((current) => (Math.abs(current - next) > 2 ? next : current));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!file) return;
    openPdf(file).catch(() => {});
    return () => closePdf(file);
  }, [file]);

  useEffect(() => {
    if (!file || width === 0) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const document = await openPdf(file);
      closePdf(file); // openPdf counts a user; this effect only borrows the one held above
      const pdfPage = await document.getPage(page);
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale = zoom === "fit" ? Math.max(0.25, (width - 2) / natural.width) : zoom;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      task = pdfPage.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await task.promise;
      if (!cancelled) {
        setFailed(false);
        setDrawn({ page, scale, width: viewport.width, height: viewport.height });
      }
    })().catch((error: unknown) => {
      if (cancelled || (error as { name?: string } | null)?.name === "RenderingCancelledException") return;
      setFailed(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [file, page, zoom, width]);

  // Once the page is drawn, bring the active change's outline into view within the pane.
  useEffect(() => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>('[data-active="true"]') ?? null;
    if (target) scrollWithin(container, target, "center");
  }, [drawn, activation, reveal]);

  const onPage = drawn && drawn.page === page ? boxes.filter((box) => box.page === page) : [];
  const elsewhere = activeId !== null && activePage !== null && activePage !== page;
  const absent = activeId !== null && activePage === null;

  function currentScale(): number {
    return zoom === "fit" ? (drawn?.scale ?? 1) : zoom;
  }

  return (
    <div className="px-3 pb-3">
      <div className="flex flex-wrap items-center gap-1.5 pb-1.5 text-[0.8rem]">
        <button
          type="button"
          onClick={() => navigate(clamp(page - 1, pageCount), zoom)}
          disabled={page <= 1}
          aria-label={`Previous page of the ${name} document`}
          className="rounded-[3px] border border-rule-strong bg-paper px-2 py-0.5 hover:bg-surface disabled:text-ink-soft/60"
        >
          ‹ Prev
        </button>
        <span className="tabular" aria-live="polite">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => navigate(clamp(page + 1, pageCount), zoom)}
          disabled={page >= pageCount}
          aria-label={`Next page of the ${name} document`}
          className="rounded-[3px] border border-rule-strong bg-paper px-2 py-0.5 hover:bg-surface disabled:text-ink-soft/60"
        >
          Next ›
        </button>
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => navigate(page, Math.max(0.5, Math.round(currentScale() * 80) / 100))}
            aria-label={`Zoom out of the ${name} document`}
            className="rounded-[3px] border border-rule-strong bg-paper px-2 py-0.5 hover:bg-surface"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => navigate(page, "fit")}
            aria-pressed={zoom === "fit"}
            aria-label={`Fit the ${name} page to the width`}
            className={[
              "rounded-[3px] border px-2 py-0.5",
              zoom === "fit" ? "border-signal bg-signal-soft text-signal" : "border-rule-strong bg-paper hover:bg-surface",
            ].join(" ")}
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => navigate(page, Math.min(4, Math.round(currentScale() * 125) / 100))}
            aria-label={`Zoom in to the ${name} document`}
            className="rounded-[3px] border border-rule-strong bg-paper px-2 py-0.5 hover:bg-surface"
          >
            +
          </button>
        </span>
      </div>

      {elsewhere && (
        <p className="mb-1.5 text-[0.78rem]">
          <button
            type="button"
            onClick={() => navigate(clamp(activePage!, pageCount), zoom)}
            className="font-medium text-signal underline underline-offset-2"
          >
            Go to the change on page {activePage}
          </button>
        </p>
      )}
      {absent && (
        <p className="mb-1.5 rounded-[3px] border border-rule bg-surface px-2 py-1 text-[0.78rem] text-ink-soft">
          {activeKind === "added" && side === "original"
            ? "Not in the original: this was added in the revised version."
            : activeKind === "removed" && side === "revised"
              ? "Not in the revised version: this was removed."
              : `This change has no recorded position in the ${name} version.`}
        </p>
      )}

      <div
        ref={scrollRef}
        onScroll={scrolled}
        role="region"
        aria-label={`${side === "original" ? "Original" : "Revised"} document, page ${page}`}
        tabIndex={0}
        className="max-h-[36rem] overflow-auto rounded-[3px] border border-rule bg-surface"
      >
        {!file ? (
          <p className="p-3 text-[0.82rem] text-ink-soft">
            The {name} file is no longer open in this tab, so its pages cannot be drawn. The evidence panel quotes the
            exact wording.
          </p>
        ) : failed ? (
          <p className="p-3 text-[0.82rem] text-ink-soft">
            This page could not be drawn in your browser. The comparison is unaffected; the evidence panel quotes the
            exact wording.
          </p>
        ) : (
          <div className="relative mx-auto w-fit bg-paper">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Page ${page} of the ${name} document`}
              className={drawn ? "block" : "hidden"}
            />
            {!drawn && <p className="p-3 text-[0.82rem] text-ink-soft">Drawing page {page}…</p>}
            {onPage.map((box, index) => {
              const active = box.changeId === activeId;
              const scale = drawn!.scale;
              return (
                <span
                  key={`${box.changeId}-${index}`}
                  data-active={active ? "true" : undefined}
                  aria-hidden="true"
                  className={[
                    "pointer-events-none absolute rounded-[1px]",
                    active
                      ? "border-2 border-signal bg-signal/10"
                      : side === "original"
                        ? "border border-dashed border-removed/70 bg-removed/5"
                        : "border border-dashed border-added/70 bg-added/5",
                  ].join(" ")}
                  style={{
                    left: box.bbox.x0 * scale - 2,
                    top: box.bbox.y0 * scale - 2,
                    width: (box.bbox.x1 - box.bbox.x0) * scale + 4,
                    height: (box.bbox.y1 - box.bbox.y0) * scale + 4,
                  }}
                >
                  {active && (
                    <span
                      className={[
                        "absolute left-0 rounded-[2px] bg-signal px-1 text-[0.65rem] leading-4 font-semibold text-white",
                        box.bbox.y0 * scale < 18 ? "top-full" : "-top-4",
                      ].join(" ")}
                    >
                      #{box.number}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-1 text-[0.72rem] text-ink-soft">
        Drawn from your own file in this browser. Outlines show where the comparison found each change.
      </p>
    </div>
  );
}

function clamp(page: number, count: number): number {
  return Math.min(Math.max(1, page), Math.max(1, count));
}

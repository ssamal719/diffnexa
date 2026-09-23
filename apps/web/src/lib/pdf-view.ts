/**
 * Opens a PDF the person chose, in their own browser, so the workspace can
 * draw its pages.
 *
 * The file never leaves the browser for this: pages are drawn from the File
 * object the person picked. The same safeguards as the upload check apply —
 * PDF.js runs in a background worker, scripting and XFA forms are off, and
 * nothing is fetched from anywhere else.
 */

import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { loadPdfJs } from "@/lib/pdf-preview";

type Entry = { promise: Promise<PDFDocumentProxy>; users: number; destroy: () => void };

const open = new Map<File, Entry>();

/** The document for a file, opened once and shared while anything is showing it. */
export function openPdf(file: File): Promise<PDFDocumentProxy> {
  const existing = open.get(file);
  if (existing) {
    existing.users += 1;
    return existing.promise;
  }
  const entry: Entry = { promise: Promise.resolve(null as never), users: 1, destroy: () => {} };
  entry.promise = (async () => {
    const pdfjs = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjs.getDocument({ data, disableAutoFetch: true, disableStream: true, enableXfa: false });
    entry.destroy = () => void task.destroy();
    return task.promise;
  })();
  open.set(file, entry);
  return entry.promise;
}

/** Lets go of a file; the document is closed when nothing is showing it any more. */
export function closePdf(file: File): void {
  const entry = open.get(file);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  open.delete(file);
  entry.promise.then(entry.destroy, entry.destroy);
}

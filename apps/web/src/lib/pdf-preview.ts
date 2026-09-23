/**
 * Reads a PDF in the browser far enough to count its pages and notice obvious
 * problems. PDF.js runs in a background worker, so a large file never freezes
 * the page.
 *
 * Scripting inside the PDF is disabled, external links are not followed and
 * nothing is fetched from other domains: an uploaded PDF is untrusted input.
 */

import { checkPageCount, checkSignature, type CheckResult, type UploadLimits } from "@/lib/validation";

/**
 * Where the browser fetches the PDF.js worker.
 *
 * This is an application route, not a file in public/, because the worker is an
 * ES module and browsers refuse to run a module script unless the server
 * declares it as JavaScript. Serving it ourselves means the Content-Type is
 * correct everywhere, without configuring MIME types on the web server.
 * See src/app/pdf-worker/route.ts.
 */
export const PDF_WORKER_URL = "/pdf-worker";

export type PdfInspection =
  | { ok: true; pageCount: number; encrypted: boolean }
  | { ok: false; code: import("@/lib/validation").ErrorCode };

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJs> | null = null;

export async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    // The "legacy" build is deliberate: the default build requires very recent
    // JavaScript features (such as Promise.try) and fails outright on browsers
    // older than roughly 2024. The legacy build behaves identically on modern
    // browsers and keeps the tool working on older office machines and phones.
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function propagate(result: CheckResult): PdfInspection | null {
  return result.ok ? null : { ok: false, code: result.code };
}

export async function inspectPdf(file: File, limits: UploadLimits): Promise<PdfInspection> {
  const header = await file.slice(0, 1024).arrayBuffer();
  const signature = propagate(checkSignature(header));
  if (signature) return signature;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data,
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false, // XFA forms can carry scripting; we only need the page count
  });

  try {
    const document = await task.promise;
    const pageCount = document.numPages;
    await task.destroy();
    const pages = propagate(checkPageCount(pageCount, limits));
    if (pages) return pages;
    return { ok: true, pageCount, encrypted: false };
  } catch (error) {
    void task.destroy();
    return { ok: false, code: classifyPdfJsError(error) };
  }
}

/** Turns a PDF.js failure into one of our user-facing codes. */
export function classifyPdfJsError(error: unknown): import("@/lib/validation").ErrorCode {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = (error as { message?: string } | null)?.message ?? "";
  if (name === "PasswordException" || /password/i.test(message)) return "password_protected";
  if (name === "InvalidPDFException" || /invalid pdf|structure/i.test(message)) return "corrupted";
  return "corrupted";
}

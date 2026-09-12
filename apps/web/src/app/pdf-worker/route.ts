import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

/**
 * Serves the PDF.js background worker as JavaScript.
 *
 * Why this exists rather than a plain file in public/:
 *
 * The worker is an ES module, and browsers apply strict MIME checking to module
 * scripts — they refuse to run one unless the server calls it JavaScript. Its
 * extension is `.mjs`, which many web servers do not have in their MIME table,
 * so they fall back to `text/plain` and the browser blocks it. That is what
 * happened in production: the worker never started, PDF.js could not open any
 * file, and the page reported perfectly good PDFs as damaged.
 *
 * Setting the header here makes the answer come from the application itself, so
 * it is identical in local development and on any host, and nobody has to
 * configure MIME types on the server. Nothing about PDF validation changes: the
 * worker simply loads, so validation can run at all.
 */

const WORKER_MODULE = "pdfjs-dist/legacy/build/pdf.worker.min.mjs";

let cached: Buffer | null = null;

async function readWorker(): Promise<Buffer> {
  if (cached) return cached;

  const candidates: string[] = [];
  try {
    // Normal case: read it straight out of the installed package, so the file
    // served is always the exact build that matches the library we import.
    candidates.push(createRequire(import.meta.url).resolve(WORKER_MODULE));
  } catch {
    // Resolution can fail in a bundled deployment; the copies below cover it.
  }
  candidates.push(
    join(process.cwd(), "public", "pdf.worker.min.mjs"),
    join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
  );

  for (const path of candidates) {
    try {
      cached = await readFile(path);
      return cached;
    } catch {
      continue;
    }
  }
  throw new Error("The PDF.js worker file could not be found in this deployment.");
}

export async function GET() {
  try {
    const worker = await readWorker();
    return new Response(new Uint8Array(worker), {
      status: 200,
      headers: {
        // The whole point of this route. "text/javascript" is the standard
        // MIME type for JavaScript and is accepted for module scripts.
        "Content-Type": "text/javascript; charset=utf-8",
        // The worker is immutable for a given build of the app.
        "Cache-Control": "public, max-age=31536000, immutable",
        // Tell the browser not to second-guess the type we just declared.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // A plain-text 500 rather than a broken script, so the failure is obvious
    // in the network panel instead of appearing as a corrupted PDF.
    return new Response("PDF worker unavailable", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Copies the PDF.js background worker into public/ so the browser can load it
 * from our own domain. Keeping it a plain static file (rather than bundling it)
 * avoids bundler-specific breakage and means no third-party requests.
 *
 * This copies the "legacy" worker to match the legacy build imported in
 * src/lib/pdf-preview.ts. The two must always come from the same build, or the
 * worker will fail to start.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");

mkdirSync(join(appRoot, "public"), { recursive: true });
copyFileSync(
  join(appRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
  join(appRoot, "public", "pdf.worker.min.mjs"),
);
console.log("Copied PDF.js worker -> public/pdf.worker.min.mjs");

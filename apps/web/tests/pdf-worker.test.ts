/**
 * Regression tests for how the PDF.js worker is delivered.
 *
 * Production once served the worker from public/ as `pdf.worker.min.mjs`. The
 * web server had no MIME type for `.mjs`, sent it as `text/plain`, and the
 * browser refused to run it because module scripts are strictly type-checked.
 * PDF.js then failed to open any file, and the page told people their perfectly
 * good PDFs were damaged.
 *
 * These tests fail if the worker is ever served with a non-JavaScript type
 * again, or if the library and the route stop pointing at the same place.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GET } from "@/app/pdf-worker/route";
import { PDF_WORKER_URL } from "@/lib/pdf-preview";

const MODULE_SCRIPT_MIME_TYPES = ["text/javascript", "application/javascript"];

describe("the worker URL", () => {
  it("is an application route, not a static .mjs file", () => {
    expect(PDF_WORKER_URL).toBe("/pdf-worker");
    // A path ending in .mjs is what caused the outage: its MIME type depends on
    // the web server's configuration rather than on our code.
    expect(PDF_WORKER_URL.endsWith(".mjs")).toBe(false);
  });

  it("matches the route that exists in the app", async () => {
    // src/app/pdf-worker/route.ts serves PDF_WORKER_URL. If either side is
    // renamed without the other, this import or the path check fails.
    expect(typeof GET).toBe("function");
    expect(PDF_WORKER_URL).toBe("/pdf-worker");
  });
});

describe("the worker response", () => {
  it("is served with a JavaScript MIME type", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type") ?? "";
    const [mime] = contentType.split(";");
    expect(MODULE_SCRIPT_MIME_TYPES).toContain(mime.trim().toLowerCase());
    expect(contentType.toLowerCase()).not.toContain("text/plain");
  });

  it("tells the browser not to sniff a different type", async () => {
    const response = await GET();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("is cacheable, since a build's worker never changes", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toContain("max-age=");
  });

  it("returns the real worker, byte for byte", async () => {
    const expected = readFileSync(
      createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
    );
    const served = Buffer.from(await (await GET()).arrayBuffer());
    expect(served.length).toBe(expected.length);
    expect(served.equals(expected)).toBe(true);
  });

  it("is really the PDF.js worker and not some other file", async () => {
    const body = await (await GET()).text();
    expect(body.length).toBeGreaterThan(100_000);
    // Error classes the worker defines. If this file were ever swapped for
    // something else, these would not be in it.
    expect(body).toContain("InvalidPDFException");
    expect(body).toContain("PasswordException");
  });

  it("is JavaScript, not an HTML error page", async () => {
    // A misconfigured host returning its own 404 or error page was one way this
    // could fail silently: the response would be 200 with HTML in it.
    const body = await (await GET()).text();
    const start = body.trimStart();
    expect(start.startsWith("<")).toBe(false);
    expect(start.toLowerCase()).not.toContain("<!doctype");
    expect(body).not.toContain("<html");
  });
});

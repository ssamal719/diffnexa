# 0001. Use the PDF.js legacy build in the browser

**Date:** 11 September 2026 · **Stage:** 1 · **Status:** Accepted

## Decision

Import `pdfjs-dist/legacy/build/pdf.mjs` and ship the matching legacy worker,
rather than the default modern build.

## Why

The default build of pdfjs-dist 6.x uses `Promise.try`, a JavaScript feature
added to browsers only in 2024. On anything older the library fails to start, so
the upload page could not count pages at all. This was found by running the
library against real PDFs during Stage 1, not by reading documentation.

Many DiffNexa users will be on older office machines and budget Android phones.
Silently excluding them would be a serious defect. The legacy build behaves
identically on modern browsers; the only cost is a slightly larger file.

## Consequences

`src/lib/pdf-preview.ts` and `scripts/copy-pdf-worker.mjs` must always reference
the same build. Mixing a modern worker with the legacy library, or the reverse,
breaks page counting.

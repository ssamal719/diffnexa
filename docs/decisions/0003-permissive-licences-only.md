# 0003. Permissive open-source licences only

**Date:** 11 September 2026 · **Stage:** planning · **Status:** Accepted

## Decision

Use pdfplumber (MIT), pikepdf (MPL-2.0), pypdfium2 (Apache/BSD) and PDF.js
(Apache-2.0). Do not use PyMuPDF.

## Why

PyMuPDF is excellent for PDF work but is licensed under AGPL, which can require
publishing the source of a commercial hosted product unless a commercial licence
is bought. That is an unacceptable risk for a SaaS business.

## Consequences

Some features (notably table detection) take more work than with PyMuPDF. Any
new dependency must have its licence checked before it is added.

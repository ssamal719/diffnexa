# 0007 — DOCX page numbers come only from the layout Word recorded in the file

**Decided:** September 2026, with DOCX Page Location and Comparison Controls V1.

## Decision

1. A Word document has no pages of its own; pages exist only when a program
   lays the text out. DiffNexa shows a page number for a DOCX change only
   when the file records the layout Microsoft Word gave it when it was last
   saved:
   - Word writes a `w:lastRenderedPageBreak` marker where each page began,
     and its page and word counts in `docProps/app.xml`;
   - DiffNexa counts those markers, plus explicit page breaks
     (`w:br w:type="page"`, `w:pageBreakBefore`), while it reads the document.
2. The recorded layout is trusted only when it checks out against the file's
   own statistics: the statistics exist, the stored word count is not zero and
   is within 15% (at least 10 words) of the words DiffNexa read, and the pages
   counted equal the page count Word stored. Otherwise no page is shown for that
   document and the report says why (`no_statistics`, `statistics_out_of_date`,
   `pages_disagree`, `empty`).
3. A change's page is the page of the first word its evidence cites, including
   a page that begins part-way through a paragraph. The paragraph and table
   location stays beside it.
4. Pages are additive, like the view in 0006: `page` on each evidence item, a
   `layout` summary, and `page`/`pageBreaks` on view nodes. They are outside the
   document fingerprint, the change contract, the traceability check and what AI
   analysis receives.

## Why

- **Real pages, not arithmetic.** The requirement was pages that match what the
  reader sees in Word. Word records exactly that. Estimating from paragraph or
  word counts would be wrong on the first long table, heading or image.
- **Checked against a rendering.** The 135-page test documents are laid out by
  LibreOffice, the page of every changed word is read from the PDF it prints,
  and that layout is written into the files the way Word writes its own. The
  engine tests, the web tests, the browser test and the golden pair
  `pages-long-document` all compare DiffNexa's pages with those rendered pages.
- **Honest when unknown.** LibreOffice, Google Docs and python-docx do not
  record Word's layout; python-docx and LibreOffice also leave stale "1 page,
  0 words" statistics. Those files get no page numbers and a plain explanation,
  never a guess.

## Rejected

- *Rendering every DOCX to PDF on the server* (LibreOffice): a large new
  dependency and a second reading of an untrusted file. Its pages also differ
  from Word's when fonts differ, so it would still not be "the page in Word".
- *Estimating pages from paragraph or word counts*: invented numbers.

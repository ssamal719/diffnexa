# DiffNexa architecture

The approved plan, kept short. Anything changed after approval is recorded in
`decisions/`.

## Shape of the system

```
Browser  ──▶  Next.js website (Vercel)  ──▶  DiffNexa engine (Python, Cloud Run)
                      │                              │
                      └──────▶ Supabase ◀────────────┘        Gemini (optional)
                        database · login · private files
```

Four services in total: GitHub, Vercel, Supabase, Google Cloud. Background jobs
are rows in the database (decision 0002), and file cleanup runs on Supabase's
built-in scheduler, so no extra queue or scheduler service is needed for V1.

## The rule everything follows

The deterministic engine finds and proves every change. AI only labels, ranks and
explains changes that already exist, and must cite them. Comparison works
completely with AI switched off.

## Layers of the comparison engine

| Layer | Finds |
|---|---|
| 1. Structure | Page count, order, size, rotation, images, links, metadata |
| 2. Text | Added, removed, reworded and moved text, in reading order |
| 3. Values | Numbers, dates, money, percentages, identifiers, with the difference calculated |
| 4. Tables | Added/removed rows and columns, changed cells |
| 5. Visual | Replaced images, logos, stamps, signatures, layout |

Layers 2-5 arrive in Stages 3-7. Stage 1 built the foundation they all read from.

## The canonical document model

Every input becomes one neutral structure: Document → Pages → Words, where each
word carries its text, position, font, and **where the text came from** (the PDF's
text layer today, OCR later). The comparison engine only ever reads this model,
so OCR and future formats plug in without rewriting comparison.

## Evidence

A change that cannot point to a page and a location in the source PDFs cannot be
created. This is enforced in code, not by convention, and checked against the
real extracted documents by the traceability checker.

## Stages

1. **Foundation** — contracts, document model, validation, extraction, golden
   suite, upload page. *Complete.*
2. Secure upload, server validation, engine hosting, jobs, full extraction
3. Text comparison and page alignment — first real comparisons
4. Numbers, dates and identifiers
5. Tables
6. Visual changes, images, formatting, links, metadata
7. Full results experience: dashboard, filters, viewer, navigation, search
8. Optional AI, with real measured costs
9. Export and sharing
10. Accounts, limits, admin
11. Security hardening, retention, privacy pages
12. Public launch

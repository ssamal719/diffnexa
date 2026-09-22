# Competitor Monitor — V1

Tool #4, at `/competitor-monitor`. This is the honest picture of what V1 does,
how it decides what to call a change, what it refuses, and what it does not do.

---

## What it is

Competitor Monitor is a **product layer on the existing webpage comparison**. It
has no comparison engine of its own. Capturing, fetching, extracting, comparing,
volatility handling, evidence and traceability are all Website Change
Detector's, unchanged. What Tool 4 adds is:

1. **One signal per change** — which kind of content the change touches.
2. **The reader's labels** — the competitor's name and the page type.
3. **A report grouped by signal**, with every change still shown and still
   carrying its evidence.

No AI is involved in any of it.

### The workflow

```
Capture baseline  →  download .diffnexa-snapshot.json (kept by the user)
       … later …
Upload baseline + same address  →  "Check this page now"
       →  deterministic comparison  →  one signal per change  →  report + evidence
```

The baseline file holds the capture exactly as the engine produced it, wrapped
with the competitor's name, page type, address, title and capture time:

```json
{ "diffnexa": "competitor-baseline", "version": 1, "competitor": "Acme",
  "pageType": "pricing", "capturedAt": "…", "url": "…", "title": "…",
  "snapshot": { …the capture… } }
```

For backward compatibility the check also accepts a **Website Change Detector
capture** and a **Policy Monitor baseline** — the capture inside is the same
thing, and the engine validates it strictly either way.

The competitor's name and page type **never leave the browser**. The website's
routes forward only the address (capture) or the address and capture (check);
the engine never sees the labels, so they cannot influence how a page is read.
Tests assert this at both the route and the engine.

---

## The nine signals

| Signal | What it covers |
|---|---|
| Pricing & Commercial | Amounts of money, billing periods, trials, discounts |
| Product & Features | Sections the page calls features, integrations, products, what's new, changelog |
| Messaging & Positioning | The page's main heading and the opening text directly beneath it |
| Plans & Packaging | Plans and tiers named in headings and tables, and what is listed under them |
| Calls to Action | Links whose words ask the visitor to act (Start free, Sign up, Book a demo, Choose Pro…) |
| Content & Sections | Other headings, and content in other named sections |
| Links & Destinations | Other links added, removed or pointing somewhere new |
| SEO & Metadata | Page title, meta description, canonical link, page address |
| Other | Anything no rule clearly describes — an honest "not recognised", never a guess |

The report says "Touches Pricing & Commercial" — a statement about **where** a
change sits. It never says a change is important, a threat, an opportunity,
strategic, better or worse, and never guesses at a competitor's intent. Tests
scan every label, blurb and reason for those words.

### How a signal is chosen

Rules are applied in a fixed order; the first that applies wins. Each records
the exact text that produced it (a price, a heading, a link's words), and that
text is always taken from the change's own evidence.

1. **SEO & Metadata** — the change is to the title, description, canonical link
   or address.
2. **Calls to Action** — the change is to a link whose words are a call to
   action, or to a block made of nothing but links (a row of buttons) where the
   changed words belong to such a link. Words that merely *read* like a call to
   action in a paragraph are not one: the page's DOM must show they are a link.
   Links over eight words are prose, not buttons.
3. **Links & Destinations** — any other link change. (Link changes stop here.)
4. **Pricing & Commercial** — a changed value is an amount of money (currency
   symbol or code, as the existing value parser defines it); pricing words
   ("per month", "billed annually", "14-day trial", "20% off", "no credit card
   required"…) are in the changed words or within three words of them; or a
   table cell sits under a price column/row heading.
5. **Messaging & Positioning** — the page's H1, or the first three blocks of
   text directly under it. A page without an H1 is taken to lead with its first
   H2, unless that H2 itself names plans or features.
6. **Plans & Packaging / Product & Features** — a changed heading whose own
   words name plans ("Enterprise plan") or features; a table header naming a
   plan; otherwise the **nearest** section heading that names either. The main
   heading is ignored here, so a page titled "Simple plans for every team" does
   not turn its About section into plans. A heading naming both ("Compare plans
   and features") counts as plans.
7. **Product & Features** — the changed words themselves announce a feature
   ("now supports", "integrates with", "new feature").
8. **Content & Sections** — any other heading, or content inside a named section.
9. **Other** — nothing above applies.

The patterns are data, versioned together as `COMPETITOR_SIGNALS_VERSION`
(currently `2026.09.1`), and every response records the version that produced it.

### Guarantees (all tested)

- **Every change has exactly one signal.** Grouping is a partition: the groups
  add up to exactly the changes found — none lost, none counted twice.
- **No signal without a change.** An unchanged page produces no signals at all.
- **Classification never alters a change.** Values, deltas, evidence and order
  are byte-identical to Website Change Detector's result for the same pair.
- **Every signal is traceable** to text in its change's evidence.
- **Deterministic and byte-stable.** The same two captures always produce the
  same response, byte for byte.

### Pricing: what is *not* done

Values and differences come from the existing value parser, unchanged. There is
**no currency conversion**, **no monthly/annual inference**, and **no discount
calculation** — a price changing from $15 to $18 is reported as +3 (+20%)
because both values are in the same currency on the page, and nothing more is
derived.

---

## V1 limits

These are real limits of V1, stated on the page itself.

| Not supported | Detail |
|---|---|
| Scheduled monitoring | No checking on a schedule. The user checks when they choose. |
| Alerts | No email, Slack, webhook, push or any other notification. |
| Saved history / accounts | Nothing is stored on the server; no database; no account. The baseline file is the user's. |
| Multi-page / crawling | One address per capture; links are not followed. |
| Pages behind a login | Public pages only. |
| JavaScript-rendered pages | No JavaScript is executed; such pages are detected and refused with a clear message. |
| Visual / screenshot comparison | Words, values, links and structure only. |
| Pages disallowed by `robots.txt` | Respected, as in Website Change Detector. |
| AI | None. Deterministic rules only. |

All address rules, SSRF protections, size and time ceilings, redirect checks and
robots handling are Website Change Detector's, reached through the same fetcher;
Tool 4 adds no network behaviour of its own.

### Known imperfections

- **Button wording, unchanged destination.** When a button's words change but
  its link does not, the engine reports the change on the block the button sits
  in (word by word) — for example "Start" → "Get started" — rather than as a
  link change. It is still classified as a call to action. A **small** rewording
  of a standalone button that is not inside any block, with an unchanged
  destination, may not be reported at all; this is existing Website Change
  Detector behaviour, deliberately not changed here so Tools 2 and 3 stay
  identical.
- **`<button>` elements are not read.** Only links (`<a href>`) are recognised as
  calls to action; a form button with no link is not.
- **English phrases.** Pricing, plan, feature and call-to-action phrases are
  English. On other languages, changes are still found and fall back to Content
  & Sections or Other.
- **One signal per change.** A price inside a plan is Pricing, not Plans. The
  order above decides; the reason shown on each card says which rule applied.
- **Plans without the word "plan".** Plan headings such as "Starter" are
  recognised through the section heading above them ("Plans", "Pricing"); a
  plan list under a heading that names neither is Content & Sections.

---

## Interfaces

**Engine:** `POST /v1/competitor/compare` — body `{url, previous_snapshot}`;
response is the Website Change Detector comparison plus `competitorSignal` on
each change and a `competitor` block (`signalsVersion`, `signals[]` with
`changeCount` and `changeIds`, `changedSignals`). Capture reuses
`POST /v1/web/snapshot`. Same authentication, error codes and messages.

**Website:** `POST /api/competitor/snapshot` and `POST /api/competitor/compare`,
proxied server-side with the shared secret, which never reaches the browser.
Rate limits: own buckets `competitor-capture` and `competitor-compare`, 10 per
minute and 100 per hour per visitor — the same as the other page tools.

**Report states:** No changes found ("This page says the same as it did when you
captured your baseline." — never "the competitor has not changed"); changes
found; could not fetch page; address can't be checked / not a web page / needs
JavaScript; invalid baseline; baseline for a different page.

---

## Site-wide analytics (added with this release)

Google Analytics 4, measurement ID `G-DY4NR55EVR`, is added **once** for the
whole site from the root layout (`src/components/site/Analytics.tsx`, using the
built-in `next/script`, loaded after the page is interactive). It is not a secret
— it is visible in every page — and no page adds its own copy; a test enforces
both. No comparison data (addresses, file names or results) is sent to it.

---

## Tests and accuracy

- Engine: `tests/test_competitor_signals.py`, `test_competitor_classify.py`,
  `test_competitor_service.py`, `test_competitor_golden.py`.
- Golden corpus: `golden/competitor-pairs/` — 21 pairs covering every signal,
  including negative cases (no change, tracking parameters only, Cloudflare
  email token, call-to-action words in prose, a change no rule describes). Each
  is scored for recall, false positives, noise leakage and evidence like the
  other suites, and additionally for the right signal, forbidden signals,
  signal traceability and the partition. All are in the accuracy ratchet.
- Website: `tests/competitor-api.test.ts`, `competitor-report.test.ts`,
  `competitor-ui.test.tsx`, `analytics.test.tsx`, plus the shared SEO and
  homepage tests.

# Price Monitor — V1

Tool #5, at `/price-monitor`. What V1 does, how it decides what counts as a
price, what it refuses, and what it does not do.

---

## What it is

Price Monitor is a **thin product layer over Website Change Detector**. It has
no comparison engine of its own. Fetching (with its SSRF protections), extraction,
normalisation, volatility handling (including the Cloudflare email-token rule),
snapshots, comparison, evidence and traceability are all reused unchanged. What
Tool 5 adds:

1. **One price category per change** — a factual label for what kind of change
   it is.
2. **The reader's labels** — the product or service name and the page type.
3. **A report grouped by category**, where every change stays visible with its
   evidence. "Other Changes" holds everything that is not about pricing.

No AI is involved.

### The workflow (manual only)

```
Product / service + public address + page type
  → Capture this page → download .diffnexa-snapshot.json (kept by the user)
  … later …
  → same address + upload the file → Check this page now
  → deterministic comparison → one category per change → report + evidence
```

The baseline file is the existing capture, unchanged, wrapped with the labels:

```json
{ "diffnexa": "price-baseline", "version": 1, "product": "GitHub Copilot",
  "pageType": "subscription_plan", "capturedAt": "…", "url": "…", "title": "…",
  "snapshot": { …the same capture every webpage tool uses… } }
```

The check also accepts baselines from Website Change Detector, Policy Monitor
and Competitor Monitor, because the capture inside is the same thing.

The product name and page type **never leave the browser**: the website's
routes forward only the address (capture) or the address and capture (check).
The page type therefore cannot change how a page is read or compared; tests
check this in the website, the routes and the engine. Nothing is stored on the
server: the uploaded baseline travels with the one request and is discarded when
the result is returned.

---

## The nine categories

| Category | What it covers |
|---|---|
| Price | Amounts of money, with a currency symbol or code, or in a price column |
| Discount / Sale Price | Amounts the page words as a sale: now, sale, save, offer price, % off |
| Original / Compare-at Price | Amounts the page marks as the original: was, regular price, list price, MRP |
| Currency | An amount now in a different currency, or a currency named on its own |
| Billing Period | per month ↔ per year, monthly ↔ annual, weekly, one-time |
| Product / Plan | Headings with a price directly under them, headings naming a plan, header cells of a priced table |
| Availability | in stock, out of stock, sold out, pre-order, contact sales … |
| Pricing Details | Other content where prices are laid out (plan inclusions, user limits, trial length) |
| Other Changes | Everything else — text, headings, links, metadata — shown in full |

### What counts as a price (the critical rule)

A number is a price **only when the page marks it as money**:

- a currency symbol or code written with it: `$29`, `$29.99`, `€29`, `£29.99`,
  `₹2,499`, `₹2499`, `USD 29`, `EUR 29`, `GBP 29`, `INR 2499`, `Rs. 2,499`,
  `29 USD`; or
- a table column or row headed as a price ("Price (USD)", "Cost", "Fee").

So "10 users", "a 14-day trial", "99% uptime", a customer count and a
warranty length are **never** labelled as prices. Tests and negative golden pairs
enforce this. Inside a pricing card they appear as Pricing Details; elsewhere
as Other Changes.

The engine often reports only the changed word — "2499 → 2999" for
"INR 2499 → INR 2999", or "month → year" for "per month → per year". So each
rule reads a small, fixed window of words around the change: one word for a
currency code, three for "was"/"now"/"% off", two for availability wording.
Rules never read a whole paragraph. Sale and original-price wording belongs only
to the amount beside it: in "MRP ₹2,999 ₹1,999", "MRP" labels ₹2,999, not ₹1,999.

### How a category is chosen

Fixed order; the first rule that applies wins:

1. Page title / description / canonical / address → Other Changes
2. A link → Availability if its words say so, else Other Changes
3. Changed words are money → Currency (currency differs) · Pricing Details (same
   amount written differently) · Original (was/MRP beside it) · Discount
   (now/sale/save/off beside it) · a sale/original/price column · else Price
4. A currency on its own → Currency
5. A percentage with sale wording beside it → Discount / Sale Price
6. A number in a price column → Price
7. A billing period ("month"/"year" only with per, "/" or billed beside them;
   and only where there is a price) → Billing Period
8. Availability wording → Availability
9. Product / plan heading or priced-table header → Product / Plan
10. Other content where prices are laid out → Pricing Details
11. Anything else → Other Changes

Every category records the exact text that produced it, taken from the change's
own evidence, and the report shows it as the reason ("“$39” is an amount with a
currency", "“now” is written beside it"). Rules are versioned as
`PRICE_RULES_VERSION` (`2026.09.1`).

### Guarantees (all tested)

- **Categories are labels, not filters.** Every change gets exactly one; the
  groups add up to exactly the changes found.
- **No change is altered.** Values, the engine's own difference (e.g.
  "+10 (+34.48%)"), evidence and order are byte-identical to Website Change
  Detector's result for the same pair.
- **Every category is traceable** to text in its change's evidence, and the
  existing traceability checker validates all evidence.
- **Deterministic and byte-stable.**
- **No evaluation.** No wording says a price is high, low, good, bad, a deal,
  the best or the cheapest, and nothing is predicted or ranked.

---

## V1 limits

| Not supported | Detail |
|---|---|
| Scheduled checking, cron, background jobs | Manual only; the user checks when they choose. |
| Alerts of any kind | No email, WhatsApp, Slack, webhooks, browser notifications or price alerts. |
| History, database, accounts | Nothing stored server-side; the baseline file is the user's. |
| Login-only pages, JavaScript-built pages | Public pages whose text is in the page; JS-built pages are refused with a clear message. |
| Crawling / several pages | One address per capture. |
| Screenshot or visual comparison | Words, values, links and structure only. |
| Shop / marketplace APIs, affiliate links | The public page only. |
| Price judgement, prediction, ranking, recommendations | Never. |

### Known imperfections

- **Formats.** The common formats above are recognised; not every way of
  writing a price is (other currencies such as AUD or CAD by code, prices
  written as words, "29 per month" with no currency outside a price column).
- **Crossed-out prices.** A price shown struck through with no words beside it
  (for example `<del>$99</del> $79`) is a plain Price, because the extracted
  text carries no "was" or "sale" wording.
- **A price line replaced whole.** When a block that is only a price changes,
  the engine may report it as one price removed and another added; both are
  labelled Price.
- **One category per change.** A price inside a plan is Price, not Product /
  Plan; the order above decides, and the card shows the reason.
- **English wording** for sale, original-price, billing and availability words.

---

## Interfaces

- **Engine:** `POST /v1/price/compare` (`{url, previous_snapshot}`) returns the
  Website Change Detector comparison plus `priceCategory` on each change and a
  `price` block (`rulesVersion`, `categories[]` with `changeCount` and
  `changeIds`, `changedCategories`). Capture reuses `POST /v1/web/snapshot`.
  Same authentication, errors and limits.
- **Website:** `POST /api/price/snapshot` and `POST /api/price/compare`, proxied
  server-side with the shared secret, which never reaches the browser. Own rate
  limits: 10 per minute and 100 per hour per visitor, the same as the other page tools.

## Tests

- Engine: `test_price_signals.py`, `test_price_classify.py`,
  `test_price_service.py`, `test_price_golden.py`.
- Golden: `golden/price-pairs/` — 28 pairs across SaaS pricing pages, a UK shop
  product page and an Indian product page (MRP / offer price / INR), including
  negative pairs for user limits, trial length, uptime, customer counts and
  warranty years. All are in the accuracy ratchet.
- Website: `price-api.test.ts`, `price-report.test.ts`, `price-ui.test.tsx`,
  `secret-exposure.test.ts`, plus the shared SEO, homepage and rate-limit tests.

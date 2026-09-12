# Website Change Detector — V1 limits, hardening and launch

Written at the end of W9. This is the honest picture of what V1 does, what it
refuses, what it costs, and what still needs a person to check.

---

## What V1 does and does not do

**It does:** capture a public web page, keep that capture as a file you hold,
and later tell you what the page says differently — wording, numbers, dates,
headings, list items, table cells, link destinations, and the page's own title,
description and canonical link. Volatile things such as timestamps and view
counters are recognised and set aside rather than reported as changes.

**It does not, and the interface says so:**

| Not supported | Why |
|---|---|
| Pages that build their content in the browser | No JavaScript is executed. Such pages are detected and refused with a clear message rather than compared as empty shells. |
| Pages behind a login | No authentication of any kind. |
| Following links / crawling | One address per capture. |
| Watching pages on a schedule | No monitoring, no alerts, no email. Checking happens when you choose. |
| Visual or screenshot comparison | Nothing is rendered, so nothing is compared visually. |
| Pages disallowed by `robots.txt` | Respected per RFC 9309. A site can opt out. |
| Saved history | Nothing about a page is stored on the server. The baseline is yours. |

**Known imperfections.** Extraction chooses the main content deterministically,
but complex layouts — three or more columns, sidebars woven into the article,
heavily nested `<div>` markup with no landmarks — may include some neighbouring
content or miss some. The rules that fired are recorded in every capture, so a
questionable reading is explainable rather than mysterious.

---

## Measured limits

Ceilings, and the reason for each:

| Limit | Value | Why |
|---|---|---|
| Page download | 5 MB decompressed | Enforced while streaming, so a compressed bomb is stopped mid-read. |
| Page elements | 60,000 | Beyond this the input is not a document anyone reads. Refused. |
| Content pieces read | 5,000 | Bounds the work one page can cause. Exceeding it truncates **with a visible warning**, never silently. |
| Uploaded baseline | 10 MB, 5,000 pieces | A capture claiming more was not made by DiffNexa. |
| Redirects | 3, each fully re-validated | |
| Connect / total time | 10s / 20s | |
| Ports | 80 and 443 only | |

### Measured performance

Realistic pages, on the development machine. Extraction is per page; a
comparison reads two.

| Page | Size | Pieces | Extract | Compare | Total |
|---|---|---|---|---|---|
| Small article | 2 KB | 13 | 0.001s | 0.03s | 0.03s |
| Documentation page | 12 KB | 191 | 0.012s | 1.18s | 1.19s |
| Long policy | 91 KB | 2,121 | 0.14s | 0.43s | 0.57s |
| Very large | 355 KB | 5,000 | 0.42s | 0.89s | 1.31s |

The network dominates: fetching a page takes longer than reading and comparing
it. The documentation-page row is slower than the larger rows because more of
its content genuinely changed, which is the expensive case.

**Worst case**, a page where nothing matches: 5,000 pieces, everything
different, 3.6s. Before W9 that same input took over three minutes.

---

## Security posture

The path is: browser → this site's server → the engine → the page.

- **The browser never reaches the engine.** It has no CORS origins, requires a
  bearer token on every `/v1/*` call, and its address exists only in
  server-side configuration.
- **Addresses are validated twice** — as written, and again against every IP
  DNS returns — and the connection is made to the validated address while the
  hostname is used for TLS, which is what closes DNS rebinding. Every redirect
  hop repeats the whole check. Link-local (cloud metadata) is blocked under
  every configuration.
- **Untrusted input is bounded before it is parsed**: body size, page size,
  element count, decompressed size, nesting depth.
- **Errors carry a code and a sentence.** No stack trace, no file path, no host,
  no secret. Tested on every failure path.

### Two real defects found and fixed during W9

1. **Extraction was quadratic in element count.** A 5 MB page within the fetch
   limit could occupy the service for minutes. Caused by recomputing each
   element's sibling position and document index per node. Now computed once:
   4,000 paragraphs went from 9.8s to 0.36s.
2. **Comparison was quadratic in unmatched blocks.** A wholly rewritten page —
   or a crafted baseline — cost minutes: 1,500 blocks took 187s. Regions past
   10,000 candidate pairs are now aligned in document order instead. Same input:
   1.03s. Both golden suites are unaffected, and Tool 1's output is unchanged.

Both were denial-of-service vectors reachable by anyone with a URL box.

---

## Rate limiting

In-memory, per client address, in the site's Node process.

| Operation | Per minute | Per hour |
|---|---|---|
| Compare two PDFs | 10 | 60 |
| Capture a page | 10 | 100 |
| Check a page | 10 | 100 |

Ten a minute is brisk for a person working through documents, so the limit
should never be felt in real use. Page operations reach out to someone else's
site, so being a polite visitor matters as much as protecting our own service.

**What this honestly buys:** it stops casual abuse and runaway scripts. It
resets on redeploy, it is per process, and it is keyed on an address an attacker
can vary. A determined attacker needs network-level protection, which belongs to
the host. This is the sensible minimum for a product with no users yet, and
adding a database to do better would be the wrong trade today.

---

## Launch checklist

Architecture: **GitHub → Hostinger (Next.js) → Render (Python engine)**. No Vercel.

### On Render (the engine)

- [ ] `ENGINE_SHARED_SECRET` set to a value from
      `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- [ ] Start command binds correctly: `diffnexa serve --host 0.0.0.0 --port $PORT`
- [ ] `DIFFNEXA_WEB_ALLOW_PRIVATE` **unset** (defaults to off — this is the
      switch that exists for tests and must never be on in production)
- [ ] `DIFFNEXA_WEB_PORTS` unset (defaults to 80 and 443)
- [ ] `DIFFNEXA_WEB_ROBOTS` unset (defaults to respecting robots.txt)
- [ ] Health check path set to `/healthz`
- [ ] `GET /healthz` returns `requires_auth: true`

### On Hostinger (the site)

- [ ] **`NEXT_PUBLIC_SITE_URL` set at BUILD time**, e.g.
      `NEXT_PUBLIC_SITE_URL=https://your-domain.com npm run build`. Next.js
      inlines this when it compiles, so setting it only on the running server
      has no effect: canonical links, Open Graph tags and the sitemap would all
      point at localhost, which tells search engines the real pages do not
      exist. The build prints a warning when it is missing.
- [ ] After deploying, check `/sitemap.xml` and a page's canonical link show the
      real domain
- [ ] `ENGINE_URL` = the Render address, **no trailing slash**
- [ ] `ENGINE_SHARED_SECRET` = the same value as Render
- [ ] `ENGINE_HEALTH_TIMEOUT_MS` left at its 60,000 default if the engine sleeps
      when idle
- [ ] Running as a Node server (`next start`), not a static export — the API
      routes and the PDF worker route do not exist in a static export
- [ ] No `NEXT_PUBLIC_` variable contains a secret

### Verify after deploying

- [ ] `/pdf-compare` and `/website-compare` both load
- [ ] `POST /api/web/snapshot` with `{"url":"http://169.254.169.254/"}` returns
      `url_not_allowed`
- [ ] A direct call to the engine without credentials returns **401**
- [ ] Capture a real page, download the baseline, upload it, compare
- [ ] Browser devtools: `/pdf-worker` is served as `text/javascript`
- [ ] No response anywhere contains the shared secret

### Still to verify on the real hosts

Two things cannot be checked from a development machine and need someone with
access:

1. **Upstream body-size limits.** Hostinger's proxy and Render both impose a
   maximum request body. Our ceilings are 10 MB (baseline upload) and 50 MB
   (PDF). If the host's limit is lower, large uploads will fail upstream with
   the host's own error page rather than ours. Verify by uploading a large PDF
   and a large baseline on the deployed site.
2. **Render's request timeout.** Our total budget is 20s for a fetch plus
   comparison time. If Render's timeout is shorter, slow pages will be cut off
   by the platform instead of by us.

Until both are measured, treat the documented limits as ours rather than the
system's.

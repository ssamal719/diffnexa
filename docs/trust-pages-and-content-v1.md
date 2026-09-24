# Trust pages, content quality and AdSense readiness V1

This stage adds the pages a visitor, a website owner or a reviewer expects to
find, and makes each tool page explain itself fully. It adds no advertising,
no ad placeholders and no approval claims. Meeting these requirements does not
guarantee AdSense approval.

Nothing in the comparison engine, the comparison workspace, the evidence
contracts, the API, AI analysis or file processing changed.

## New pages

| Page | What it is |
|---|---|
| `/about` | What DiffNexa is, why it exists, how it works (deterministic comparison, evidence, noise set aside, values, optional AI, minimal retention), every tool, and what it does not do |
| `/contact` | `info@diffnexa.com` as a mailto link, what to write about, what to include, links to About, Privacy and Terms. No form, because nothing exists to deliver one |
| `/privacy-policy` | Written from the code; findings below |
| `/terms-of-service` | Plain, reasonable terms, including that results have limits and should be verified. No company details, jurisdiction or registration are stated, because none are published |
| `/ai-change-analyst` | How the optional AI step works, what it adds, what it never does, where it is available, its privacy, and questions |
| `/bot` | For website owners: DiffNexaBot's user agent, what it fetches, how robots.txt controls it. The engine's user agent already pointed to this address, which returned 404 |

Every new page has:
- one H1 and a breadcrumb;
- a unique title and description, a canonical URL, and Open Graph and Twitter
  details;
- structured data: `AboutPage`, `ContactPage` or `WebPage`, plus a
  `BreadcrumbList`.

The contact page's structured data names only the published email address. All
new pages are in the sitemap.

## Privacy findings from the code

| Question | What the code does |
|---|---|
| Analytics | Google Analytics 4 (`G-DY4NR55EVR`) on every page, default configuration. It sets `_ga` cookies. Only page views are configured; no comparison data is sent to it |
| Other tracking or tag managers | None. The Google tag is loaded directly; Google Tag Manager containers are not used |
| DiffNexa's own cookies or browser storage | None |
| Advertising | None |
| Consent banner | None |
| Uploaded files | Passed from the website server to the engine. Held in memory while compared. The engine's web framework buffers uploads over 1 MB in an unnamed temporary file for the length of the request. Discarded afterwards; never saved to a database or storage |
| Results | Returned to the browser only |
| Web pages | Fetched once per capture or check as DiffNexaBot. Follows robots.txt, public addresses only, no JavaScript. Baselines stay on the visitor's device |
| AI Change Analyst | Only on request. Sends up to 100 detected changes with clipped values and excerpts to the configured provider (Google Gemini or an OpenAI-compatible service). Logs counts only |
| Visitor IP addresses | Used in memory by the website to rate-limit, in windows of up to an hour. Not persisted |
| Logs written by DiffNexa's code | AI usage counts, and an engine-unreachable warning. No content, file names or addresses |

Because the upload finding contradicted the site's earlier wording "compared in
memory", that phrase was replaced everywhere with "used only to produce your
comparison, and discarded".

## Tool page content

Each of the seven tool pages now has these sections, all specific to that tool:
- What is it?
- How to use it (or How it works)
- What it finds or shows
- How the results show their evidence (file tools and Website Change Detector)
- What happens to your data
- Limitations
- The optional AI step, with a link to `/ai-change-analyst`
- At least five questions, of which at least two are unique to the page
- Related tools

The questions requested for each tool are answered from the implementation.
Examples:
- PDF: scanned pages are flagged but not read.
- Excel: inserted rows are matched, and links are compared but never opened.
- Website: dynamic pages cannot be read, and one page is read per check.
- Price: not real-time.
- Competitor: public pages only, with robots.txt respected.

## Navigation and links

- **Header:** How it works, AI Change Analyst (now a page), About and Contact
  appear after the two tool menus. The current page is marked, and the phone
  menu is unchanged.
- **Footer:** a new Company column with About, Contact, Privacy Policy and
  Terms of Service. The Product column's AI Change Analyst link goes to the new
  page.
- **Links between pages:**
  - tool pages link to their related tools, `/ai-change-analyst` and
    `/privacy-policy`;
  - the web tools also link to `/bot`;
  - About links to every tool;
  - the AI page links to every tool;
  - Contact links to About, Privacy and Terms;
  - Privacy and Terms link to Contact;
  - the homepage's AI section and data section link to the AI page and the
    Privacy Policy.

## What still stands between this site and an AdSense-ready submission

1. **Cookie consent.** Google Analytics sets cookies with no consent mechanism.
   For visitors in the EEA, the UK and Switzerland, a consent mechanism is
   generally required for analytics cookies. AdSense requires a
   Google-certified consent management platform for those visitors when ads
   are served. This needs a decision: Google's own consent message in AdSense,
   or a certified CMP, together with Consent Mode for Google Analytics.
2. **A named operator.** The site states no person or organisation behind
   DiffNexa. Reviewers and visitors look for ownership. Add it to About and to
   the Privacy Policy when you are ready to publish it.
3. **ads.txt.** It can only be created once an AdSense publisher ID exists.
4. **The policy must be updated when ads go live.** Name the ad networks used,
   and confirm the wording reflects the consent setup.
5. **Legal review.** These pages are written to be accurate and readable, not
   as legal advice. Have them reviewed for the jurisdictions you operate in.
6. **Engine bug found earlier.** A web link whose visible text is longer than
   200 characters makes web checks fail. This is unrelated to AdSense but
   affects quality.
7. **DOCX accessibility (found earlier).** After a comparison, the upload
   areas and the side-by-side panes share the same landmark names (axe
   `landmark-unique`, a best-practice rule).

# Homepage, Header/Footer & SEO V2

This stage changes the website around the tools: the page width, the header,
the footer, the homepage, a 404 page, and a full search-engine pass on every
public page. It also records an AdSense-readiness audit. The comparison
workspace, the engines, the API contracts and AI Change Analyst are unchanged.

---

## Layout

- **One content width for the whole site:** 80rem (1280px) on a desktop, with
  16px side margins on a phone, 24px on a tablet and 32px on a desktop
  (`src/components/site/Container.tsx`). The header brand, every page's H1,
  the upload panels and the footer all start at the same left edge.
- **Comparison workspaces keep their extra width** (up to 92rem). Nothing
  inside the workspace changed.
- **Tool pages share one structure** (`src/components/site/ToolPage.tsx`):
  breadcrumb → H1 → introduction → the tool → the page's own sections →
  related tools.

## Header

- DiffNexa logo and wordmark on the left.
- Two menus:
  - **Compare:** PDF, DOCX, Excel.
  - **Web Monitoring:** Website Change Detector, Policy & Terms, Competitor, Price.
  - Each menu item has a one-line description.
- Two further links to homepage sections: **How it works** and **AI Change
  Analyst**. AI is presented as a step in the workflow, not as a separate tool.
- **Keyboard:** menus open and close with a real button that reports
  `aria-expanded`. **Escape** closes a menu and returns focus to its button.
  Clicking elsewhere, or moving focus away, also closes it.
- **Current page:** marked with `aria-current="page"`, and its group is highlighted.
- **Phone (under 1024px):** a single **Menu** button shows the whole list, with
  readable text and no sideways scrolling.
- **Crawlable:** every tool link is an ordinary `<a>` in the HTML the server
  sends, including while a menu is closed.

## Footer

- **Brand block:** "Know What Changed." and one factual sentence.
- **Link columns:**
  - Compare: 3 tools.
  - Monitor: 4 tools.
  - Product: How it works, AI Change Analyst, Your files and data.
- **Bottom row:** "© 2026 DiffNexa. All rights reserved." and "Comparison is
  deterministic: no AI decides what changed."
- The footer links only to pages and sections that exist; no legal or company
  pages are listed, because none exist yet (see below).

## Homepage

1. **Hero:**
   - "Know What Changed." and the positioning sentence.
   - Buttons: **Compare a Document** (goes to PDF Compare) and **Monitor a Web
     Page** (goes to Website Change Detector).
   - Three facts: no account, files not stored, deterministic.
   - A small panel labelled "Example result", showing what one change looks like.
2. **Compare and monitor with DiffNexa:** the seven tools in two groups, each
   card with its category, what it does, and an "Open …" link.
3. **How DiffNexa works:** Compare → Find → Prove.
4. **Why DiffNexa:** evidence for every change, deterministic results, AI when
   useful, nothing stored by default.
5. **AI Change Analyst:** "Understand the changes, after they are found." It
   explains changes the comparison already found; it never decides what changed.
6. **Your files and data:** what happens to documents, web pages, AI requests
   and site analytics, in plain words.
7. **Final call to action:** "Know what changed before it matters."

There are no statistics, customer logos, testimonials, ratings or claims
beyond what the product does; tests check for these.

## SEO

### Metadata per route (`src/lib/seo.ts`)

| Route | Title | Description (chars) |
|---|---|---|
| `/` | DiffNexa — Document & Web Page Comparison Tools | 145 |
| `/pdf-compare` | PDF Compare — Compare Two PDF Files and Find Changes \| DiffNexa | 146 |
| `/docx-compare` | DOCX Compare — Compare Word Documents and Find Changes \| DiffNexa | 144 |
| `/excel-compare` | Excel Compare — Compare Two Excel Files for Changes \| DiffNexa | 147 |
| `/website-compare` | Website Change Detector — Find Changes on a Web Page \| DiffNexa | 146 |
| `/policy-monitor` | Policy & Terms Monitor — Find Changes to Policy Pages \| DiffNexa | 154 |
| `/competitor-monitor` | Competitor Monitor — Track Changes on Competitor Web Pages \| DiffNexa | 156 |
| `/price-monitor` | Price Monitor — Track Changes to Public Pricing Pages \| DiffNexa | 157 |

Every page has:
- a unique title (70 characters or fewer, naming DiffNexa once);
- a unique description (110–160 characters);
- a canonical URL;
- Open Graph type, URL, site name, title and description;
- a Twitter `summary` card.

### Site address

The site address now defaults to **https://diffnexa.com**. It used to fall
back to localhost when `NEXT_PUBLIC_SITE_URL` was not set at build time, which
would have made every canonical and sitemap entry point at localhost.
`NEXT_PUBLIC_SITE_URL` still overrides it for a staging build, and
`.env.example` now shows the production address.

### Headings

Every public page has exactly one H1 in its server-rendered HTML.

| Page | H1 |
|---|---|
| PDF | Compare two PDF files and see exactly what changed |
| DOCX | Compare two Word documents and see exactly what changed |
| Excel | Compare two Excel workbooks and see exactly what changed |
| Website Change Detector | Find out what changed on a web page (unchanged) |
| Policy & Terms Monitor | See what changed in a policy or terms page (unchanged) |
| Competitor Monitor | See what changed on a competitor's webpage (unchanged) |
| Price Monitor | See what changed on a pricing or product page (unchanged) |

Each tool is also named in its breadcrumb. Section headings were enlarged.
Heading levels never skip.

### Structured data (JSON-LD, rendered on the server)

- **Homepage:** `WebSite` with `name`, `url`, `description`, `slogan` and
  `hasPart` (one `WebPage` per tool).
- **Each tool page:**
  - `WebApplication`: name, URL, description, category, and that it runs in a
    web browser.
  - `BreadcrumbList`: DiffNexa → the tool.
- **Deliberately absent:** ratings, reviews, offers/prices, people and user
  counts. A test checks this.
- `<` is escaped, so no value can break out of the script tag.

### Internal links

- The homepage, header and footer each link to all seven tools.
- Every tool page ends with **Related tools**:
  - PDF → DOCX, Excel
  - DOCX → PDF, Excel
  - Excel → PDF, DOCX
  - Website → Policy, Competitor, Price
  - Policy → Website, Competitor
  - Competitor → Price, Website
  - Price → Competitor, Website

### Sitemap and robots

- `/sitemap.xml` lists the homepage and the seven tools. It is built from the
  same list as the navigation, so a new tool cannot be left out.
- `/robots.txt` allows everything except `/api/` and `/pdf-worker`, and points
  at `https://diffnexa.com/sitemap.xml`.
- Unknown addresses return a real 404 page (status 404, marked `noindex`)
  that links to every tool.

### Content corrections

- **PDF "What happens to your files":** this still described an old pre-launch
  plan ("the PDFs never leave your device", "When comparison arrives…"). It now
  states what actually happens: files are sent to the comparison service,
  compared in memory and discarded.
- **DOCX introduction:** rewritten to say what the tool compares.

## AdSense readiness

No advertisements, ad placeholders or approval claims were added. Meeting this
checklist does not guarantee approval.

| Item | Status |
|---|---|
| Homepage explains what DiffNexa does | Done |
| Clear description of every tool | Done (cards, menus, page introductions) |
| Useful original content on every tool page | Present: what it finds, limits, privacy, questions, related tools |
| "How it works" | Homepage section, plus per-tool sections |
| Accurate limitations and supported features | Present on every tool page; the stale PDF privacy text was corrected |
| Transparent privacy / data-processing explanation | Homepage "Your files and data" section, plus per-tool text. **There is no Privacy Policy page.** |
| Clear ownership / brand identity | Brand is consistent in the header and footer. **No About or Contact page, so no owner or contact details are published.** |
| Consistent header and footer; easy navigation between tools | Done |
| No deceptive buttons, no fake social proof or claims, no misleading AI claims | Done, and checked by tests |
| No popups or interstitials | None exist |
| No thin, programmatic or duplicate SEO pages | 8 hand-written pages; no generated pages |
| Mobile-friendly, fast, accessible | Checked at 1440/1024/375px with 0 axe violations. Homepage locally: LCP about 0.2s, CLS 0.001, no images. |
| Proper 404, valid sitemap/robots, correct canonicals | Done |

### Trust and legal pages that are missing (a separate task)

These do not exist, and none were invented or linked:

1. **Privacy Policy.** This is the most important one: the site uses Google
   Analytics, AdSense requires a privacy policy that discloses cookies and
   third-party advertising, and it should also cover files, web pages and
   AI Change Analyst.
2. **Terms of Service.**
3. **About:** who operates DiffNexa.
4. **Contact:** a way to reach the operator.
5. **Cookie consent:** worth considering for visitors from regions that require
   it, once analytics and advertising cookies are both in use.

## Files

**New:**
- `src/components/site/Container.tsx`, `Logo.tsx`, `JsonLd.tsx`,
  `SiteFooter.tsx`, `ToolPage.tsx`
- `src/lib/seo.ts`
- `src/app/not-found.tsx`
- `tests/site-shell.test.tsx`
- this document

**Changed:**
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/sitemap.ts`
- all seven tool pages
- `src/components/site/SiteHeader.tsx`
- `src/components/excel/ExcelDesk.tsx`: its own width wrappers were removed so
  the shared page shell sizes it
- `src/lib/site.ts`, `src/lib/tools.ts`
- `tests/seo.test.ts`, `tests/homepage.test.tsx`, `tests/docx-ui.test.tsx`,
  `tests/excel-ui.test.tsx`
- `.env.example`

## Known limitations

- There is no social sharing image; the Twitter card is `summary`, without an
  image.
- The site address is fixed when the site is built. A staging build must set
  `NEXT_PUBLIC_SITE_URL`, or its canonicals will point at diffnexa.com (which
  is the safe direction).
- The sitemap's `lastmod` is the build time.
- The legal and company pages listed above are still to be written.

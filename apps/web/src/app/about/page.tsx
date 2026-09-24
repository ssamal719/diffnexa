import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/site/Container";
import { EmailLink, InfoPageIntro, Prose } from "@/components/site/InfoPage";
import { pageMetadata } from "@/lib/seo";
import { GROUPS, toolsIn } from "@/lib/tools";

export const metadata: Metadata = pageMetadata("/about");

/**
 * What DiffNexa is and why it works the way it does, in the product's own
 * terms. It states what the tools do and do not do; it makes no claims about
 * size, customers or rankings, because there are none to make.
 */
export default function AboutPage() {
  return (
    <>
      <InfoPageIntro path="/about" title="About DiffNexa">
        <p>
          DiffNexa compares two versions of a document or a web page and shows exactly what changed — with the
          wording and location behind each change as evidence, so you can check every result yourself.
        </p>
      </InfoPageIntro>

      <Container className="pb-16">
        <Prose className="mt-4">
          <h2 id="what-it-is" className="mt-6!">
            What DiffNexa is
          </h2>
          <p>DiffNexa is a set of comparison tools that share one comparison approach and one results workspace:</p>
          <ul>
            <li>
              <strong>Files you compare.</strong> Upload an original and a revised PDF, Word document or Excel workbook,
              and DiffNexa lists every change between them.
            </li>
            <li>
              <strong>Web pages you check.</strong> Save a baseline of a public web page today, check the page again
              whenever you choose, and DiffNexa shows what is different now.
            </li>
            <li>
              <strong>An optional explanation step.</strong> After any comparison, AI Change Analyst can explain the
              changes that were found. It never decides what changed.
            </li>
          </ul>

          <h2 id="why">Why it exists</h2>
          <p>
            Documents and web pages are revised constantly: a contract comes back with edits, a supplier updates its
            terms, a price list is reissued, a spreadsheet is passed around and returned. Finding what actually changed
            usually means reading two long versions side by side, and the change that matters — one date, one figure,
            one sentence in a cancellation clause — is easy to miss.
          </p>
          <p>
            General-purpose text comparison helps, but it tends to bury real changes in noise. A paragraph that moved to
            the next page looks rewritten. A new page number looks like an edit. A figure that went from 627 to 654 is
            shown as one number deleted and another added, and you work out the difference yourself.
          </p>
          <p>
            DiffNexa exists to answer one question well: <strong>what changed?</strong> It reports each change the way
            a careful reader would describe it — &ldquo;Vacancies changed from 627 to 654 (+27)&rdquo; — sets aside
            differences that are not changes, and shows where each change is.
          </p>

          <h2 id="principles">Know What Changed: how DiffNexa works</h2>
          <h3>The comparison is deterministic</h3>
          <p>
            Every change is found by fixed, tested comparison rules, not by an AI model. The same two versions always
            give the same result. New comparison behaviour is checked against a library of document and page pairs whose
            correct results are known, so an improvement in one place cannot quietly make results worse in another.
          </p>
          <h3>Every change comes with evidence</h3>
          <p>
            Each change names where it is — a page, a heading, a sheet and cell, a section of a web page — and quotes the
            wording involved from each version it appears in. You never have to take a result on trust.
          </p>
          <h3>Differences that are not changes are set aside</h3>
          <p>
            Page breaks, line wrapping, page numbers, reflowed paragraphs, a web page&apos;s menus, cookie notices and
            timestamps are not reported as changes. When something is set aside as probably unimportant, DiffNexa says
            so and why, rather than hiding it.
          </p>
          <h3>Numbers and dates are compared as values</h3>
          <p>
            A changed amount is one change with the difference worked out; a moved deadline is one change with the number
            of days between.
          </p>
          <h3>AI is optional, and comes second</h3>
          <p>
            <Link href="/ai-change-analyst">AI Change Analyst</Link> explains changes after the comparison has found them.
            It runs only when you ask, every statement it makes must point to a change DiffNexa found, and statements that
            cannot be matched to the evidence are not shown. The comparison and its evidence remain the source of truth.
          </p>
          <h3>As little as possible is kept</h3>
          <p>
            There are no accounts. Files are discarded when the comparison is done, results live only in your browser,
            and a web page&apos;s baseline is a file you keep. The <Link href="/privacy-policy">Privacy Policy</Link>{" "}
            sets this out in full.
          </p>
        </Prose>

        <section aria-labelledby="tools" className="mt-12">
          <h2 id="tools" className="text-[1.35rem] font-semibold tracking-tight">
            The tools
          </h2>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            {(["compare", "monitor"] as const).map((group) => (
              <div key={group} className="rounded-[10px] border border-rule bg-paper p-5">
                <h3 className="font-semibold">{GROUPS[group].heading}</h3>
                <p className="mt-1 text-[0.92rem] text-ink-soft">{GROUPS[group].blurb}</p>
                <ul className="mt-4 space-y-3">
                  {toolsIn(group).map((tool) => (
                    <li key={tool.href}>
                      <Link href={tool.href} className="font-medium text-signal hover:underline">
                        {tool.name}
                      </Link>
                      <p className="text-[0.92rem] text-ink-soft">{tool.summary}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="rounded-[10px] border border-dashed border-rule-strong bg-paper p-5 lg:col-span-2">
              <h3 className="font-semibold">Optional, after any comparison</h3>
              <p className="mt-2 text-[0.92rem]">
                <Link href="/ai-change-analyst" className="font-medium text-signal hover:underline">
                  AI Change Analyst
                </Link>
              </p>
              <p className="text-[0.92rem] text-ink-soft">
                Explains the changes a comparison found, labels how significant each looks, and cites the evidence behind
                every statement. Available in all seven tools.
              </p>
            </div>
          </div>
        </section>

        <Prose className="mt-4">
          <h2 id="limits">What DiffNexa does not do</h2>
          <p>Saying plainly what a tool cannot do is part of making its results trustworthy. Today, DiffNexa:</p>
          <ul>
            <li>does not read text inside images, including scanned PDF pages — it flags them instead;</li>
            <li>does not compare images, charts or visual layout;</li>
            <li>
              does not watch web pages for you — there is no scheduled checking and there are no alerts; you check when
              you choose;
            </li>
            <li>cannot read web pages behind a login, or pages that build their content in the browser with JavaScript;</li>
            <li>does not judge whether a change is good or bad for you, and does not give legal or financial advice;</li>
            <li>
              cannot promise to find every change in every file. It shows the evidence so you can check, and important
              results should be verified against the original documents.
            </li>
          </ul>
          <p>Each tool&apos;s page lists exactly what it compares and what it does not.</p>

          <h2 id="contact">Get in touch</h2>
          <p>
            Questions, bug reports and suggestions are welcome at <EmailLink />. The{" "}
            <Link href="/contact">contact page</Link> lists what to include so we can help quickly.
          </p>
        </Prose>
      </Container>
    </>
  );
}

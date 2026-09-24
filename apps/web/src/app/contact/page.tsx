import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/site/Container";
import { EmailLink, InfoPageIntro, Prose } from "@/components/site/InfoPage";
import { CONTACT_EMAIL, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/contact");

/**
 * How to reach DiffNexa. There is no contact form, because there is no
 * service behind one to deliver it: a form that looked like it sent a message
 * and did not would be worse than an address. The address opens the visitor's
 * own email program.
 */
const REASONS = [
  {
    title: "Product questions",
    detail: "How a tool works, what it compares, or which tool suits what you are trying to do.",
  },
  {
    title: "Bug reports",
    detail:
      "Something did not work, a result looks wrong, or a change was missed. Tell us which tool you used, what you expected and what you saw.",
  },
  {
    title: "Privacy requests",
    detail: "Questions about how your information is handled, or a request about information we hold.",
  },
  {
    title: "Legal questions",
    detail: "Questions about the Terms of Service, or a notice about content or use of the service.",
  },
  {
    title: "Feedback",
    detail: "What would make DiffNexa more useful to you, and what gets in your way.",
  },
  {
    title: "Partnerships and business",
    detail: "Working with DiffNexa, or using it within your organisation.",
  },
];

export default function ContactPage() {
  return (
    <>
      <InfoPageIntro path="/contact" title="Contact DiffNexa">
        <p>DiffNexa is reached by email. Every kind of question goes to the same address.</p>
      </InfoPageIntro>

      <Container className="pb-16">
        <section
          aria-labelledby="email-us"
          className="mt-8 max-w-[46rem] rounded-[12px] border border-rule bg-paper p-6 shadow-[0_1px_2px_rgba(20,32,44,0.05)]"
        >
          <h2 id="email-us" className="text-[1.1rem] font-semibold">
            Email
          </h2>
          <p className="mt-2 text-[1.35rem] font-semibold">
            <EmailLink className="text-signal underline underline-offset-4 hover:text-[#0e4467]" />
          </p>
          <p className="mt-3 text-[0.95rem] text-ink-soft">
            Choosing the address opens your own email program. If nothing happens, copy the address above and write
            from any email account.
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="mt-5 inline-flex items-center rounded-[8px] border border-signal bg-signal px-5 py-2.5 font-medium text-white hover:bg-[#0e4467]"
          >
            Write an email
          </a>
        </section>

        <section aria-labelledby="reasons" className="mt-12">
          <h2 id="reasons" className="text-[1.35rem] font-semibold tracking-tight">
            What you can contact us about
          </h2>
          <dl className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {REASONS.map((reason) => (
              <div key={reason.title} className="rounded-[10px] border border-rule bg-paper p-4">
                <dt className="font-semibold">{reason.title}</dt>
                <dd className="mt-1 text-[0.92rem] text-ink-soft">{reason.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <Prose className="mt-4">
          <h2 id="before-you-write">Before you write</h2>
          <ul>
            <li>
              <strong>Please do not attach confidential documents</strong> unless we ask for a specific file to
              investigate a problem. A description of the problem, or a version with sensitive details removed, is
              usually enough.
            </li>
            <li>
              <strong>For a web page problem,</strong> include the page address and the tool you used. The address helps
              us see what DiffNexaBot saw.
            </li>
            <li>
              <strong>For a result that looks wrong,</strong> say which change it was — the change number and where it is
              are shown in the result.
            </li>
            <li>
              <strong>DiffNexa does not keep your files or results,</strong> so we cannot look up a past comparison. Any
              details you send help us reproduce it.
            </li>
          </ul>

          <h2 id="more">More about DiffNexa</h2>
          <ul>
            <li>
              <Link href="/about">About DiffNexa</Link> — what it is, how it works and what it does not do.
            </li>
            <li>
              <Link href="/privacy-policy">Privacy Policy</Link> — what happens to the files and pages you compare.
            </li>
            <li>
              <Link href="/terms-of-service">Terms of Service</Link> — the rules for using DiffNexa.
            </li>
            <li>
              <Link href="/bot">DiffNexaBot</Link> — for website owners who see DiffNexa&apos;s page fetcher in their logs.
            </li>
          </ul>
        </Prose>
      </Container>
    </>
  );
}

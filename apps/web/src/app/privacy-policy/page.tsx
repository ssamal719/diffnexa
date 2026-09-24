import type { Metadata } from "next";
import Link from "next/link";

import { EmailLink, InfoPageIntro, LongPage, Prose } from "@/components/site/InfoPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/privacy-policy");

/**
 * The privacy policy describes the site as it is built, checked against the
 * code: what reaches our servers, what is kept (almost nothing), what Google
 * Analytics does, and what AI Change Analyst sends. Advertising is described
 * as a future possibility, because none runs today.
 */
const UPDATED = "2026-09-24";

const SECTIONS = [
  { id: "summary", label: "The short version" },
  { id: "introduction", label: "Introduction" },
  { id: "information-we-collect", label: "Information we collect" },
  { id: "information-you-provide", label: "Information you provide" },
  { id: "uploaded-files", label: "Uploaded files and comparison data" },
  { id: "urls", label: "Web addresses you submit" },
  { id: "ai", label: "AI Change Analyst" },
  { id: "automatic", label: "Automatically collected information" },
  { id: "cookies", label: "Cookies and similar technologies" },
  { id: "analytics", label: "Analytics" },
  { id: "advertising", label: "Advertising and Google AdSense" },
  { id: "use", label: "How we use information" },
  { id: "sharing", label: "How we share information" },
  { id: "providers", label: "Service providers and hosting" },
  { id: "retention", label: "Data retention" },
  { id: "security", label: "Data security" },
  { id: "choices", label: "Your choices and requests" },
  { id: "third-party-links", label: "Third-party links" },
  { id: "children", label: "Children's privacy" },
  { id: "international", label: "International data transfers" },
  { id: "changes", label: "Changes to this policy" },
  { id: "contact", label: "Contact us" },
];

export default function PrivacyPolicyPage() {
  return (
    <>
      <InfoPageIntro path="/privacy-policy" title="Privacy Policy" updated={UPDATED}>
        <p>
          This policy explains what information DiffNexa handles when you use diffnexa.com, why it is handled, how
          long it is kept, and the choices you have. It describes how the site works today.
        </p>
      </InfoPageIntro>

      <LongPage sections={SECTIONS}>
        <Prose>
          <section aria-labelledby="summary" className="rounded-[10px] border border-rule bg-surface p-5">
            <h2 id="summary" className="mt-0!">
              The short version
            </h2>
            <ul>
              <li>You do not need an account, and DiffNexa does not ask for your name or email address to use its tools.</li>
              <li>
                Files you compare are used only to produce your comparison and are discarded when the result is returned.
                They are not stored.
              </li>
              <li>
                When you check a web page, DiffNexa fetches that one public page. The baseline you save is a file on your
                own device.
              </li>
              <li>
                AI Change Analyst runs only when you ask. It receives the detected changes and short quoted excerpts,
                never your complete files.
              </li>
              <li>
                The site uses Google Analytics, which sets cookies, to understand how the site is used. DiffNexa does not
                show advertising today.
              </li>
            </ul>
          </section>

          <h2 id="introduction">Introduction</h2>
          <p>
            DiffNexa (&ldquo;DiffNexa&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) provides tools at{" "}
            <Link href="/">diffnexa.com</Link> that compare two versions of a document, or a public web page against a
            baseline you saved, and show what changed with the evidence behind each change. This policy covers the website
            and those tools. If you have a question about it, write to <EmailLink />.
          </p>

          <h2 id="information-we-collect">Information we collect</h2>
          <p>DiffNexa handles two kinds of information:</p>
          <ul>
            <li>
              <strong>Information you provide</strong> when you use a tool or write to us: the files you compare, the web
              addresses you check, labels you type, baseline files you upload, and the emails you send.
            </li>
            <li>
              <strong>Information collected automatically</strong> when your browser talks to our servers, and by
              Google Analytics: technical details of each request, and how the site is used.
            </li>
          </ul>
          <p>
            DiffNexa has no accounts, so it holds no profile about you, no password and no history of what you have
            compared.
          </p>

          <h2 id="information-you-provide">Information you provide</h2>
          <ul>
            <li>
              <strong>Files and web addresses.</strong> Explained in the next two sections.
            </li>
            <li>
              <strong>Labels.</strong> Some tools let you type a label, such as a competitor&apos;s name, a product name or
              a page type. The label is saved in the baseline file on your device and sent with a comparison so it can
              appear in your result. It is not stored by DiffNexa.
            </li>
            <li>
              <strong>Emails.</strong> If you write to <EmailLink />, we receive your email address, your message and
              anything you attach. We use them to reply and to deal with what you asked. Please do not send confidential
              documents unless we ask for a specific file to investigate a problem.
            </li>
          </ul>

          <h2 id="uploaded-files">Uploaded files and comparison data</h2>
          <p>This applies to PDF Compare, DOCX Compare and Excel Compare.</p>
          <ul>
            <li>
              <strong>Before anything is sent,</strong> your browser checks each file you choose, for example that it is
              the right type and can be opened. That check happens on your device.
            </li>
            <li>
              <strong>When you choose to compare,</strong> both files are sent over HTTPS to our website&apos;s server,
              which passes them to DiffNexa&apos;s comparison service. The service reads the two files, compares them
              and returns the result.
            </li>
            <li>
              <strong>While a comparison runs,</strong> the files are held in the service&apos;s memory. A large upload
              may be buffered in a temporary file on the server for the length of that request. When the request ends,
              the files are discarded. They are not saved to a database or file storage, and we cannot retrieve them
              afterwards.
            </li>
            <li>
              <strong>The result</strong> is sent back to your browser and exists only in the open page. Closing or
              reloading the page removes it. The PDF pages shown in a result are drawn in your browser from your own
              files.
            </li>
            <li>
              <strong>Our code does not write</strong> file names, file contents or comparison results to logs. We do not
              use your files or results to train AI models, and we do not sell them.
            </li>
          </ul>

          <h2 id="urls">Web addresses you submit</h2>
          <p>
            This applies to Website Change Detector, Policy &amp; Terms Monitor, Competitor Monitor and Price Monitor.
          </p>
          <ul>
            <li>
              When you capture or check a page, the address you enter is sent to DiffNexa&apos;s comparison service,
              which fetches that one public page as <Link href="/bot">DiffNexaBot</Link>. It follows the site&apos;s
              robots.txt rules, refuses private and internal network addresses, and does not run the page&apos;s
              JavaScript or load its images, scripts or other files.
            </li>
            <li>
              The page&apos;s text and structure are returned to your browser. When you capture a page, you download
              the result as a baseline file that stays on your device. When you check the page later, you upload that
              file again; it is used for that comparison and then discarded.
            </li>
            <li>
              The website you check receives a request from our server, not from your browser. We do not send it your
              IP address or anything that identifies you. It may log the request under its own policies.
            </li>
            <li>DiffNexa does not keep the addresses you check, the pages it fetched or your results.</li>
          </ul>

          <h2 id="ai">AI Change Analyst</h2>
          <p>
            <Link href="/ai-change-analyst">AI Change Analyst</Link> is optional. Nothing is sent to an AI service unless
            you choose to run it after a comparison.
          </p>
          <ul>
            <li>
              <strong>What is sent:</strong> the list of changes the comparison already found — the type of each
              change, where it is, the values before and after, and short quoted excerpts from each version. The number
              of changes and the length of each excerpt are limited. Your complete files, or a whole web page, are
              never sent.
            </li>
            <li>
              <strong>Who receives it:</strong> the third-party AI provider DiffNexa is configured to use. DiffNexa
              supports Google Gemini or a provider offering an OpenAI-compatible service, and every analysis names the
              provider that produced it. The provider handles the request under its own terms and privacy policy.
            </li>
            <li>
              <strong>What is kept:</strong> neither the request nor the reply is stored. The comparison service logs
              only counts for each analysis — how many changes, how much text was processed and how long it took — to
              follow usage and cost. The logs never contain your content.
            </li>
          </ul>

          <h2 id="automatic">Automatically collected information</h2>
          <ul>
            <li>
              <strong>Request details.</strong> When your browser loads a page or uses a tool, our servers receive the
              standard details every web request carries, such as your IP address, your browser&apos;s user agent, the
              address requested and the time.
            </li>
            <li>
              <strong>Limits on use.</strong> To stop any one visitor overloading the service, our website counts recent
              comparisons, page checks and AI analyses per IP address. These counts are held in the server&apos;s memory
              only. They are not written to a database, and they expire within an hour or when the server restarts.
            </li>
            <li>
              <strong>Hosting logs.</strong> Our hosting providers may keep standard technical logs of requests, such as
              IP addresses, times and the pages or services requested, under their own policies. These logs do not
              contain the files you upload.
            </li>
            <li>
              <strong>Analytics.</strong> Google Analytics collects information about how the site is used. See{" "}
              <a href="#analytics">Analytics</a>.
            </li>
          </ul>

          <h2 id="cookies">Cookies and similar technologies</h2>
          <p>
            DiffNexa&apos;s own code does not set cookies, and it does not use your browser&apos;s storage to track you.
          </p>
          <p>
            Google Analytics sets first-party cookies whose names begin with <code>_ga</code> (for example{" "}
            <code>_ga</code> and <code>_ga_</code> followed by an identifier). They distinguish one visitor and one visit
            from another, and by default they can last up to two years.
          </p>
          <p>
            You can block or delete cookies in your browser&apos;s settings. Blocking the Google Analytics cookies does
            not affect the tools. DiffNexa does not use advertising cookies today; see{" "}
            <a href="#advertising">Advertising and Google AdSense</a> for what would change if it did.
          </p>

          <h2 id="analytics">Analytics</h2>
          <p>
            DiffNexa uses Google Analytics 4, a service provided by Google, to understand how many people visit the site,
            which pages they use and how they found it. Google Analytics collects information such as:
          </p>
          <ul>
            <li>the pages you view and the site that referred you;</li>
            <li>an approximate location, such as country or city, derived from your IP address;</li>
            <li>your device type, browser, operating system and screen size;</li>
            <li>
              when and for how long you visit, and basic interactions such as scrolling or following a link to another
              site, when those measurement settings are switched on.
            </li>
          </ul>
          <p>
            DiffNexa does not send Google Analytics the files you compare, their names, the addresses you check, your
            comparison results or AI analyses.
          </p>
          <p>
            Google processes this information under its own policies. You can read{" "}
            <a href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer">
              how Google uses information from sites that use its services
            </a>
            , and you can stop Google Analytics collecting information about your visits with the{" "}
            <a href="https://tools.google.com/dlpage/gaoptout" rel="noopener noreferrer">
              Google Analytics Opt-out Browser Add-on
            </a>
            .
          </p>

          <h2 id="advertising">Advertising and Google AdSense</h2>
          <p>
            <strong>DiffNexa does not currently show advertising.</strong> We may show advertising in the future, for
            example through Google AdSense. We will update this policy before advertising is switched on and, where the
            law requires it, ask for your consent first.
          </p>
          <h3>When advertising is enabled</h3>
          <ul>
            <li>
              Third-party vendors, including Google, use cookies to serve ads based on a user&apos;s prior visits to this
              website or other websites.
            </li>
            <li>
              Google&apos;s use of advertising cookies enables it and its partners to serve ads to users based on their
              visits to this site and/or other sites on the Internet.
            </li>
            <li>
              You may opt out of personalized advertising by visiting Google&apos;s{" "}
              <a href="https://www.google.com/settings/ads" rel="noopener noreferrer">
                Ads Settings
              </a>
              . You can also opt out of some third-party vendors&apos; use of cookies for personalized advertising by
              visiting{" "}
              <a href="https://www.aboutads.info" rel="noopener noreferrer">
                www.aboutads.info
              </a>
              .
            </li>
            <li>
              If other advertising networks are used, they will be named in this policy with links to their websites and
              opt-out options.
            </li>
          </ul>

          <h2 id="use">How we use information</h2>
          <ul>
            <li>To provide the tools: to compare your files, fetch the pages you ask about, and run AI Change Analyst when you ask.</li>
            <li>To keep the service reliable and fair: to limit how much one visitor can use it and to diagnose errors.</li>
            <li>To understand how the site is used, through Google Analytics, so we can improve it.</li>
            <li>To reply to messages you send us.</li>
            <li>To meet legal obligations, and to protect the service and the people who use it.</li>
          </ul>
          <p>We do not sell personal information, and we do not build profiles of the people who use DiffNexa.</p>

          <h2 id="sharing">How we share information</h2>
          <ul>
            <li>
              <strong>Service providers</strong> that run parts of DiffNexa for us, listed in the next section. They
              receive only what their part of the service needs.
            </li>
            <li>
              <strong>Websites you ask us to check</strong> receive a request from DiffNexaBot for the page you named.
            </li>
            <li>
              <strong>When the law requires it,</strong> or where it is necessary to protect the rights, safety or
              security of DiffNexa, its users or others.
            </li>
          </ul>

          <h2 id="providers">Service providers and hosting</h2>
          <ul>
            <li>
              <strong>Hostinger</strong> hosts the diffnexa.com website and its server. See{" "}
              <a href="https://www.hostinger.com/legal/privacy-policy" rel="noopener noreferrer">
                Hostinger&apos;s privacy policy
              </a>
              .
            </li>
            <li>
              <strong>Render</strong> hosts DiffNexa&apos;s comparison service, which processes your files and fetches
              web pages. See{" "}
              <a href="https://render.com/privacy" rel="noopener noreferrer">
                Render&apos;s privacy policy
              </a>
              .
            </li>
            <li>
              <strong>Google</strong> provides Google Analytics. See{" "}
              <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
                Google&apos;s privacy policy
              </a>
              .
            </li>
            <li>
              <strong>The AI provider</strong> configured for AI Change Analyst receives requests only when you run it,
              as described <a href="#ai">above</a>.
            </li>
          </ul>

          <h2 id="retention">Data retention</h2>
          <ul>
            <li>
              <strong>Files you compare:</strong> discarded when the comparison request ends. Not stored.
            </li>
            <li>
              <strong>Comparison results:</strong> kept only in your open browser page.
            </li>
            <li>
              <strong>Baseline files:</strong> kept on your device, under your control. DiffNexa keeps no copy.
            </li>
            <li>
              <strong>Web pages fetched for you:</strong> not kept after your result is returned.
            </li>
            <li>
              <strong>AI Change Analyst requests and replies:</strong> not kept. Usage counts without content may
              appear in the comparison service&apos;s logs, which are kept under our hosting provider&apos;s log retention.
            </li>
            <li>
              <strong>Usage-limit counts:</strong> held in memory and gone within an hour.
            </li>
            <li>
              <strong>Analytics:</strong> kept by Google for the retention period set in DiffNexa&apos;s Google Analytics
              account.
            </li>
            <li>
              <strong>Emails:</strong> kept for as long as needed to deal with your message and any follow-up. You can
              ask us to delete them.
            </li>
          </ul>

          <h2 id="security">Data security</h2>
          <ul>
            <li>Pages and uploads travel over HTTPS.</li>
            <li>The comparison service is set up to accept requests only from DiffNexa&apos;s own website.</li>
            <li>
              Uploaded files are treated as untrusted: macros are never run, spreadsheet formulas are never calculated,
              and links inside documents are never followed.
            </li>
            <li>The page fetcher refuses private and internal network addresses, and limits how long it waits and how much it reads.</li>
            <li>Keys for the AI service are kept on the server and are never sent to your browser.</li>
          </ul>
          <p>
            Keeping as little as possible is also a safeguard: what is not stored cannot be exposed later. Still, no
            method of sending or processing information over the internet is completely secure, and we cannot guarantee
            absolute security.
          </p>

          <h2 id="choices">Your choices and requests</h2>
          <ul>
            <li>You choose what to compare and which pages to check. Do not submit anything you are not comfortable sending.</li>
            <li>You can use every tool without AI Change Analyst. Nothing is sent to an AI service unless you ask.</li>
            <li>
              You can block cookies in your browser, or use the Google Analytics Opt-out Browser Add-on. The tools work
              the same either way.
            </li>
            <li>
              Depending on where you live, you may have the right to ask for access to, correction of or deletion of
              personal information about you, or to object to how it is used. Email <EmailLink /> with your request.
              Because DiffNexa keeps no accounts, files or results, most requests will concern emails you have sent us or
              analytics data held by Google.
            </li>
          </ul>

          <h2 id="third-party-links">Third-party links</h2>
          <p>
            DiffNexa links to other websites, such as Google&apos;s settings pages, and its results show the addresses of
            pages you checked. Other websites have their own privacy practices, which this policy does not cover.
          </p>

          <h2 id="children">Children&apos;s privacy</h2>
          <p>
            DiffNexa is a general-purpose tool for comparing documents and web pages. It is not directed at children, and
            we do not knowingly collect personal information from children. If you believe a child has sent us personal
            information, contact us and we will delete it.
          </p>

          <h2 id="international">International data transfers</h2>
          <p>
            DiffNexa&apos;s service providers may process information in countries other than the one you live in, whose
            data-protection laws may differ from yours. Where that happens, the information is handled under the
            providers&apos; own safeguards and policies, linked above.
          </p>

          <h2 id="changes">Changes to this policy</h2>
          <p>
            If DiffNexa changes how it handles information — for example, if it introduces accounts or advertising — this
            policy will be updated first, and the date at the top of the page will change. Significant changes will be
            described on this page.
          </p>

          <h2 id="contact">Contact us</h2>
          <p>
            For questions about this policy or a privacy request, email <EmailLink />. You can also use the{" "}
            <Link href="/contact">contact page</Link>. The <Link href="/terms-of-service">Terms of Service</Link> explain
            the rules for using DiffNexa.
          </p>
        </Prose>
      </LongPage>
    </>
  );
}

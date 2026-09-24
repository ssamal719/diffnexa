import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/site/Container";
import { EmailLink, InfoPageIntro, Prose } from "@/components/site/InfoPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/bot");

/**
 * The page DiffNexaBot's user agent points to. Website owners who find it in
 * their logs should learn here, accurately, what it is, what it does and does
 * not do, and how to stop it — every statement matches the engine's fetcher.
 */
export default function BotPage() {
  return (
    <>
      <InfoPageIntro path="/bot" title="DiffNexaBot">
        <p>
          DiffNexaBot is the page fetcher behind DiffNexa&apos;s web tools. If you run a website and see it in your logs,
          this page explains what it is doing and how to control it.
        </p>
      </InfoPageIntro>

      <Container className="pb-16">
        <Prose className="mt-4">
          <h2 id="identify" className="mt-6!">
            How to recognise it
          </h2>
          <p>DiffNexaBot identifies itself with this user agent:</p>
          <p>
            <code className="rounded-[4px] border border-rule bg-surface px-2 py-1 text-[0.9rem]">
              DiffNexaBot/1.0 (+https://diffnexa.com/bot)
            </code>
          </p>

          <h2 id="what-it-does">What it does</h2>
          <p>
            DiffNexaBot fetches a page only when a person using <Link href="/website-compare">Website Change Detector</Link>
            , <Link href="/policy-monitor">Policy &amp; Terms Monitor</Link>,{" "}
            <Link href="/competitor-monitor">Competitor Monitor</Link> or <Link href="/price-monitor">Price Monitor</Link>{" "}
            asks DiffNexa to capture or check that page. Each request reads one page, so that person can see what the
            page says and, later, what changed on it.
          </p>
          <ul>
            <li>It fetches the single address it was given. It does not follow links or crawl a site.</li>
            <li>It does not run on a schedule. Every fetch is started by a person, when they choose.</li>
            <li>It reads the HTML only. It does not run JavaScript or load images, stylesheets, scripts or other files.</li>
            <li>It does not log in, submit forms or accept cookies.</li>
            <li>It follows at most three redirects, and only to public addresses on the standard web ports.</li>
            <li>It stops after 20 seconds, or after reading 5 MB, whichever comes first.</li>
            <li>DiffNexa limits how often each of its visitors can capture or check pages.</li>
          </ul>

          <h2 id="robots">Blocking or limiting it with robots.txt</h2>
          <p>
            DiffNexaBot reads your site&apos;s robots.txt before fetching a page and follows the rules for the{" "}
            <code>DiffNexaBot</code> user agent, or the rules for all robots (<code>*</code>) when there are none for it.
            To stop it fetching any page on your site:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-[8px] border border-rule bg-surface p-4 text-[0.9rem]">
            {"User-agent: DiffNexaBot\nDisallow: /"}
          </pre>
          <ul>
            <li>A robots.txt that returns a server error (5xx) is treated as &ldquo;do not fetch&rdquo; until it recovers.</li>
            <li>A missing robots.txt (for example a 404) is treated as having no rules.</li>
            <li>DiffNexaBot remembers your robots.txt for up to 15 minutes, so a change may take that long to apply.</li>
          </ul>
          <p>
            When a page is blocked, the person who asked for it is told the address can&apos;t be checked because some
            sites ask not to be read automatically.
          </p>

          <h2 id="what-happens">What happens to the page</h2>
          <p>
            The page&apos;s text and structure are returned to the person who asked for it. DiffNexa does not keep a copy,
            build an index or search engine, or use your pages to train AI models. The{" "}
            <Link href="/privacy-policy">Privacy Policy</Link> explains how DiffNexa handles information.
          </p>

          <h2 id="contact">Questions or problems</h2>
          <p>
            If DiffNexaBot is causing a problem for your site, or you have a question about it, email <EmailLink /> with
            your domain and the times of the requests you are seeing.
          </p>
        </Prose>
      </Container>
    </>
  );
}

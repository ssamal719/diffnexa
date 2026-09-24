import type { Metadata } from "next";
import Link from "next/link";

import { EmailLink, InfoPageIntro, LongPage, Prose } from "@/components/site/InfoPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/terms-of-service");

/**
 * Plain, reasonable terms for a free tool with no accounts. They say what the
 * service is, what it may be used for, and — most importantly for a comparison
 * product — that automated results have limits and important ones should be
 * checked. No company details are stated that DiffNexa has not published.
 */
const UPDATED = "2026-09-24";

const SECTIONS = [
  { id: "acceptance", label: "Acceptance of these terms" },
  { id: "description", label: "Description of DiffNexa" },
  { id: "eligibility", label: "Eligibility" },
  { id: "permitted-use", label: "Permitted use" },
  { id: "prohibited-use", label: "Prohibited use" },
  { id: "submitted-content", label: "Files and web addresses you submit" },
  { id: "your-responsibility", label: "Your responsibility for submitted content" },
  { id: "intellectual-property", label: "Intellectual property" },
  { id: "third-party-websites", label: "Third-party websites" },
  { id: "availability", label: "Service availability" },
  { id: "accuracy", label: "Accuracy and limitations" },
  { id: "no-advice", label: "No professional advice" },
  { id: "service-changes", label: "Changes to the service" },
  { id: "terms-changes", label: "Changes to these terms" },
  { id: "warranties", label: "Disclaimer of warranties" },
  { id: "liability", label: "Limitation of liability" },
  { id: "contact", label: "Contact" },
];

export default function TermsOfServicePage() {
  return (
    <>
      <InfoPageIntro path="/terms-of-service" title="Terms of Service" updated={UPDATED}>
        <p>
          These terms apply when you use diffnexa.com and its tools. They are written to be read: what DiffNexa does,
          what you may and may not use it for, and the limits of automated comparison.
        </p>
      </InfoPageIntro>

      <LongPage sections={SECTIONS}>
        <Prose>
          <h2 id="acceptance" className="mt-0!">
            Acceptance of these terms
          </h2>
          <p>
            By using DiffNexa (&ldquo;DiffNexa&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), you agree to these terms and to
            the way information is handled as described in the <Link href="/privacy-policy">Privacy Policy</Link>. If you
            do not agree, please do not use the service.
          </p>

          <h2 id="description">Description of DiffNexa</h2>
          <p>DiffNexa provides online tools that compare two versions of something and show what changed:</p>
          <ul>
            <li>
              <Link href="/pdf-compare">PDF Compare</Link>, <Link href="/docx-compare">DOCX Compare</Link> and{" "}
              <Link href="/excel-compare">Excel Compare</Link> compare two files you upload.
            </li>
            <li>
              <Link href="/website-compare">Website Change Detector</Link>,{" "}
              <Link href="/policy-monitor">Policy &amp; Terms Monitor</Link>,{" "}
              <Link href="/competitor-monitor">Competitor Monitor</Link> and{" "}
              <Link href="/price-monitor">Price Monitor</Link> compare a public web page against a baseline you saved
              earlier.
            </li>
            <li>
              <Link href="/ai-change-analyst">AI Change Analyst</Link> is an optional step that explains changes a
              comparison has already found.
            </li>
          </ul>
          <p>
            DiffNexa is currently free to use and needs no account. If paid features are introduced, their terms and
            prices will be shown to you before you pay for anything.
          </p>

          <h2 id="eligibility">Eligibility</h2>
          <p>
            You may use DiffNexa if you are able to agree to these terms under the law that applies to you. If you use
            DiffNexa on behalf of an organisation, you confirm that you are allowed to accept these terms for it.
          </p>

          <h2 id="permitted-use">Permitted use</h2>
          <p>
            You may use DiffNexa to compare documents and public web pages for your personal, professional or business
            purposes, in line with these terms and the law.
          </p>

          <h2 id="prohibited-use">Prohibited use</h2>
          <p>You must not:</p>
          <ul>
            <li>submit files or addresses you do not have the right to use, or use DiffNexa to break the law;</li>
            <li>
              use the web tools to reach pages that are not public, to get around a website&apos;s access controls, or in
              breach of a website&apos;s terms;
            </li>
            <li>
              send automated or high-volume requests, try to get around the limits on use, or use DiffNexa in a way that
              places an unreasonable load on it or on the websites it reads;
            </li>
            <li>
              upload malware, or files designed to harm DiffNexa, its providers or other people;
            </li>
            <li>
              probe, scan or test the security of DiffNexa, or try to reach systems behind it, without our written
              permission;
            </li>
            <li>use DiffNexa to harass, track or build profiles of individual people;</li>
            <li>copy, resell or present DiffNexa&apos;s service as your own.</li>
          </ul>
          <p>
            We may block access from any address or visitor that breaks these rules or puts the service at risk.
          </p>

          <h2 id="submitted-content">Files and web addresses you submit</h2>
          <p>
            You keep all rights in the files you upload and in anything you create with DiffNexa. You give DiffNexa
            permission to process your files, the addresses you submit and the pages fetched from them, only as needed to
            produce the comparison you asked for — and, if you choose, to send the detected changes to the AI provider
            that powers AI Change Analyst. How this information is handled, and how little of it is kept, is explained in
            the <Link href="/privacy-policy">Privacy Policy</Link>.
          </p>

          <h2 id="your-responsibility">Your responsibility for submitted content</h2>
          <p>
            You are responsible for what you submit. Before uploading a document, make sure you are permitted to share it
            with an online service — particularly if it is confidential or contains other people&apos;s personal
            information. Before checking a web page, make sure doing so is consistent with that site&apos;s terms.
          </p>

          <h2 id="intellectual-property">Intellectual property</h2>
          <p>
            The DiffNexa name, logo, website, software and written content belong to DiffNexa or its licensors. These
            terms do not give you rights to them, other than to use the service as described here. Documents and web
            pages you compare belong to their owners; DiffNexa claims no rights in them.
          </p>

          <h2 id="third-party-websites">Third-party websites</h2>
          <p>
            The web tools read pages on websites DiffNexa does not control, and DiffNexa links to other websites. We are
            not responsible for the content, availability or practices of those websites. A page may change, block
            automated access, or be unavailable when you check it.
          </p>

          <h2 id="availability">Service availability</h2>
          <p>
            We aim to keep DiffNexa available, but it may be slow, interrupted or unavailable at times — for maintenance,
            because of a problem with a provider, or because limits on use have been reached. AI Change Analyst depends on
            a third-party AI provider and may be unavailable even when comparison works. DiffNexa has no accounts and does
            not store your files or results, so keep your own copies of anything you need.
          </p>

          <h2 id="accuracy">Accuracy and limitations</h2>
          <p>
            DiffNexa is built to report changes accurately and to show the evidence behind each one, so that you can check
            it. Even so, automated comparison has limits, and DiffNexa does not guarantee that it will find every change
            or that every reported change is correct. For example:
          </p>
          <ul>
            <li>text that is part of an image, such as a scanned page, is not read;</li>
            <li>some content types — including images and visual layout — are not compared, and each tool says which;</li>
            <li>web pages that build their content with JavaScript, or sit behind a login, cannot be read;</li>
            <li>unusual file structures or page layouts may be read differently from how they look;</li>
            <li>
              AI Change Analyst&apos;s explanations and significance labels are generated by an AI model and may be wrong,
              even though they are checked against the comparison evidence.
            </li>
          </ul>
          <p>
            <strong>Verify important results yourself</strong> against the original documents or pages before relying on
            them, particularly where money, deadlines, legal rights or obligations are involved.
          </p>

          <h2 id="no-advice">No professional advice</h2>
          <p>
            DiffNexa reports what changed. It does not provide legal, financial, tax, compliance or other professional
            advice, and nothing it shows — including AI Change Analyst&apos;s explanations — is a substitute for advice
            from a qualified professional about your situation.
          </p>

          <h2 id="service-changes">Changes to the service</h2>
          <p>
            DiffNexa is developing. We may add, change or remove tools and features, and change limits on use, at any
            time.
          </p>

          <h2 id="terms-changes">Changes to these terms</h2>
          <p>
            We may update these terms. The date at the top of this page shows when they last changed. If you continue to
            use DiffNexa after a change, the updated terms apply from then on.
          </p>

          <h2 id="warranties">Disclaimer of warranties</h2>
          <p>
            DiffNexa is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent the law allows, we make
            no promises beyond those stated in these terms — including that the service will be uninterrupted or
            error-free, or that its results will be complete or suitable for a particular purpose. Some laws do not allow
            these promises to be excluded; where that is the case, this section applies only as far as the law permits.
          </p>

          <h2 id="liability">Limitation of liability</h2>
          <p>
            To the extent the law allows, DiffNexa is not liable for indirect or consequential losses, or for loss of
            profits, data, business or opportunity, arising from your use of the service or from relying on its results.
            DiffNexa is currently provided free of charge, which is reflected in these limits. Nothing in these terms
            limits liability that cannot be limited by law.
          </p>

          <h2 id="contact">Contact</h2>
          <p>
            Questions about these terms can be sent to <EmailLink />, or through the{" "}
            <Link href="/contact">contact page</Link>.
          </p>
        </Prose>
      </LongPage>
    </>
  );
}

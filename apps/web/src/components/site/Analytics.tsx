import Script from "next/script";

import { GA_MEASUREMENT_ID, GA_SCRIPT_URL } from "@/lib/analytics";

/**
 * The Google tag, loaded once for the whole site.
 *
 * Rendered only from the root layout, so every page carries it exactly once
 * and no page adds its own. It loads after the page is interactive, so it never
 * delays the tools themselves.
 *
 * Nothing about a comparison is sent: no addresses checked, no file names, no
 * results. The tag records page views, which is all this configuration asks of it.
 */
export function Analytics() {
  return (
    <>
      <Script id="ga4-loader" src={GA_SCRIPT_URL} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
      </Script>
    </>
  );
}

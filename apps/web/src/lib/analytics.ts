/**
 * Site-wide analytics settings.
 *
 * A Google Analytics 4 measurement ID is public by design: it is sent to every
 * visitor's browser in the page itself, so it is configuration, not a secret.
 * It lives here once, and the root layout is the only place that uses it.
 */
export const GA_MEASUREMENT_ID = "G-DY4NR55EVR";

export const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

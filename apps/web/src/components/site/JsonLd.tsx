import { serializeJsonLd } from "@/lib/seo";

/** Structured data for search engines, rendered into the page's HTML on the server. */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

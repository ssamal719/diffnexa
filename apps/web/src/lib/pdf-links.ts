/**
 * Linked page turning for PDF Compare: which page of the other version
 * matches the page the reader is on.
 *
 * The engine pairs pages by their text (`pageLinks` in the result): original
 * page 3 might be revised page 4 when a page was inserted before it. A page
 * only one version has is matched to the nearest paired page before it, so
 * turning past an inserted page keeps the other version where it was. Without
 * pairs (an older result), page N matches page N.
 */

export type PageLink = { previous: number | null; revised: number | null };

export type PdfSide = "original" | "revised";

export function counterpartPage(
  links: PageLink[] | undefined,
  from: PdfSide,
  page: number,
  otherCount: number,
): number {
  const clamp = (value: number) => Math.min(Math.max(1, value), Math.max(1, otherCount));
  if (!links || links.length === 0) return clamp(page);
  const here = (link: PageLink) => (from === "original" ? link.previous : link.revised);
  const there = (link: PageLink) => (from === "original" ? link.revised : link.previous);

  const exact = links.find((link) => here(link) === page);
  if (exact && there(exact) !== null) return clamp(there(exact)!);

  // The nearest page before this one that both versions have.
  let best: PageLink | null = null;
  for (const link of links) {
    const mine = here(link);
    if (mine !== null && mine <= page && there(link) !== null && (!best || mine > here(best)!)) best = link;
  }
  if (!best) return 1;
  return clamp(there(best)! + (exact ? 0 : page - here(best)!));
}

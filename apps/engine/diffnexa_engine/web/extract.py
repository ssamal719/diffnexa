"""Turning fetched HTML into a snapshot of what the page actually says.

This is the accuracy problem for Tool 2, and it is the web equivalent of reading
order in a PDF. A webpage carries its content inside navigation, banners,
adverts, share widgets and boilerplate, and comparing all of that would report a
rotating advert as a change to a contract.

The pipeline runs in five deterministic passes:

1. **Parse and strip** — remove what cannot be read or could execute.
2. **Choose the main region** — `<main>`, then `<article>`, then a scored
   region, then the body. The rule that fired is recorded in the snapshot.
3. **Remove chrome** — navigation, headers, footers, asides, ARIA-declared
   furniture, and elements whose id or class matches the versioned noise list,
   subject to guards that stop a mistaken match removing the content itself.
4. **Build content nodes** — one per heading, paragraph, list item, quote, table
   cell and in-content link, in document order, each recording where it sits.
5. **Normalise** — reusing the same `normalize()` the PDF side uses, so both
   tools treat whitespace, quotes and dashes identically.

Everything is derived from the page. Nothing is guessed, no model is consulted,
and the same HTML always produces the same snapshot.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urljoin, urlsplit, urlunsplit

import lxml.html
from lxml.html import HtmlElement

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.web.noise import (
    CHROME_ROLES,
    CHROME_TAGS,
    CONTENT_SHARE_GUARD,
    DROPPED_TAGS,
    HIDDEN_STYLE,
    NOISE_RULES_VERSION,
    VOID_TAGS,
    matches_noise_tokens,
)
from diffnexa_engine.web.snapshot import (
    ContentNode,
    ExtractionInfo,
    MainRegionStrategy,
    NodeRole,
    RenderNote,
    Snapshot,
    SnapshotMetadata,
    SnapshotSource,
    TableRef,
    WebToken,
    content_fingerprint,
)

EXTRACTOR_NAME = "diffnexa-html"
EXTRACTOR_VERSION = "1.0"

# A page with fewer readable words than this, whose markup shows the signs of an
# application shell, is reported as needing a browser rather than compared empty.
MIN_WORDS_FOR_CONTENT = 25
SHELL_MARKERS = ("__NEXT_DATA__", "data-reactroot", "ng-app", "ng-version", "data-vue", "__NUXT__")
SHELL_ROOT_IDS = ("root", "app", "__next", "__nuxt", "application")

# Query parameters that identify a campaign or a visitor, never the page.
TRACKING_PARAMETERS = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "utm_id",
        "utm_source_platform",
        "utm_creative_format",
        "utm_marketing_tactic",
        "gclid",
        "gclsrc",
        "dclid",
        "fbclid",
        "msclkid",
        "yclid",
        "igshid",
        "ttclid",
        "mc_cid",
        "mc_eid",
        "_hsenc",
        "_hsmi",
        "vero_id",
        "vero_conv",
        "wickedid",
        "oly_anon_id",
        "oly_enc_id",
        "s_kwcid",
        "twclid",
    }
)

BLOCK_ROLES: dict[str, NodeRole] = {
    "h1": NodeRole.HEADING,
    "h2": NodeRole.HEADING,
    "h3": NodeRole.HEADING,
    "h4": NodeRole.HEADING,
    "h5": NodeRole.HEADING,
    "h6": NodeRole.HEADING,
    "p": NodeRole.PARAGRAPH,
    "li": NodeRole.LIST_ITEM,
    "blockquote": NodeRole.QUOTE,
    "pre": NodeRole.PREFORMATTED,
    "dt": NodeRole.PARAGRAPH,
    "dd": NodeRole.PARAGRAPH,
    "figcaption": NodeRole.PARAGRAPH,
    "caption": NodeRole.PARAGRAPH,
    "td": NodeRole.TABLE_CELL,
    "th": NodeRole.TABLE_CELL,
}

# Containers considered when no <main> or <article> says where the content is.
SCORABLE_TAGS = frozenset({"div", "section", "td", "table"})


@dataclass
class _Extraction:
    """Working state while a page is being read."""

    warnings: list[str] = field(default_factory=list)
    removed: dict[str, int] = field(default_factory=dict)

    def removed_one(self, reason: str) -> None:
        self.removed[reason] = self.removed.get(reason, 0) + 1

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)


# ---------------------------------------------------------------- helpers


def _text_of(element: HtmlElement) -> str:
    return normalize(element.text_content())


def _is_hidden(element: HtmlElement) -> bool:
    """Hidden in the page is hidden from comparison.

    Deliberately narrow: only the declarations a browser acts on. Classes such
    as `sr-only` are left alone, because that text is read aloud to people using
    screen readers and is genuinely part of the page.
    """
    if element.get("hidden") is not None:
        return True
    if (element.get("aria-hidden") or "").lower() == "true":
        return True
    style = element.get("style") or ""
    return bool(HIDDEN_STYLE.search(style))


def _dom_path(element: HtmlElement, root: HtmlElement) -> str:
    """A readable path from the region root, e.g. "article > section:nth-of-type(2) > p"."""
    steps: list[str] = []
    current: HtmlElement | None = element
    while current is not None and current is not root:
        parent = current.getparent()
        if parent is None:
            break
        tag = str(current.tag)
        siblings = [child for child in parent if str(child.tag) == tag]
        if len(siblings) > 1:
            steps.append(f"{tag}:nth-of-type({siblings.index(current) + 1})")
        else:
            steps.append(tag)
        current = parent
    root_tag = str(root.tag) if root is not None else "body"
    steps.append(root_tag)
    return " > ".join(reversed(steps))


def strip_tracking(url: str) -> str:
    """Remove campaign and visitor parameters, keeping everything else in order.

    A link is the same link whether or not it carries a campaign tag, so those
    parameters are dropped before comparison. Ordinary parameters are untouched,
    including their order, because they can change what a page shows.
    """
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMETERS
    ]
    query = "&".join(f"{key}={value}" if value != "" else key for key, value in kept)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


# ---------------------------------------------------------------- pass 1: strip


def _strip_unreadable(tree: HtmlElement, state: _Extraction) -> None:
    for element in list(tree.iter()):
        if not isinstance(element.tag, str):
            if element.tag is lxml.etree.Comment:  # type: ignore[attr-defined]
                _drop(element)
                state.removed_one("comment")
            continue
        if element.tag in DROPPED_TAGS:
            if element.tag in VOID_TAGS:
                # Keep whatever the parser wrongly nested inside it.
                element.drop_tag()
            else:
                _drop(element)
            state.removed_one(element.tag)
        elif _is_hidden(element):
            _drop(element)
            state.removed_one("hidden")


def _drop(element: HtmlElement) -> None:
    parent = element.getparent()
    if parent is not None:
        # Text after the element belongs to the parent and must survive.
        tail = element.tail
        parent.remove(element)
        if tail and tail.strip():
            previous = parent[-1] if len(parent) else None
            if previous is not None:
                previous.tail = (previous.tail or "") + tail
            else:
                parent.text = (parent.text or "") + tail


# ---------------------------------------------------------------- pass 2: main region


def _score_region(element: HtmlElement) -> float:
    """How much this container looks like a body of prose.

    Text length rewards substance; link-heavy containers are penalised because
    navigation and related-links boxes are mostly links; paragraph count rewards
    real writing over a wall of markup.
    """
    text_length = len(_text_of(element))
    if text_length == 0:
        return 0.0
    link_length = sum(len(_text_of(link)) for link in element.iter("a"))
    paragraphs = sum(1 for _ in element.iter("p"))
    link_share = link_length / text_length
    return text_length * (1.0 - min(link_share, 1.0)) + paragraphs * 40.0


def choose_main_region(tree: HtmlElement, state: _Extraction) -> tuple[HtmlElement, MainRegionStrategy]:
    """Find the page's content, in the fixed priority order."""
    body = tree.find("body")
    root = body if body is not None else tree

    mains = [e for e in root.iter() if str(e.tag) == "main" or (e.get("role") or "").lower() == "main"]
    if mains:
        if len(mains) > 1:
            state.warn("The page declares more than one main region; the first was used.")
        return mains[0], MainRegionStrategy.MAIN_ELEMENT

    articles = [e for e in root.iter("article")]
    if articles:
        if len(articles) == 1:
            return articles[0], MainRegionStrategy.ARTICLE_ELEMENT
        # Several articles: a listing page. The one with the most substance is
        # the page's subject; ties break by document order, never randomly.
        best = max(articles, key=lambda element: (_score_region(element), -_document_index(element, root)))
        state.warn(f"The page contains {len(articles)} articles; the longest was used.")
        return best, MainRegionStrategy.ARTICLE_ELEMENT

    candidates = [
        element for element in root.iter() if str(element.tag) in SCORABLE_TAGS and len(_text_of(element)) > 0
    ]
    scored = [(element, _score_region(element)) for element in candidates]
    scored = [(element, score) for element, score in scored if score > 0]
    if scored:
        best_score = max(score for _element, score in scored)
        if best_score >= _score_region(root) * 0.6:
            # Prefer the deepest container that still holds the winning score,
            # so the result is the content itself rather than a wrapper of it.
            winners = [element for element, score in scored if score >= best_score * 0.999]
            best = min(winners, key=lambda element: (-_depth(element), _document_index(element, root)))
            return best, MainRegionStrategy.SCORED_REGION

    return root, MainRegionStrategy.BODY_FALLBACK


def _depth(element: HtmlElement) -> int:
    depth = 0
    current = element.getparent()
    while current is not None:
        depth += 1
        current = current.getparent()
    return depth


def _document_index(element: HtmlElement, root: HtmlElement) -> int:
    for index, candidate in enumerate(root.iter()):
        if candidate is element:
            return index
    return 0


# ---------------------------------------------------------------- pass 3: chrome


def _remove_chrome(region: HtmlElement, state: _Extraction) -> None:
    """Remove furniture, with guards against removing the content itself."""
    region_text_length = max(1, len(_text_of(region)))

    for element in list(region.iter()):
        if not isinstance(element.tag, str) or element is region:
            continue
        if element.getparent() is None:
            continue  # already removed with an ancestor

        tag = str(element.tag)
        role = (element.get("role") or "").lower()
        reason: str | None = None

        if tag in CHROME_TAGS:
            reason = tag
        elif role in CHROME_ROLES:
            reason = f"role={role}"
        else:
            token = matches_noise_tokens(element.get("class"), element.get("id"))
            if token:
                reason = f"noise:{token}"

        if reason is None:
            continue

        # Guard: a container holding most of the region's words is the content,
        # whatever its class says.
        share = len(_text_of(element)) / region_text_length
        if share >= CONTENT_SHARE_GUARD:
            state.warn(
                f"Kept a {reason} element because it holds most of the page's text; "
                "it was treated as content."
            )
            continue

        _drop(element)
        state.removed_one(reason)


# ---------------------------------------------------------------- pass 4: nodes


def _heading_level(tag: str) -> int:
    return int(tag[1])


def _header_row(rows: list[HtmlElement]) -> list[HtmlElement] | None:
    """The first row made entirely of header cells, if the table has one."""
    for row in rows:
        cells = [child for child in row if str(child.tag) in ("td", "th")]
        if cells and all(str(child.tag) == "th" for child in cells):
            return cells
    return None


def _cell_position(cell: HtmlElement, tables: list[HtmlElement]) -> TableRef | None:
    """Where a cell sits, described the way a reader would: row and column."""
    row = cell.getparent()
    if row is None or str(row.tag) != "tr":
        return None

    table: HtmlElement | None = row
    while table is not None and str(table.tag) != "table":
        table = table.getparent()
    if table is None:
        return None

    table_index = next((index for index, element in enumerate(tables) if element is table), 0)
    rows = list(table.iter("tr"))
    row_index = rows.index(row) if row in rows else 0
    cells = [child for child in row if str(child.tag) in ("td", "th")]
    column_index = cells.index(cell) if cell in cells else 0

    header_cells = _header_row(rows)
    column_header = None
    if header_cells is not None and cell not in header_cells and column_index < len(header_cells):
        column_header = _text_of(header_cells[column_index]) or None

    # The first cell of a row usually names it ("Enterprise"), which is what
    # makes a changed cell explainable without counting columns.
    row_key = None
    if cells and cells[0] is not cell:
        row_key = _text_of(cells[0]) or None

    return TableRef(
        table_index=table_index,
        row_index=row_index,
        column_index=column_index,
        column_header=column_header,
        row_key=row_key,
        is_header=str(cell.tag) == "th",
    )


def _build_nodes(region: HtmlElement, base_url: str, state: _Extraction) -> tuple[ContentNode, ...]:
    tables = list(region.iter("table"))
    headings: list[tuple[int, str]] = []
    nodes: list[ContentNode] = []

    for element in region.iter():
        if not isinstance(element.tag, str):
            continue
        tag = str(element.tag)
        role = BLOCK_ROLES.get(tag)
        if role is None:
            continue
        text = _text_of(element)
        if not text:
            continue

        # A block nested inside another block (a <p> within an <li>) is already
        # covered by its parent; recording both would double-count the words.
        if any(
            str(ancestor.tag) in BLOCK_ROLES
            for ancestor in element.iterancestors()
            if isinstance(ancestor.tag, str)
        ):
            continue

        node_id = f"n{len(nodes)}"
        level = _heading_level(tag) if role is NodeRole.HEADING else None

        if role is NodeRole.HEADING:
            assert level is not None
            headings = [(lvl, txt) for lvl, txt in headings if lvl < level]
            section_path = tuple(txt for _lvl, txt in headings)
            headings.append((level, text))
        else:
            section_path = tuple(txt for _lvl, txt in headings)

        table_ref = _cell_position(element, tables) if role is NodeRole.TABLE_CELL else None
        if role is NodeRole.TABLE_CELL and table_ref is None:
            continue  # a stray cell outside any table

        nodes.append(
            ContentNode(
                id=node_id,
                role=role,
                level=level,
                path=_dom_path(element, region),
                section_path=section_path,
                text=text,
                tokens=tuple(
                    WebToken(id=f"{node_id}-t{index}", text=word) for index, word in enumerate(text.split())
                ),
                table=table_ref,
            )
        )

    nodes.extend(_link_nodes(region, base_url, len(nodes)))
    return tuple(nodes)


def _link_nodes(region: HtmlElement, base_url: str, start_index: int) -> list[ContentNode]:
    """Links are recorded separately, so a changed destination is visible.

    The link's own text is already part of the paragraph containing it; what a
    paragraph cannot show is where the link points.
    """
    nodes: list[ContentNode] = []
    for link in region.iter("a"):
        href = link.get("href")
        text = _text_of(link)
        if not href or not text:
            continue
        absolute = urljoin(base_url, href.strip())
        if not absolute.lower().startswith(("http://", "https://")):
            continue
        node_id = f"n{start_index + len(nodes)}"
        nodes.append(
            ContentNode(
                id=node_id,
                role=NodeRole.LINK,
                path=_dom_path(link, region),
                text=text,
                tokens=tuple(
                    WebToken(id=f"{node_id}-t{index}", text=word) for index, word in enumerate(text.split())
                ),
                href=strip_tracking(absolute),
            )
        )
    return nodes


# ---------------------------------------------------------------- metadata and shells


def _read_metadata(tree: HtmlElement, base_url: str) -> SnapshotMetadata:
    def meta(name: str, attribute: str = "name") -> str | None:
        for element in tree.iter("meta"):
            if (element.get(attribute) or "").lower() == name:
                content = normalize(element.get("content") or "")
                return content or None
        return None

    title_element = next(iter(tree.iter("title")), None)
    title = normalize(title_element.text_content()) if title_element is not None else None

    canonical = None
    for element in tree.iter("link"):
        if "canonical" in (element.get("rel") or "").lower() and element.get("href"):
            canonical = strip_tracking(urljoin(base_url, element.get("href", "").strip()))
            break

    html_element = tree if str(tree.tag) == "html" else next(iter(tree.iter("html")), None)
    lang = (html_element.get("lang") if html_element is not None else None) or None

    return SnapshotMetadata(
        title=title or None,
        meta_description=meta("description"),
        canonical_url=canonical,
        lang=normalize(lang) if lang else None,
    )


def _detect_render_note(raw_html: str, tree: HtmlElement, word_count: int) -> RenderNote | None:
    """Say plainly when a page is an empty shell rather than comparing nothing."""
    if word_count >= MIN_WORDS_FOR_CONTENT:
        return None

    looks_like_app = any(marker in raw_html for marker in SHELL_MARKERS)
    if not looks_like_app:
        for element in tree.iter():
            if not isinstance(element.tag, str):
                continue
            element_id = (element.get("id") or "").lower()
            if element_id in SHELL_ROOT_IDS and not normalize(element.text_content()):
                looks_like_app = True
                break

    if looks_like_app:
        return RenderNote.NEEDS_JAVASCRIPT
    if word_count == 0:
        return RenderNote.EMPTY_PAGE
    return None


# ---------------------------------------------------------------- entry point


def extract_snapshot(
    html: str | bytes,
    *,
    url: str,
    final_url: str | None = None,
    fetched_at: str = "1970-01-01T00:00:00+00:00",
    http_status: int = 200,
    content_type: str = "text/html",
    charset: str | None = None,
    redirect_chain: tuple[str, ...] = (),
) -> Snapshot:
    """Read a page into a snapshot. Deterministic: same HTML, same result."""
    import lxml.etree  # noqa: F401 - needed for the comment check in _strip_unreadable

    raw = html.decode(charset or "utf-8", errors="replace") if isinstance(html, bytes) else html
    final = final_url or url
    state = _Extraction()

    if not raw.strip():
        nodes: tuple[ContentNode, ...] = ()
        metadata = SnapshotMetadata()
        strategy = MainRegionStrategy.BODY_FALLBACK
        note: RenderNote | None = RenderNote.EMPTY_PAGE
    else:
        try:
            tree = lxml.html.document_fromstring(raw)
        except (lxml.etree.ParserError, ValueError):
            tree = lxml.html.fromstring(f"<html><body>{raw}</body></html>")
            state.warn("The page's markup could not be parsed normally and was repaired.")

        metadata = _read_metadata(tree, final)
        _strip_unreadable(tree, state)
        region, strategy = choose_main_region(tree, state)
        _remove_chrome(region, state)
        nodes = _build_nodes(region, final, state)
        note = _detect_render_note(raw, tree, sum(len(node.tokens) for node in nodes))

    if note is RenderNote.NEEDS_JAVASCRIPT:
        state.warn("This page builds its content in the browser, so its text could not be read.")
    elif note is RenderNote.EMPTY_PAGE:
        state.warn("No readable content was found on this page.")

    return Snapshot(
        source=SnapshotSource(
            url=url,
            final_url=final,
            fetched_at=fetched_at,
            http_status=http_status,
            content_type=content_type,
            charset=charset,
            redirect_chain=redirect_chain,
        ),
        metadata=metadata,
        nodes=nodes,
        extraction=ExtractionInfo(
            extractor=EXTRACTOR_NAME,
            extractor_version=EXTRACTOR_VERSION,
            noise_rules_version=NOISE_RULES_VERSION,
            strategy=strategy,
            warnings=tuple(state.warnings),
            removed_counts=dict(sorted(state.removed.items())),
        ),
        render_note=note,
        content_sha256=content_fingerprint(nodes, metadata, final),
    )

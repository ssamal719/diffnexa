"""Extraction accuracy tests.

Extraction decides what Tool 2 will ever be able to compare, so these tests are
the accuracy contract. Two kinds matter most:

* the noise tests, because reporting a rotating advert as a change to a contract
  would make the product useless, and
* the **false-removal** tests, because silently deleting a paragraph about
  cookie legislation would make it untrustworthy. The second failure is worse:
  noise is visible and annoying, missing content is invisible and wrong.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from diffnexa_engine.model.content import ContentBlock, ContentToken
from diffnexa_engine.web.extract import extract_snapshot, strip_tracking
from diffnexa_engine.web.noise import NOISE_RULES_VERSION, attribute_tokens, matches_noise_tokens
from diffnexa_engine.web.snapshot import MainRegionStrategy, NodeRole, RenderNote

FIXTURES = Path(__file__).parent / "fixtures" / "web"


def snapshot_of(name: str, url: str = "https://example.com/page"):
    return extract_snapshot((FIXTURES / name).read_text(encoding="utf-8"), url=url)


def texts(snapshot) -> list[str]:
    return [node.text for node in snapshot.nodes]


def joined(snapshot) -> str:
    return " ".join(texts(snapshot)).lower()


# ---------------------------------------------------------------- main region


def test_a_page_using_main_uses_it():
    snapshot = snapshot_of("uses-main.html")
    assert snapshot.extraction.strategy is MainRegionStrategy.MAIN_ELEMENT
    assert "50,000" in joined(snapshot)
    assert "home" not in joined(snapshot), "navigation is outside the main region"
    assert "all rights reserved" not in joined(snapshot)


def test_role_main_counts_as_main():
    snapshot = snapshot_of("uses-role-main.html")
    assert snapshot.extraction.strategy is MainRegionStrategy.MAIN_ELEMENT
    assert "24 months" in joined(snapshot)
    assert "footer text" not in joined(snapshot)


def test_a_page_using_article_uses_it():
    snapshot = snapshot_of("uses-article.html")
    assert snapshot.extraction.strategy is MainRegionStrategy.ARTICLE_ELEMENT
    assert "version 4.2" in joined(snapshot)
    assert "other posts" not in joined(snapshot)


def test_the_substantial_article_wins_on_a_listing_page():
    snapshot = snapshot_of("multiple-articles.html")
    assert snapshot.extraction.strategy is MainRegionStrategy.ARTICLE_ELEMENT
    assert "4,200,000" in joined(snapshot)
    assert "brief summary line" not in joined(snapshot)
    assert any("articles" in warning for warning in snapshot.extraction.warnings)


def test_a_page_with_no_landmarks_falls_back_to_scoring():
    snapshot = snapshot_of("scored-region.html")
    assert snapshot.extraction.strategy is MainRegionStrategy.SCORED_REGION
    assert "referenced standard" in joined(snapshot)
    assert "specification overview" in joined(snapshot)


def test_a_plain_page_falls_back_to_the_body():
    snapshot = snapshot_of("body-fallback.html")
    assert snapshot.extraction.strategy is MainRegionStrategy.BODY_FALLBACK
    assert "24 december 2026" in joined(snapshot)


def test_the_strategy_is_always_recorded():
    for name in ("uses-main.html", "uses-article.html", "scored-region.html", "body-fallback.html"):
        assert snapshot_of(name).extraction.strategy in set(MainRegionStrategy)


# ---------------------------------------------------------------- chrome and noise


def test_chrome_is_removed_from_inside_the_content():
    snapshot = snapshot_of("chrome-everywhere.html")
    body = joined(snapshot)
    assert "refunds are issued within 14 days" in body
    assert "sidebar content" not in body
    assert "other policies" not in body
    assert "share" not in body


def test_a_cookie_banner_is_removed_but_the_policy_page_is_not():
    snapshot = snapshot_of("cookie-banner.html")
    body = joined(snapshot)
    assert "personal data is stored for 12 months" in body
    assert "improve your experience" not in body


def test_repeated_navigation_and_footers_do_not_reach_the_content():
    snapshot = snapshot_of("repeated-furniture.html")
    body = joined(snapshot)
    assert "install the package" in body
    assert "support contact" not in body
    assert body.count("docs") == 0


def test_scripts_styles_and_embedded_media_are_removed():
    snapshot = snapshot_of("scripts-and-media.html")
    body = joined(snapshot)
    assert "the measured value is 42 units" in body
    for forbidden in (
        "console.log",
        "should not appear",
        "enable javascript",
        "svg text",
        "diagram title",
        "template content",
        "color:red",
    ):
        assert forbidden not in body, f"{forbidden!r} should have been removed"


def test_hidden_content_is_not_extracted():
    snapshot = snapshot_of("hidden-content.html")
    body = joined(snapshot)
    assert "visible to readers" in body
    assert "must not be extracted" not in body


def test_screen_reader_text_is_kept():
    """sr-only text is read aloud to real people, so it is content, not noise."""
    snapshot = snapshot_of("hidden-content.html")
    assert "screen reader text" in joined(snapshot)


# ---------------------------------------------------------------- false removal


def test_an_article_about_cookies_and_adverts_is_not_removed():
    """The central false-removal case: noise words in legitimate content."""
    snapshot = snapshot_of("legitimate-noise-words.html")
    body = joined(snapshot)
    for phrase in (
        "this cookie policy explains how we use cookies",
        "advertisement partners must follow",
        "a sponsored placement is always labelled",
        "cookie consent must be obtained",
        "newsletter subscribers may opt out",
    ):
        assert phrase in body, f"legitimate content removed: {phrase!r}"
    assert snapshot.node_count >= 6


def test_class_names_that_merely_contain_a_noise_word_are_kept():
    """cookbook is not cookie; advertising-policy-article is an article."""
    snapshot = snapshot_of("tricky-class-names.html")
    body = joined(snapshot)
    assert "cookbook section describes ingredient sourcing" in body
    assert "complete advertising policy" in body
    assert "promotional terms apply" in body


def test_content_inside_a_chrome_classed_wrapper_survives():
    """A container holding the whole page is content, whatever its class says."""
    snapshot = snapshot_of("content-in-promo-wrapper.html")
    body = joined(snapshot)
    assert "75,000 per licence" in body
    assert "existing customers keep their current rate" in body
    assert "volume discounts remain available" in body


def test_the_share_guard_keeps_a_mislabelled_container_inside_the_content():
    """Even when the region is chosen elsewhere, a big chrome-classed block stays."""
    snapshot = snapshot_of("guarded-wrapper.html")
    body = joined(snapshot)
    assert "the renewal terms are set out in full below" in body
    assert "each licence renews automatically" in body
    assert any("holds most of the page's text" in w for w in snapshot.extraction.warnings)


def test_content_after_a_void_element_is_not_lost():
    """HTML parsers mis-nest content after <embed>; removing it must not take the page."""
    snapshot = extract_snapshot(
        "<html><body><main><embed src='x.swf'><p>Payment is due within 30 days.</p></main></body></html>",
        url="https://e.com/",
    )
    assert "Payment is due within 30 days." in " ".join(node.text for node in snapshot.nodes)


@pytest.mark.parametrize(
    "class_name",
    [
        "cookbook",
        "cookie-recipe",
        "advertising-standards-body",
        "promotion",
        "newsletter",
        "adobe",
        "header-image-caption",
        "navigator-notes",
    ],
)
def test_lookalike_class_names_do_not_match_noise_rules(class_name):
    assert matches_noise_tokens(class_name, None) is None


@pytest.mark.parametrize(
    "class_name",
    [
        "cookie-banner",
        "cookieBanner",
        "cookie_banner",
        "navbar",
        "site-footer",
        "related-posts",
        "social-share",
        "ad-slot",
    ],
)
def test_real_chrome_class_names_do_match(class_name):
    assert matches_noise_tokens(class_name, None) is not None


def test_tokens_are_whole_words_and_joined_forms():
    tokens = attribute_tokens("cookie-banner cta")
    assert {"cookie", "banner", "cta", "cookiebanner"} <= tokens
    assert "cookbook" not in tokens


def test_noise_rules_are_versioned():
    assert NOISE_RULES_VERSION
    assert snapshot_of("uses-main.html").extraction.noise_rules_version == NOISE_RULES_VERSION


# ---------------------------------------------------------------- node building


def test_headings_carry_their_level_and_build_a_section_path():
    snapshot = snapshot_of("headings-and-sections.html")
    by_text = {node.text: node for node in snapshot.nodes}

    assert by_text["Employee Handbook"].level == 1
    assert by_text["Carry over"].level == 3
    assert by_text["Annual leave is 25 days."].section_path == ("Employee Handbook", "Leave")
    assert by_text["Up to 5 days may be carried over."].section_path == (
        "Employee Handbook",
        "Leave",
        "Carry over",
    )
    # A sibling h2 replaces the previous one rather than nesting under it.
    assert by_text["Claims must be submitted within 30 days."].section_path == (
        "Employee Handbook",
        "Expenses",
    )


def test_lists_quotes_and_definitions_become_nodes():
    snapshot = snapshot_of("lists-and-quotes.html")
    roles = {node.text: node.role for node in snapshot.nodes}
    assert roles["First requirement item"] is NodeRole.LIST_ITEM
    assert roles["Step one of the process"] is NodeRole.LIST_ITEM
    assert roles["Quality is never an accident."] is NodeRole.QUOTE
    assert roles["preformatted text block"] is NodeRole.PREFORMATTED
    assert "Definition of the term" in roles


def test_every_node_records_where_it_sits():
    snapshot = snapshot_of("headings-and-sections.html")
    for node in snapshot.nodes:
        assert node.path
        assert node.id.startswith("n")
        assert node.tokens
        assert all(token.id.startswith(f"{node.id}-") for token in node.tokens)


def test_nested_blocks_are_not_counted_twice():
    snapshot = extract_snapshot(
        "<html><body><main><li>Outer item <p>inner paragraph</p></li></main></body></html>",
        url="https://example.com/",
    )
    assert len([n for n in snapshot.nodes if n.role is not NodeRole.LINK]) == 1


# ---------------------------------------------------------------- tables


def test_table_cells_record_their_position_and_headers():
    snapshot = snapshot_of("tables.html")
    cells = [node for node in snapshot.nodes if node.role is NodeRole.TABLE_CELL]
    assert cells, "table cells must be extracted"

    price = next(node for node in cells if node.text == "120,000")
    assert price.table is not None
    assert price.table.column_header == "Monthly price"
    assert price.table.row_key == "Enterprise"
    assert price.table.is_header is False

    headers = [node for node in cells if node.table and node.table.is_header]
    assert {node.text for node in headers} == {"Plan", "Monthly price", "Users"}


# ---------------------------------------------------------------- links


def test_links_are_recorded_with_tracking_removed():
    snapshot = snapshot_of("links-and-tracking.html")
    links = {node.text: node.href for node in snapshot.nodes if node.role is NodeRole.LINK}
    assert links["full guide"] == "https://example.com/guide?id=7"
    assert links["local page"] == "https://example.com/local/page"
    assert "email us" not in links, "non-http links are not recorded"
    assert links["a plain link"] == "https://example.com/plain"


@pytest.mark.parametrize(
    "url, expected",
    [
        ("https://e.com/p?utm_source=x&id=3", "https://e.com/p?id=3"),
        ("https://e.com/p?fbclid=abc", "https://e.com/p"),
        ("https://e.com/p?gclid=1&utm_medium=2&page=4", "https://e.com/p?page=4"),
        ("https://e.com/p?id=3", "https://e.com/p?id=3"),
        ("https://e.com/p", "https://e.com/p"),
        ("https://e.com/p?a=1&b=2", "https://e.com/p?a=1&b=2"),
    ],
)
def test_tracking_parameters_are_stripped_deterministically(url, expected):
    assert strip_tracking(url) == expected


def test_ordinary_parameters_keep_their_order():
    assert strip_tracking("https://e.com/p?z=1&a=2&utm_id=9") == "https://e.com/p?z=1&a=2"


# ---------------------------------------------------------------- metadata


def test_page_metadata_is_captured():
    snapshot = snapshot_of("clean-article.html")
    assert snapshot.metadata.title == "Service Agreement 2026"
    assert snapshot.metadata.meta_description == "Standard terms for professional services."
    assert snapshot.metadata.canonical_url == "https://example.com/terms"
    assert snapshot.metadata.lang == "en"


# ---------------------------------------------------------------- difficult pages


def test_malformed_markup_is_still_read():
    snapshot = snapshot_of("malformed.html")
    body = joined(snapshot)
    assert "first paragraph without a closing tag" in body
    assert "nested without closing" in body


def test_an_empty_page_says_so_rather_than_pretending():
    snapshot = snapshot_of("empty.html")
    assert snapshot.render_note is RenderNote.EMPTY_PAGE
    assert snapshot.nodes == ()
    assert snapshot.extraction.warnings


def test_a_javascript_shell_is_reported_not_compared():
    snapshot = snapshot_of("js-shell.html")
    assert snapshot.render_note is RenderNote.NEEDS_JAVASCRIPT
    assert any("browser" in warning for warning in snapshot.extraction.warnings)


def test_a_real_page_is_never_flagged_as_needing_javascript():
    for name in ("clean-article.html", "uses-main.html", "tables.html", "scored-region.html"):
        assert snapshot_of(name).render_note is None


# ---------------------------------------------------------------- shared protocol


def test_content_nodes_satisfy_the_shared_protocol():
    """This is what lets web content reuse the PDF text alignment unchanged."""
    snapshot = snapshot_of("clean-article.html")
    node = snapshot.nodes[0]
    assert isinstance(node, ContentBlock)
    assert isinstance(node.tokens[0], ContentToken)


# ---------------------------------------------------------------- determinism


def test_the_same_html_always_produces_the_same_snapshot():
    for name in sorted(path.name for path in FIXTURES.glob("*.html")):
        first = snapshot_of(name)
        second = snapshot_of(name)
        assert first == second, f"{name} extracted differently on a second run"


def test_only_the_fetch_time_differs_between_two_captures():
    html = (FIXTURES / "clean-article.html").read_text(encoding="utf-8")
    morning = extract_snapshot(html, url="https://example.com/t", fetched_at="2026-01-01T09:00:00+00:00")
    evening = extract_snapshot(html, url="https://example.com/t", fetched_at="2026-06-30T21:45:00+00:00")

    assert morning.source.fetched_at != evening.source.fetched_at
    assert morning.content_sha256 == evening.content_sha256
    assert morning.nodes == evening.nodes
    assert morning.model_dump(exclude={"source": {"fetched_at"}}) == evening.model_dump(
        exclude={"source": {"fetched_at"}}
    )


def test_the_fingerprint_changes_when_the_content_changes():
    base = "<html><body><main><h1>Terms</h1><p>Payment is due within 30 days.</p></main></body></html>"
    changed = base.replace("30 days", "14 days")
    assert (
        extract_snapshot(base, url="https://e.com/").content_sha256
        != extract_snapshot(changed, url="https://e.com/").content_sha256
    )


def test_the_fingerprint_ignores_markup_that_says_nothing():
    plain = "<html><body><main><h1>Terms</h1><p>Payment is due.</p></main></body></html>"
    decorated = (
        "<html><body><main>  <h1 class='x'>Terms</h1>\n\n"
        "<p  data-id='7'>Payment   is due.</p> </main></body></html>"
    )
    assert (
        extract_snapshot(plain, url="https://e.com/").content_sha256
        == extract_snapshot(decorated, url="https://e.com/").content_sha256
    )


def test_extraction_reuses_the_shared_normalisation():
    """Curly quotes and odd spacing are handled the same way as in PDFs."""
    messy = "The \u201cagreement\u201d   runs\u00a0for 30\u2013days."
    snapshot = extract_snapshot(
        f"<html><body><main><p>{messy}</p></main></body></html>",
        url="https://e.com/",
    )
    assert snapshot.nodes[0].text == 'The "agreement" runs for 30-days.'

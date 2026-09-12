"""Which parts of a page are furniture rather than content.

The hard requirement here is that noise detection must be **structural**, never
based on what the text says. An article about cookie legislation, a report
analysing advertising spend, a policy page explaining a newsletter — all contain
the words that appear in this file, and none of them is noise. Removing content
because it mentions "cookie" would be a serious defect, not an over-eager
heuristic.

So every rule below matches on:

* the element's tag (`nav`, `footer`, …),
* its ARIA role, or
* a **whole token** of its `id` or `class` attribute,

and never on its text. Whole-token matching also means `class="cookbook"` does
not match `cookie`, and `class="promotion-policy-article"` does not match
`promo` — the tokens are `promotion`, `policy`, `article`.

Two further safeguards stop a mistaken match from destroying a page:

* nothing containing the main content region is ever removed, and
* nothing holding a large share of the region's text is ever removed, because a
  container with most of the words is the content by definition.

The pattern list is versioned. When it changes, the version changes, so a
snapshot records the rules that produced it.
"""

from __future__ import annotations

import re

NOISE_RULES_VERSION = "2026.09.1"

# Elements that are structurally chrome in HTML's own vocabulary.
CHROME_TAGS = frozenset({"nav", "header", "footer", "aside"})

CHROME_ROLES = frozenset(
    {"navigation", "banner", "contentinfo", "complementary", "search", "menubar", "toolbar", "dialog"}
)

# Elements that never contain readable content, or that could execute.
DROPPED_TAGS = frozenset(
    {
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "canvas",
        "iframe",
        "object",
        "embed",
        "applet",
        "param",
        "map",
        "area",
        "audio",
        "video",
        "source",
        "track",
        "link",
        "meta",
        "base",
        "form",
        "input",
        "button",
        "select",
        "option",
        "textarea",
        "label",
        "datalist",
        "output",
        "progress",
        "meter",
        "dialog",
    }
)

# Elements HTML5 defines as void: they cannot contain anything. The HTML parser
# predates that rule and treats some of them as containers, so content written
# after an <embed> ends up parsed *inside* it. Removing such an element whole
# would silently delete the rest of the page, so these are unwrapped instead:
# the tag goes, anything the parser mis-nested inside it stays.
VOID_TAGS = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)

# Whole tokens of id/class that mark page furniture. Conservative on purpose:
# a term earns its place only if it is overwhelmingly used for chrome.
NOISE_TOKENS = frozenset(
    {
        # consent and cookie banners
        "cookiebanner",
        "cookieconsent",
        "cookienotice",
        "consentbanner",
        "gdprbanner",
        "cookiebar",
        # advertising slots
        "advertisement",
        "advert",
        "adslot",
        "adbanner",
        "adcontainer",
        "adwrapper",
        "sponsored",
        # site furniture
        "navbar",
        "navigation",
        "topnav",
        "mainnav",
        "subnav",
        "sidebar",
        "breadcrumb",
        "breadcrumbs",
        "pagination",
        "skiplink",
        "skipnav",
        "sitefooter",
        "siteheader",
        "masthead",
        # promotional and social widgets
        "newslettersignup",
        "newsletterform",
        "socialshare",
        "sharebuttons",
        "sharethis",
        "relatedposts",
        "relatedarticles",
        "morestories",
        "popularposts",
        "backtotop",
        "modaloverlay",
        "popupoverlay",
        "subscribeprompt",
        "paywall",
    }
)

# Tokens that are only noise when the element is small — a "promo" box beside an
# article is chrome; a page whose whole body carries the class is not.
_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")

# An element holding at least this share of the region's text is content.
CONTENT_SHARE_GUARD = 0.4

HIDDEN_STYLE = re.compile(
    r"(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)", re.IGNORECASE
)


def attribute_tokens(value: str | None) -> set[str]:
    """Whole tokens of a class or id, lower-cased, punctuation removed.

    "cookie-banner cta" gives {"cookie", "banner", "cta", "cookiebanner"}: both
    the separate words and the joined form, so `cookie-banner`, `cookieBanner`
    and `cookie_banner` all match the same rule while `cookbook` matches none.
    """
    if not value:
        return set()
    lowered = value.lower()
    # Split camelCase into words before splitting on punctuation.
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", value)
    tokens = {token for token in _TOKEN_SPLIT.split(spaced.lower()) if token}
    for group in lowered.split():
        joined = "".join(_TOKEN_SPLIT.split(group))
        if joined:
            tokens.add(joined)
    return tokens


def matches_noise_tokens(class_value: str | None, id_value: str | None) -> str | None:
    """The noise token this element matches, or None."""
    tokens = attribute_tokens(class_value) | attribute_tokens(id_value)
    matched = sorted(tokens & NOISE_TOKENS)
    return matched[0] if matched else None

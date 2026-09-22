"""Attaching a competitor signal to changes the comparison engine already found.

This layer adds nothing to the comparison and takes nothing away from it. The
deterministic engine decides what changed; this decides, for each of those
changes, which of nine categories it sits in.

Four rules hold the layer honest:

* **It is never a filter.** Every change the engine found gets exactly one
  signal, and is still in the result whatever its signal. Grouping by signal is
  therefore a partition: the groups add up to the changes, with nothing lost.
* **No signal without a change.** Signals exist only as a property of a change
  the engine proved. There is no way to produce one from the page alone.
* **Unsure means Other.** A change that no rule clearly describes is `OTHER`.
  A guessed category is worse than an honest blank.
* **It says where, not what it means.** "Touches Pricing & Commercial" is a
  statement about location. Whether a competitor's change is significant, a
  threat or an opportunity is a judgement this product has no basis for.

Each signal records the exact text that produced it — a price, a heading, the
words of a link — and that text always comes from the change's own evidence, so
a reader can check it against the page.

Signals are chosen in a fixed order, and the first rule that applies wins:

1. SEO & Metadata      the change is to the page title, description, canonical
                       link or address
2. Calls to Action     the change is to a link whose words ask the visitor to act
3. Links & Destinations  any other link change (links stop here)
4. Pricing & Commercial  a changed value is an amount of money; pricing words are
                       in the changed text or right beside a changed number; or
                       a table cell sits under a price heading
5. Messaging & Positioning  the page's main heading, or the opening text directly
                       beneath it
6. Plans & Packaging /  the nearest section heading (or a changed heading's own
   Product & Features  words, or a table header) names plans or features
7. Product & Features  the changed words themselves announce a feature
8. Content & Sections  any other heading or content in a named section
9. Other               nothing above applies

Kept beside the comparison result rather than inside it, so the `Change`
contract that the other tools depend on is untouched.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from diffnexa_engine.compare.normalize import normalize
from diffnexa_engine.competitor.signals import (
    COMPETITOR_SIGNALS_VERSION,
    FEATURE_HEADINGS,
    FEATURE_PHRASES,
    PLAN_HEADINGS,
    PRICE_HEADERS,
    PRICING_PHRASES,
    SIGNAL_RULES,
    CompetitorSignal,
    SignalBasis,
    cta_phrase,
    find,
    find_money,
    signal_label,
)
from diffnexa_engine.contracts.changes import Change, ChangeCategory, Side
from diffnexa_engine.web.snapshot import ContentNode, NodeRole, Snapshot

# How many words either side of a changed number are read for pricing words.
# Enough for "20% off when billed annually", not so many that a price anywhere
# in a long sentence claims every number in it.
PRICING_WINDOW = 3

# The opening text under the main heading: its first few blocks, before any
# other heading. A page with no sub-headings keeps everything under its main
# heading, and the whole page is not its opening message.
INTRO_BLOCKS = 3


@dataclass(frozen=True)
class ChangeSignal:
    """One change's category, with the evidence that produced it."""

    signal: CompetitorSignal
    basis: SignalBasis
    # Exactly as the page has it, and always found in the change's evidence.
    # Empty only for OTHER, where nothing was recognised.
    matched_text: str = ""

    @property
    def label(self) -> str:
        return signal_label(self.signal)


@dataclass
class CompetitorClassification:
    """Competitor signals for one comparison, recorded alongside its result."""

    signals_version: str = COMPETITOR_SIGNALS_VERSION
    by_change: dict[str, ChangeSignal] = field(default_factory=dict)
    # Changes the engine explained as noise (a ticking clock, a moved block).
    # They keep a signal, but are counted separately from what changed.
    noise: set[str] = field(default_factory=set)

    def signal_for(self, change_id: str) -> ChangeSignal | None:
        return self.by_change.get(change_id)

    def change_ids_for(self, signal: CompetitorSignal, *, include_noise: bool = False) -> list[str]:
        return [
            change_id
            for change_id, found in self.by_change.items()
            if found.signal is signal and (include_noise or change_id not in self.noise)
        ]

    def counts(self) -> dict[CompetitorSignal, int]:
        """Meaningful changes per signal, in the taxonomy's order."""
        return {rules.signal: len(self.change_ids_for(rules.signal)) for rules in SIGNAL_RULES}

    def changed_signals(self) -> tuple[CompetitorSignal, ...]:
        return tuple(signal for signal, count in self.counts().items() if count > 0)


# ---------------------------------------------------------------- page structure


@dataclass(frozen=True)
class _Page:
    """What the classifier needs to know about one capture."""

    snapshot: Snapshot
    nodes: dict[str, ContentNode]
    main_headings: frozenset[str]
    intro_nodes: frozenset[str]
    # Blocks made of nothing but links — a row of buttons — with those links in
    # order. The block's words are exactly its links' words, so a changed word in
    # the block can be traced to the one link it belongs to.
    link_blocks: dict[str, tuple[ContentNode, ...]]


def _read_page(snapshot: Snapshot) -> _Page:
    """The main heading, its opening text and the page's link words.

    The main heading is the page's H1. A page without one is taken to lead with
    its first H2, unless that H2 names plans or features; nothing else is assumed.
    """
    headings = [node for node in snapshot.nodes if node.role is NodeRole.HEADING]
    main = [node for node in headings if node.level == 1]
    if not main:
        # Only the first H2, and only when it is not itself a named section: a
        # page opening with "Integrations" or "Plans" leads with that section,
        # not with a message.
        first = [node for node in headings if node.level == 2][:1]
        main = [node for node in first if _named_section(node.text, SignalBasis.HEADING_TEXT) is None]
    main_texts = frozenset(node.text for node in main)

    intro: list[str] = []
    counted: dict[str, int] = {}
    for node in snapshot.nodes:
        if node.role in (NodeRole.HEADING, NodeRole.LINK):
            continue
        if len(node.section_path) == 1 and node.section_path[0] in main_texts:
            seen = counted.get(node.section_path[0], 0)
            if seen < INTRO_BLOCKS:
                intro.append(node.id)
            counted[node.section_path[0]] = seen + 1

    return _Page(
        snapshot=snapshot,
        nodes=snapshot.node_index(),
        main_headings=main_texts,
        intro_nodes=frozenset(intro),
        link_blocks=_link_blocks(snapshot),
    )


def _link_blocks(snapshot: Snapshot) -> dict[str, tuple[ContentNode, ...]]:
    """Blocks whose whole text is the links inside them, as the DOM records it."""
    index = snapshot.node_index()
    by_path = {node.path: node for node in snapshot.nodes if node.role is not NodeRole.LINK}
    inside: dict[str, list[ContentNode]] = {}
    for link in snapshot.nodes:
        if link.role is not NodeRole.LINK:
            continue
        parts = link.path.split(" > ")
        for depth in range(len(parts) - 1, 0, -1):
            block = by_path.get(" > ".join(parts[:depth]))
            if block is not None:
                inside.setdefault(block.id, []).append(link)
                break

    return {
        block_id: tuple(links)
        for block_id, links in inside.items()
        if normalize(" ".join(link.text for link in links)) == normalize(index[block_id].text)
    }


def _link_holding(
    links: tuple[ContentNode, ...], block: ContentNode, token_ids: tuple[str, ...]
) -> ContentNode | None:
    """Which of a block's links a cited word belongs to, by counting words."""
    if not token_ids:
        return None
    wanted = set(token_ids)
    position = next((index for index, token in enumerate(block.tokens) if token.id in wanted), None)
    if position is None:
        return None
    start = 0
    for link in links:
        length = len(link.text.split())
        if start <= position < start + length:
            return link
        start += length
    return None


@dataclass(frozen=True)
class _Cited:
    """A node a change's evidence points to, with the words the change cites."""

    side: Side
    node: ContentNode
    token_ids: tuple[str, ...]


def _cited_nodes(change: Change, pages: dict[Side, _Page]) -> list[_Cited]:
    cited: list[_Cited] = []
    for evidence in change.evidence:
        page = pages.get(evidence.side)
        if page is None or not evidence.node_id:
            continue
        node = page.nodes.get(evidence.node_id)
        if node is not None:
            cited.append(_Cited(evidence.side, node, evidence.token_ids))
    # The current page first, so a signal quotes the page as it reads now.
    cited.sort(key=lambda item: 0 if item.side is Side.NEW else 1)
    return cited


def _section_context(change: Change, pages: dict[Side, _Page]) -> list[str]:
    """The headings above this change, nearest first, without the main heading.

    The main heading is left out because it sits above everything: a page
    titled "Simple plans for every team" would otherwise put every sentence on
    it in a plans section.
    """
    ordered: list[str] = []
    for evidence in sorted(change.evidence, key=lambda item: 0 if item.side is Side.NEW else 1):
        page = pages.get(evidence.side)
        main = page.main_headings if page else frozenset()
        for heading in reversed(evidence.section_path):
            if heading in main or heading in ordered:
                continue
            ordered.append(heading)
    return ordered


def _values(change: Change) -> list[str]:
    return [value for value in (change.new_value, change.old_value) if value]


def _window(node: ContentNode, token_ids: tuple[str, ...]) -> str | None:
    """The changed words plus a few either side, as they read in the node."""
    if not token_ids:
        return None
    positions = [index for index, token in enumerate(node.tokens) if token.id in set(token_ids)]
    if not positions:
        return None
    start = max(0, min(positions) - PRICING_WINDOW)
    end = min(len(node.tokens), max(positions) + PRICING_WINDOW + 1)
    return " ".join(token.text for token in node.tokens[start:end])


# ---------------------------------------------------------------- the rules


def _cta(change: Change, cited: list[_Cited], pages: dict[Side, _Page]) -> ChangeSignal | None:
    """A call to action is proven by the page's structure: the words are a link.

    Either the change is to a link whose words are a call to action, or it is to
    a block made of nothing but links (a row of buttons, a button in a list
    item) and the changed words belong to such a link. Words that merely read
    like a call to action in a paragraph are not one.
    """
    for item in cited:
        if item.node.role is NodeRole.LINK:
            if cta_phrase(item.node.text):
                return ChangeSignal(CompetitorSignal.CTA, SignalBasis.LINK_TEXT, item.node.text)
            continue

        links = pages[item.side].link_blocks.get(item.node.id)
        if not links:
            continue
        # A word changed inside a row of buttons belongs to one of them, and it
        # is that button's words that decide. A whole row added or removed is a
        # call to action if any button in it is one.
        holder = _link_holding(links, item.node, item.token_ids)
        candidates = (holder,) if holder is not None else links
        for link in candidates:
            if cta_phrase(link.text):
                return ChangeSignal(CompetitorSignal.CTA, SignalBasis.LINK_TEXT, link.text)
    return None


def _pricing(change: Change, cited: list[_Cited]) -> ChangeSignal | None:
    for value in _values(change):
        money = find_money(value)
        if money:
            return ChangeSignal(CompetitorSignal.PRICING, SignalBasis.MONEY_VALUE, money)

    for value in _values(change):
        phrase = find(PRICING_PHRASES, value)
        if phrase:
            return ChangeSignal(CompetitorSignal.PRICING, SignalBasis.PRICING_WORDING, phrase)

    # "14-day" becoming "30-day" is a trial length only because of the word
    # "trial" right after it, so the words beside a change are read too.
    for item in cited:
        window = _window(item.node, item.token_ids)
        phrase = find(PRICING_PHRASES, window)
        if phrase:
            return ChangeSignal(CompetitorSignal.PRICING, SignalBasis.PRICING_WORDING, phrase)

    for item in cited:
        table = item.node.table
        if table is None:
            continue
        for header in (table.column_header, table.row_key):
            if header and find(PRICE_HEADERS, header):
                return ChangeSignal(CompetitorSignal.PRICING, SignalBasis.PRICE_COLUMN, header)
    return None


def _messaging(cited: list[_Cited], pages: dict[Side, _Page]) -> ChangeSignal | None:
    for item in cited:
        page = pages[item.side]
        if item.node.role is NodeRole.HEADING and item.node.text in page.main_headings:
            return ChangeSignal(CompetitorSignal.MESSAGING, SignalBasis.MAIN_HEADING, item.node.text)
    for item in cited:
        if item.node.id in pages[item.side].intro_nodes:
            return ChangeSignal(CompetitorSignal.MESSAGING, SignalBasis.INTRO, item.node.section_path[0])
    return None


def _named_section(heading: str, basis: SignalBasis) -> ChangeSignal | None:
    """Plans or features, from one heading's own words.

    A heading naming both — "Compare plans and features" — introduces what each
    plan includes, so plans wins. That is a fixed rule, stated here, not a
    judgement made per page.
    """
    if find(PLAN_HEADINGS, heading):
        return ChangeSignal(CompetitorSignal.PLANS, basis, heading)
    if find(FEATURE_HEADINGS, heading):
        return ChangeSignal(CompetitorSignal.FEATURES, basis, heading)
    return None


def _plans_or_features(change: Change, cited: list[_Cited], context: list[str]) -> ChangeSignal | None:
    # A changed heading is judged first by its own words: "Enterprise plan"
    # being added is a plan being added, wherever it sits.
    for item in cited:
        if item.node.role is NodeRole.HEADING:
            found = _named_section(item.node.text, SignalBasis.HEADING_TEXT)
            if found:
                return found

    # A table names its plans in its headers: a column called "Pro plan".
    for item in cited:
        table = item.node.table
        if table is None:
            continue
        for header in (table.column_header, table.row_key):
            if header and find(PLAN_HEADINGS, header):
                return ChangeSignal(CompetitorSignal.PLANS, SignalBasis.TABLE_HEADER, header)

    # Otherwise the nearest heading that names either decides.
    for heading in context:
        found = _named_section(heading, SignalBasis.SECTION_HEADING)
        if found:
            return found

    for value in _values(change):
        phrase = find(FEATURE_PHRASES, value)
        if phrase:
            return ChangeSignal(CompetitorSignal.FEATURES, SignalBasis.CHANGED_WORDING, phrase)
    return None


def _content(change: Change, cited: list[_Cited], pages: dict[Side, _Page]) -> ChangeSignal | None:
    for item in cited:
        if item.node.role is NodeRole.HEADING:
            return ChangeSignal(CompetitorSignal.CONTENT, SignalBasis.HEADING_TEXT, item.node.text)
    for evidence in change.evidence:
        if evidence.section_path:
            return ChangeSignal(CompetitorSignal.CONTENT, SignalBasis.SECTION, evidence.section_path[-1])
    return None


def classify_change(change: Change, snapshots: dict[Side, Snapshot] | None = None) -> ChangeSignal:
    """The one signal this change touches. Always returns one; `OTHER` when unsure."""
    pages = {side: _read_page(snapshot) for side, snapshot in (snapshots or {}).items()}
    return _classify(change, pages)


def _classify(change: Change, pages: dict[Side, _Page]) -> ChangeSignal:
    if change.category is ChangeCategory.METADATA:
        return ChangeSignal(CompetitorSignal.SEO, SignalBasis.METADATA_FIELD, change.label or "")

    cited = _cited_nodes(change, pages)

    if change.category is ChangeCategory.LINK:
        cta = _cta(change, cited, pages)
        if cta:
            return cta
        link_text = next((item.node.text for item in cited if item.node.role is NodeRole.LINK), "")
        return ChangeSignal(CompetitorSignal.LINKS, SignalBasis.LINK, link_text)

    for rule in (
        lambda: _cta(change, cited, pages),
        lambda: _pricing(change, cited),
        lambda: _messaging(cited, pages),
        lambda: _plans_or_features(change, cited, _section_context(change, pages)),
        lambda: _content(change, cited, pages),
    ):
        found = rule()
        if found is not None:
            return found

    return ChangeSignal(CompetitorSignal.OTHER, SignalBasis.NONE, "")


def classify_changes(
    changes: Sequence[Change] | Iterable[Change],
    current_snapshot: Snapshot | None = None,
    baseline_snapshot: Snapshot | None = None,
) -> CompetitorClassification:
    """Give every change its signal. The changes themselves are not touched."""
    pages: dict[Side, _Page] = {}
    if baseline_snapshot is not None:
        pages[Side.OLD] = _read_page(baseline_snapshot)
    if current_snapshot is not None:
        pages[Side.NEW] = _read_page(current_snapshot)

    classification = CompetitorClassification()
    for change in changes:
        classification.by_change[change.id] = _classify(change, pages)
        if change.noise_reason is not None:
            classification.noise.add(change.id)
    return classification


def describe_signal_for_reader(signal: ChangeSignal) -> str:
    """Neutral wording for the interface: where the change sits, nothing more."""
    return f"Touches {signal.label}"


def describe_reason(signal: ChangeSignal) -> str:
    """Why this signal was chosen, in terms a reader can check against the page."""
    text = signal.matched_text
    return {
        SignalBasis.METADATA_FIELD: f"the change is to the {(text[:1].lower() + text[1:]) or 'page details'}",
        SignalBasis.LINK_TEXT: f"the link “{text}” asks the visitor to act",
        SignalBasis.MONEY_VALUE: f"“{text}” is an amount of money",
        SignalBasis.PRICING_WORDING: f"the wording includes “{text}”",
        SignalBasis.PRICE_COLUMN: f"the table column or row is headed “{text}”",
        SignalBasis.MAIN_HEADING: "this is the page's main heading",
        SignalBasis.INTRO: f"this is the opening text under the main heading “{text}”",
        SignalBasis.HEADING_TEXT: f"the heading reads “{text}”",
        SignalBasis.SECTION_HEADING: f"it sits in the section “{text}”",
        SignalBasis.TABLE_HEADER: f"the table column or row is headed “{text}”",
        SignalBasis.CHANGED_WORDING: f"the changed wording includes “{text}”",
        SignalBasis.LINK: f"the link “{text}” changed" if text else "a link changed",
        SignalBasis.SECTION: f"it sits in the section “{text}”",
        SignalBasis.NONE: "no category clearly describes this change",
    }[signal.basis]


__all__ = [
    "ChangeSignal",
    "CompetitorClassification",
    "classify_change",
    "classify_changes",
    "describe_reason",
    "describe_signal_for_reader",
]

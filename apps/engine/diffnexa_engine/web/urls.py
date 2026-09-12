"""Deciding whether a URL is safe for this server to fetch.

A user gives us an address and our server connects to it. That is the shape of a
server-side request forgery attack: the address can be chosen to reach things
only our server can see — a cloud provider's metadata endpoint, a database on a
private network, a service on localhost.

Nothing here trusts the URL's appearance. A hostname is only as safe as the
addresses it resolves to, so the rules below are applied twice: to the URL's
literal form, and again to every IP address DNS returns for it.

The defence is deliberately a deny-list of address ranges rather than an
allow-list of sites, because the product's purpose is fetching arbitrary public
pages. Everything not publicly routable is refused.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass, field
from enum import StrEnum
from urllib.parse import urlsplit

ALLOWED_SCHEMES = frozenset({"http", "https"})
ALLOWED_PORTS = frozenset({80, 443})
MAX_HOSTNAME_LENGTH = 253

# Hostnames that never refer to anything public, whatever DNS says.
BLOCKED_HOSTNAMES = frozenset({"localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"})
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".onion")

# Ranges Python's own classifiers miss or classify inconsistently, so they are
# named explicitly rather than relied upon indirectly.
EXTRA_BLOCKED_NETWORKS = tuple(
    ipaddress.ip_network(cidr)
    for cidr in (
        "0.0.0.0/8",  # "this network"
        "100.64.0.0/10",  # carrier-grade NAT — NOT flagged private by ipaddress
        "192.0.0.0/24",  # IETF protocol assignments
        "192.0.2.0/24",  # TEST-NET-1
        "198.18.0.0/15",  # benchmarking
        "198.51.100.0/24",  # TEST-NET-2
        "203.0.113.0/24",  # TEST-NET-3
        "240.0.0.0/4",  # reserved
        "255.255.255.255/32",  # broadcast
        "2001:db8::/32",  # documentation
        "64:ff9b::/96",  # NAT64 — can be used to reach IPv4 private space
        "2002::/16",  # 6to4
        "2001::/32",  # Teredo
    )
)


class UrlRejection(StrEnum):
    MALFORMED = "malformed_url"
    SCHEME_NOT_ALLOWED = "scheme_not_allowed"
    CREDENTIALS_IN_URL = "credentials_in_url"
    PORT_NOT_ALLOWED = "port_not_allowed"
    HOSTNAME_NOT_ALLOWED = "hostname_not_allowed"
    DNS_FAILED = "dns_failed"
    PRIVATE_ADDRESS = "private_address"


class UnsafeUrl(Exception):
    """A URL this server must not fetch. `reason` is safe to map to a message."""

    def __init__(self, reason: UrlRejection, detail: str = "") -> None:
        self.reason = reason
        self.detail = detail  # internal logging only
        super().__init__(f"{reason.value}: {detail}" if detail else reason.value)


@dataclass(frozen=True)
class FetchPolicy:
    """Limits applied to every fetch.

    `allow_private_addresses` exists so the test suite can talk to a stub server
    on localhost without reaching the public internet. It must never be enabled
    in a deployed service: it disables the entire address defence. The default
    is False and a test asserts that.
    """

    connect_timeout_s: float = 10.0
    total_timeout_s: float = 20.0
    max_response_bytes: int = 5 * 1024 * 1024
    max_redirects: int = 3
    respect_robots: bool = True
    allow_private_addresses: bool = False
    # Production allows only the standard web ports. Tests widen this to reach a
    # stub server on an ephemeral port; a test asserts the default is 80 and 443.
    allowed_ports: frozenset[int] = field(default_factory=lambda: frozenset(ALLOWED_PORTS))
    user_agent: str = "DiffNexaBot/1.0 (+https://diffnexa.com/bot)"
    allowed_content_types: frozenset[str] = field(
        default_factory=lambda: frozenset({"text/html", "application/xhtml+xml"})
    )


@dataclass(frozen=True)
class ResolvedTarget:
    """A URL that passed every check, with the address we will connect to."""

    url: str
    scheme: str
    hostname: str  # used for the Host header and TLS, never for routing
    port: int
    ip: str  # pinned: the connection goes here and nowhere else
    family: int


def address_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    """Why this address must not be contacted, or None if it is publicly routable."""
    # An IPv4 address wrapped in IPv6 form is still that IPv4 address.
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return address_is_blocked(mapped) or "ipv4-mapped address"

    if ip.is_loopback:
        return "loopback address"
    if ip.is_link_local:
        return "link-local address (this is how cloud metadata endpoints are reached)"
    if ip.is_private:
        return "private address"
    if ip.is_reserved:
        return "reserved address"
    if ip.is_multicast:
        return "multicast address"
    if ip.is_unspecified:
        return "unspecified address"
    for network in EXTRA_BLOCKED_NETWORKS:
        if ip.version == network.version and ip in network:
            return f"address in reserved range {network}"
    return None


def never_allowed(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Addresses no configuration may permit, not even in tests.

    `allow_private_addresses` lets the test suite reach a stub server on
    loopback. Link-local is deliberately excluded from that relaxation: it is
    where cloud metadata services live, so there is no legitimate reason for any
    configuration of this product to contact it, and leaving it reachable would
    make the test switch a genuine hole rather than a convenience.
    """
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return never_allowed(mapped)
    return bool(ip.is_link_local or ip.is_multicast)


def refuse_address(ip: ipaddress.IPv4Address | ipaddress.IPv6Address, policy: FetchPolicy) -> str | None:
    """The reason to refuse this address under this policy, or None to allow."""
    blocked = address_is_blocked(ip)
    if blocked is None:
        return None
    if policy.allow_private_addresses and not never_allowed(ip):
        return None
    return blocked


def _normalise_hostname(hostname: str) -> str:
    """Lower-case and punycode-encode, so lookalike forms cannot slip through."""
    cleaned = hostname.strip().rstrip(".").lower()
    if not cleaned or len(cleaned) > MAX_HOSTNAME_LENGTH:
        raise UnsafeUrl(UrlRejection.HOSTNAME_NOT_ALLOWED, "empty or oversized hostname")
    try:
        return cleaned.encode("idna").decode("ascii") if not cleaned.isascii() else cleaned
    except UnicodeError as exc:
        raise UnsafeUrl(UrlRejection.HOSTNAME_NOT_ALLOWED, f"invalid international name: {exc}")


def check_hostname(hostname: str) -> None:
    """Refuse names that cannot refer to a public site, before any DNS lookup."""
    if hostname in BLOCKED_HOSTNAMES or hostname.endswith(BLOCKED_SUFFIXES):
        raise UnsafeUrl(UrlRejection.HOSTNAME_NOT_ALLOWED, "local or internal hostname")
    if "." not in hostname:
        # A bare name resolves through internal search domains on many networks.
        raise UnsafeUrl(UrlRejection.HOSTNAME_NOT_ALLOWED, "hostname has no public domain")


def validate_url(url: str, policy: FetchPolicy) -> tuple[str, str, int]:
    """Check a URL's form. Returns (scheme, hostname, port). No DNS yet."""
    if not url or len(url) > 2048:
        raise UnsafeUrl(UrlRejection.MALFORMED, "empty or oversized URL")
    try:
        parts = urlsplit(url.strip())
    except ValueError as exc:
        raise UnsafeUrl(UrlRejection.MALFORMED, str(exc))

    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise UnsafeUrl(UrlRejection.SCHEME_NOT_ALLOWED, f"scheme {scheme!r}")
    if parts.username is not None or parts.password is not None:
        # Credentials in a URL are a classic way to disguise the real host.
        raise UnsafeUrl(UrlRejection.CREDENTIALS_IN_URL, "URL contains credentials")
    if not parts.hostname:
        raise UnsafeUrl(UrlRejection.MALFORMED, "no hostname")

    try:
        port = parts.port
    except ValueError as exc:
        raise UnsafeUrl(UrlRejection.PORT_NOT_ALLOWED, str(exc))
    port = port if port is not None else (443 if scheme == "https" else 80)
    if port not in policy.allowed_ports:
        raise UnsafeUrl(UrlRejection.PORT_NOT_ALLOWED, f"port {port}")

    hostname = _normalise_hostname(parts.hostname)

    # An address written directly in the URL is checked immediately.
    try:
        literal = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        if not policy.allow_private_addresses:
            check_hostname(hostname)
        return scheme, hostname, port

    blocked = refuse_address(literal, policy)
    if blocked:
        raise UnsafeUrl(UrlRejection.PRIVATE_ADDRESS, blocked)
    return scheme, hostname, port


def resolve_safely(url: str, policy: FetchPolicy) -> ResolvedTarget:
    """Validate a URL and resolve it to one address that is safe to connect to.

    Every address DNS returns is checked, not just the one we pick. A name that
    resolves to both a public and a private address is refused outright: that
    pattern is how DNS rebinding attacks begin.

    The returned address is then used for the connection itself, so a second
    lookup cannot redirect us somewhere else between the check and the connect.
    """
    scheme, hostname, port = validate_url(url, policy)

    try:
        infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise UnsafeUrl(UrlRejection.DNS_FAILED, f"{hostname}: {exc}")
    if not infos:
        raise UnsafeUrl(UrlRejection.DNS_FAILED, f"{hostname}: no addresses")

    chosen: tuple[int, str] | None = None
    for family, _type, _proto, _canon, sockaddr in infos:
        raw = sockaddr[0]
        try:
            address = ipaddress.ip_address(raw)
        except ValueError:
            raise UnsafeUrl(UrlRejection.DNS_FAILED, f"unreadable address {raw!r}")

        blocked = refuse_address(address, policy)
        if blocked:
            # Refuse the whole name, not just this record.
            raise UnsafeUrl(UrlRejection.PRIVATE_ADDRESS, f"{hostname} resolves to a {blocked}")
        if chosen is None:
            chosen = (family, raw)

    assert chosen is not None
    family, ip = chosen
    return ResolvedTarget(url=url, scheme=scheme, hostname=hostname, port=port, ip=ip, family=family)

"""The hostile-URL suite.

This is the most important test file in the engine. It exists because W2's
entire job is making our server fetch an address a stranger chose, and getting
that wrong means a stranger reads our cloud credentials.

Every test here runs offline. Nothing in this file contacts the public internet:
refusals happen before any socket is opened, and everything else talks to a stub
server on 127.0.0.1.
"""

from __future__ import annotations

import ipaddress
import socket
from unittest.mock import patch

import pytest

from diffnexa_engine.web import robots
from diffnexa_engine.web.fetcher import FetchError, FetchFailure, fetch
from diffnexa_engine.web.urls import (
    ALLOWED_PORTS,
    FetchPolicy,
    UnsafeUrl,
    UrlRejection,
    address_is_blocked,
    resolve_safely,
    validate_url,
)

from .helpers.stub_server import StubServer

STRICT = FetchPolicy(respect_robots=False)


@pytest.fixture
def server():
    robots.clear_cache()
    stub = StubServer()
    try:
        yield stub
    finally:
        stub.stop()
        robots.clear_cache()


def local_policy(stub: StubServer, **overrides) -> FetchPolicy:
    """A policy that can reach the stub, and only the stub."""
    settings = {
        "allow_private_addresses": True,
        "allowed_ports": frozenset({stub.port}),
        "respect_robots": False,
    }
    settings.update(overrides)
    return FetchPolicy(**settings)


# ---------------------------------------------------------------- the defaults


def test_production_defaults_are_the_safe_ones():
    """The escape hatches tests need must never be on by default."""
    policy = FetchPolicy()
    assert policy.allow_private_addresses is False
    assert policy.allowed_ports == frozenset({80, 443}) == ALLOWED_PORTS
    assert policy.respect_robots is True
    assert policy.max_redirects == 3
    assert policy.max_response_bytes == 5 * 1024 * 1024
    assert policy.connect_timeout_s == 10.0
    assert policy.total_timeout_s == 20.0
    assert policy.allowed_content_types == frozenset({"text/html", "application/xhtml+xml"})
    assert "DiffNexaBot" in policy.user_agent


# ---------------------------------------------------------------- schemes and form


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "file://localhost/etc/shadow",
        "ftp://example.com/secret",
        "gopher://example.com:70/",
        "data:text/html,<h1>hi</h1>",
        "javascript:alert(1)",
        "ssh://example.com/",
        "dict://example.com:11211/",
        "//example.com/protocol-relative",
        "not a url at all",
        "",
    ],
)
def test_only_http_and_https_are_accepted(url):
    with pytest.raises(UnsafeUrl) as info:
        validate_url(url, STRICT)
    assert info.value.reason in {UrlRejection.SCHEME_NOT_ALLOWED, UrlRejection.MALFORMED}


@pytest.mark.parametrize(
    "url",
    [
        "http://user:pass@example.com/",
        "https://admin@internal.example.com/",
        "http://user:@example.com/",
    ],
)
def test_credentials_in_a_url_are_refused(url):
    with pytest.raises(UnsafeUrl) as info:
        validate_url(url, STRICT)
    assert info.value.reason is UrlRejection.CREDENTIALS_IN_URL


@pytest.mark.parametrize("port", [22, 25, 3306, 5432, 6379, 8080, 9200, 11211, 27017])
def test_only_the_standard_web_ports_are_allowed(port):
    with pytest.raises(UnsafeUrl) as info:
        validate_url(f"http://example.com:{port}/", STRICT)
    assert info.value.reason is UrlRejection.PORT_NOT_ALLOWED


def test_the_standard_ports_are_accepted():
    assert validate_url("http://example.com/", STRICT) == ("http", "example.com", 80)
    assert validate_url("https://example.com/", STRICT) == ("https", "example.com", 443)
    assert validate_url("https://example.com:443/x", STRICT)[2] == 443


def test_a_malformed_port_is_refused():
    with pytest.raises(UnsafeUrl):
        validate_url("http://example.com:notaport/", STRICT)


# ---------------------------------------------------------------- addresses


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://127.0.0.1:80/admin",
        "http://[::1]/",
        "http://10.0.0.1/",
        "http://10.255.255.254/",
        "http://172.16.0.1/",
        "http://172.31.255.1/",
        "http://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "http://[fd00::1]/",  # unique local IPv6
        "http://[fe80::1]/",  # link-local IPv6
        "http://[::ffff:10.0.0.1]/",  # IPv4 private wrapped in IPv6
        "http://[::]/",
        "http://0.0.0.0/",
        "http://0.1.2.3/",
        "http://100.64.1.1/",  # carrier-grade NAT
        "http://192.0.2.5/",
        "http://[2001:db8::1]/",
        "http://[64:ff9b::a00:1]/",  # NAT64 wrapping a private IPv4
        "http://255.255.255.255/",
        "http://224.0.0.1/",  # multicast
    ],
)
def test_addresses_that_are_not_publicly_routable_are_refused(url):
    with pytest.raises(UnsafeUrl) as info:
        validate_url(url, STRICT)
    assert info.value.reason is UrlRejection.PRIVATE_ADDRESS


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/",
        "http://localhost.localdomain/",
        "http://metadata.google.internal/",
        "http://printer.local/",
        "http://wiki.intranet/",
        "http://db.lan/",
        "http://something.home.arpa/",
        "http://service/",  # bare name: resolves through internal search domains
    ],
)
def test_local_and_internal_hostnames_are_refused(url):
    with pytest.raises(UnsafeUrl) as info:
        validate_url(url, STRICT)
    assert info.value.reason is UrlRejection.HOSTNAME_NOT_ALLOWED


def test_a_public_address_is_allowed():
    assert address_is_blocked(ipaddress.ip_address("93.184.216.34")) is None
    assert address_is_blocked(ipaddress.ip_address("2606:2800:220:1:248:1893:25c8:1946")) is None


def test_every_blocked_range_gives_a_reason():
    for address in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1"]:
        reason = address_is_blocked(ipaddress.ip_address(address))
        assert reason and isinstance(reason, str)


# ---------------------------------------------------------------- DNS


def _fake_getaddrinfo(*addresses: str):
    """Stand in for DNS so no lookup leaves this machine."""

    def resolver(host, port, *args, **kwargs):
        results = []
        for raw in addresses:
            parsed = ipaddress.ip_address(raw)
            family = socket.AF_INET6 if parsed.version == 6 else socket.AF_INET
            sockaddr = (raw, port, 0, 0) if parsed.version == 6 else (raw, port)
            results.append((family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr))
        return results

    return resolver


def test_a_hostname_resolving_to_a_private_address_is_refused():
    """The name looks public; DNS is where the attack lands."""
    with patch("socket.getaddrinfo", _fake_getaddrinfo("10.0.0.5")):
        with pytest.raises(UnsafeUrl) as info:
            resolve_safely("http://totally-public.example.com/", STRICT)
    assert info.value.reason is UrlRejection.PRIVATE_ADDRESS


def test_a_hostname_resolving_to_the_metadata_address_is_refused():
    with patch("socket.getaddrinfo", _fake_getaddrinfo("169.254.169.254")):
        with pytest.raises(UnsafeUrl):
            resolve_safely("http://harmless.example.com/", STRICT)


def test_every_returned_address_is_checked_not_only_the_first():
    """One public answer must not launder a private one alongside it."""
    with patch("socket.getaddrinfo", _fake_getaddrinfo("93.184.216.34", "10.0.0.5")):
        with pytest.raises(UnsafeUrl) as info:
            resolve_safely("http://mixed.example.com/", STRICT)
    assert info.value.reason is UrlRejection.PRIVATE_ADDRESS


def test_a_private_ipv6_answer_is_refused():
    with patch("socket.getaddrinfo", _fake_getaddrinfo("fd00::1")):
        with pytest.raises(UnsafeUrl):
            resolve_safely("http://sneaky.example.com/", STRICT)


def test_a_failed_lookup_is_reported_as_such():
    def boom(*args, **kwargs):
        raise socket.gaierror("name or service not known")

    with patch("socket.getaddrinfo", boom):
        with pytest.raises(UnsafeUrl) as info:
            resolve_safely("http://nonexistent.example.com/", STRICT)
    assert info.value.reason is UrlRejection.DNS_FAILED


def test_the_checked_address_is_the_one_pinned_for_the_connection():
    """This is what closes DNS rebinding: we connect to what we validated."""
    with patch("socket.getaddrinfo", _fake_getaddrinfo("93.184.216.34")):
        target = resolve_safely("http://example.com/page", STRICT)
    assert target.ip == "93.184.216.34"
    assert target.hostname == "example.com"  # kept for Host and TLS, not for routing
    assert target.port == 80


# ---------------------------------------------------------------- real fetches


def test_a_normal_page_is_fetched(server):
    page = fetch(server.url("/"), local_policy(server))
    assert page.status == 200
    assert b"Terms of service" in page.body
    assert page.content_type == "text/html"
    assert page.redirect_chain == ()
    assert page.elapsed_ms >= 0
    assert page.fetched_at.endswith("+00:00")


def test_a_gzipped_page_is_decoded(server):
    page = fetch(server.url("/gzip"), local_policy(server))
    assert b"Terms of service" in page.body


def test_the_crawler_identifies_itself(server):
    fetch(server.url("/"), local_policy(server))
    # The stub records paths; the header check is on the policy the fetcher sends.
    assert "DiffNexaBot" in local_policy(server).user_agent


# ---------------------------------------------------------------- redirects


def test_redirects_are_followed_up_to_the_limit(server):
    page = fetch(server.url("/redirect-chain/3"), local_policy(server))
    assert page.status == 200
    assert len(page.redirect_chain) == 3
    assert page.final_url.endswith("/")


def test_too_many_redirects_are_refused(server):
    with pytest.raises(FetchError) as info:
        fetch(server.url("/redirect-chain/8"), local_policy(server))
    assert info.value.reason is FetchFailure.TOO_MANY_REDIRECTS


def test_a_redirect_loop_terminates(server):
    with pytest.raises(FetchError) as info:
        fetch(server.url("/redirect-loop"), local_policy(server))
    assert info.value.reason is FetchFailure.TOO_MANY_REDIRECTS


def test_a_redirect_to_the_metadata_address_is_refused(server):
    """A reachable page sending us to the metadata endpoint is the classic attack.

    The first hop succeeds here, so this proves the second hop was validated
    rather than the request being refused before it started. The metadata range
    stays blocked even though this policy permits loopback.
    """
    with pytest.raises(UnsafeUrl) as info:
        fetch(
            server.url("/redirect-to-private"),
            local_policy(server, allowed_ports=frozenset({server.port, 80})),
        )
    assert info.value.reason is UrlRejection.PRIVATE_ADDRESS


def test_a_redirect_to_a_blocked_port_is_refused(server):
    """Every rule is re-applied on a redirect, not only the address rules."""
    with pytest.raises(UnsafeUrl) as info:
        fetch(server.url("/redirect-blocked-port"), local_policy(server))
    assert info.value.reason is UrlRejection.PORT_NOT_ALLOWED


def test_the_test_switch_never_opens_the_metadata_range():
    """allow_private_addresses is a convenience for tests, not a way in."""
    relaxed = FetchPolicy(allow_private_addresses=True, respect_robots=False)
    for url in ["http://169.254.169.254/", "http://[fe80::1]/", "http://224.0.0.1/"]:
        with pytest.raises(UnsafeUrl):
            validate_url(url, relaxed)
    # Loopback, which the stub server needs, is permitted by that same switch.
    assert validate_url("http://127.0.0.1/", relaxed)[1] == "127.0.0.1"


def test_a_redirect_to_another_scheme_is_refused(server):
    with pytest.raises(UnsafeUrl) as info:
        fetch(server.url("/redirect-to-file"), local_policy(server))
    assert info.value.reason is UrlRejection.SCHEME_NOT_ALLOWED


def test_a_redirect_without_a_destination_is_refused(server):
    with pytest.raises(FetchError) as info:
        fetch(server.url("/redirect-no-location"), local_policy(server))
    assert info.value.reason is FetchFailure.REDIRECT_INVALID


# ---------------------------------------------------------------- size and time


def test_an_oversized_declared_response_is_refused_before_reading(server):
    with pytest.raises(FetchError) as info:
        fetch(server.url("/huge"), local_policy(server, max_response_bytes=1024 * 1024))
    assert info.value.reason is FetchFailure.TOO_LARGE


def test_an_oversized_streamed_response_is_cut_off(server):
    """No Content-Length to check, so only reading in chunks catches it."""
    with pytest.raises(FetchError) as info:
        fetch(server.url("/huge-undeclared"), local_policy(server, max_response_bytes=512 * 1024))
    assert info.value.reason is FetchFailure.TOO_LARGE


def test_a_gzip_bomb_is_stopped_while_decompressing(server):
    """A few kilobytes on the wire that expand to 50 MB."""
    with pytest.raises(FetchError) as info:
        fetch(server.url("/bomb"), local_policy(server, max_response_bytes=1024 * 1024))
    assert info.value.reason is FetchFailure.TOO_LARGE


def test_a_deflate_bomb_is_stopped_too(server):
    with pytest.raises(FetchError) as info:
        fetch(server.url("/deflate-bomb"), local_policy(server, max_response_bytes=1024 * 1024))
    assert info.value.reason is FetchFailure.TOO_LARGE


def test_a_slow_response_hits_the_deadline(server):
    with pytest.raises(FetchError) as info:
        fetch(server.url("/slow"), local_policy(server, total_timeout_s=1.5))
    assert info.value.reason is FetchFailure.TIMEOUT


# ---------------------------------------------------------------- content types


@pytest.mark.parametrize("path", ["/plain", "/pdf", "/no-type"])
def test_only_html_content_types_are_accepted(server, path):
    with pytest.raises(FetchError) as info:
        fetch(server.url(path), local_policy(server))
    assert info.value.reason is FetchFailure.NOT_HTML


def test_an_error_status_is_reported(server):
    for path in ("/missing", "/error"):
        with pytest.raises(FetchError) as info:
            fetch(server.url(path), local_policy(server))
        assert info.value.reason is FetchFailure.BAD_STATUS


# ---------------------------------------------------------------- robots.txt


def test_robots_disallow_is_respected(server):
    server.robots_body = b"User-agent: *\nDisallow: /blocked\n"
    with pytest.raises(FetchError) as info:
        fetch(server.url("/blocked"), local_policy(server, respect_robots=True))
    assert info.value.reason is FetchFailure.BLOCKED_BY_ROBOTS


def test_robots_allow_permits_the_fetch(server):
    server.robots_body = b"User-agent: *\nDisallow: /private\n"
    page = fetch(server.url("/"), local_policy(server, respect_robots=True))
    assert page.status == 200


def test_a_rule_aimed_at_our_bot_is_respected(server):
    server.robots_body = b"User-agent: DiffNexaBot\nDisallow: /\n"
    with pytest.raises(FetchError) as info:
        fetch(server.url("/"), local_policy(server, respect_robots=True))
    assert info.value.reason is FetchFailure.BLOCKED_BY_ROBOTS


def test_a_missing_robots_file_allows_fetching(server):
    server.robots_status = 404
    server.robots_body = b"not found"
    assert fetch(server.url("/"), local_policy(server, respect_robots=True)).status == 200


def test_robots_is_fetched_once_per_origin(server):
    server.robots_body = b"User-agent: *\nAllow: /\n"
    policy = local_policy(server, respect_robots=True)
    fetch(server.url("/"), policy)
    fetch(server.url("/changed"), policy)
    assert server.requests.count("/robots.txt") == 1


def test_robots_can_be_turned_off_for_internal_use(server):
    server.robots_body = b"User-agent: *\nDisallow: /\n"
    assert fetch(server.url("/"), local_policy(server, respect_robots=False)).status == 200


# ---------------------------------------------------------------- determinism


def test_the_same_page_fetches_identically(server):
    policy = local_policy(server)
    first, second = fetch(server.url("/"), policy), fetch(server.url("/"), policy)
    assert first.body == second.body
    assert first.status == second.status
    assert first.content_type == second.content_type

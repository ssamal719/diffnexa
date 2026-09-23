"""A local HTTP server for testing the fetcher.

The test suite must never touch the public internet: it has to be deterministic,
offline and fast. This serves every hostile response shape the fetcher has to
survive — oversized bodies, compression bombs, redirect loops, slow trickles,
wrong content types — from 127.0.0.1.

Because the fetcher refuses loopback addresses by design, tests that use this
server pass a policy with `allow_private_addresses=True`. That switch exists for
exactly this purpose and is off by default in production; a test asserts that.
"""

from __future__ import annotations

import gzip
import threading
import time
import zlib
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HTML = (
    b"<!doctype html><html><body><h1>Terms of service</h1><p>Payment is due within 30 days.</p></body></html>"
)


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args: object) -> None:  # keep test output clean
        return

    def _send(self, status: int, body: bytes, content_type: str = "text/html", **headers: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers.items():
            self.send_header(name.replace("_", "-"), value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = self.path.split("?")[0]
        server: StubServer = self.server.stub  # type: ignore[attr-defined]
        server.requests.append(self.path)

        if path == "/robots.txt":
            self._send(server.robots_status, server.robots_body, "text/plain")

        elif path == "/":
            self._send(200, HTML)

        elif path == "/changed":
            self._send(
                200,
                HTML.replace(b"30 days", b"14 days"),
            )

        elif path == "/gzip":
            body = gzip.compress(HTML)
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif path == "/bomb":
            # ~50 MB of zeros compressing to a few kilobytes.
            raw = b"\0" * (50 * 1024 * 1024)
            body = gzip.compress(raw)
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif path == "/deflate-bomb":
            body = zlib.compress(b"\0" * (50 * 1024 * 1024))
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Encoding", "deflate")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif path == "/huge":
            # Oversized and honest about it, so the declared length is refused.
            body = b"<html>" + b"x" * (8 * 1024 * 1024) + b"</html>"
            self._send(200, body)

        elif path == "/huge-undeclared":
            # Oversized without a usable Content-Length, so only streaming catches it.
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            chunk = b"x" * 65536
            try:
                for _ in range(200):  # 13 MB if fully read
                    self.wfile.write(b"%X\r\n" % len(chunk) + chunk + b"\r\n")
                self.wfile.write(b"0\r\n\r\n")
            except (BrokenPipeError, ConnectionResetError):
                pass  # the fetcher hung up early, which is the point

        elif path == "/slow":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            try:
                for _ in range(60):
                    self.wfile.write(b"4\r\nslow\r\n")
                    self.wfile.flush()
                    time.sleep(0.5)
                self.wfile.write(b"0\r\n\r\n")
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass

        elif path == "/policy":
            self._send(200, server.policy_html)

        elif path == "/price":
            self._send(200, server.price_html)

        elif path == "/competitor":
            self._send(200, server.competitor_html)

        elif path == "/page":
            self._send(200, server.page_html)

        elif path == "/page-changed":
            self._send(200, server.page_html.replace(b"50,000", b"75,000"))

        elif path == "/js-shell":
            self._send(
                200,
                b"<!doctype html><html><head><title>App</title></head><body>"
                b'<div id="root"></div><script>window.__NEXT_DATA__={};</script></body></html>',
            )

        elif path == "/plain":
            self._send(200, b"just text", "text/plain")

        elif path == "/pdf":
            self._send(200, b"%PDF-1.7 not a webpage", "application/pdf")

        elif path == "/no-type":
            self.send_response(200)
            self.send_header("Content-Length", str(len(HTML)))
            self.end_headers()
            self.wfile.write(HTML)

        elif path.startswith("/redirect-chain/"):
            step = int(path.rsplit("/", 1)[1])
            target = "/" if step <= 1 else f"/redirect-chain/{step - 1}"
            self._send(302, b"", "text/html", Location=target)

        elif path == "/redirect-to-private":
            self._send(302, b"", "text/html", Location="http://169.254.169.254/latest/meta-data/")

        elif path == "/redirect-to-file":
            self._send(302, b"", "text/html", Location="file:///etc/passwd")

        elif path == "/redirect-blocked-port":
            self._send(302, b"", "text/html", Location="http://127.0.0.1:22/")

        elif path == "/redirect-loop":
            self._send(302, b"", "text/html", Location="/redirect-loop")

        elif path == "/redirect-no-location":
            self.send_response(302)
            self.send_header("Content-Length", "0")
            self.end_headers()

        elif path == "/missing":
            self._send(404, b"gone")

        elif path == "/error":
            self._send(500, b"broken")

        elif path == "/blocked":
            self._send(200, HTML)

        else:
            self._send(404, b"not found")


class _Server(ThreadingHTTPServer):
    """Silences the traceback printed when the fetcher hangs up early.

    Abandoning an oversized or slow response mid-stream is exactly what several
    tests assert, so the resulting broken pipe is expected, not a failure.
    """

    def handle_error(self, request: object, client_address: object) -> None:
        return


@dataclass
class StubServer:
    """A throwaway HTTP server on localhost, controllable per test."""

    robots_body: bytes = b"User-agent: *\nAllow: /\n"
    robots_status: int = 200
    policy_html: bytes = (
        b"<!doctype html><html><head><title>Terms of Service</title>"
        b'<meta name="description" content="Terms for the service."></head><body><main>'
        b"<h1>Terms of Service</h1>"
        b"<h2>Data retention</h2>"
        b"<p>We retain your personal information for 12 months after your account is closed.</p>"
        b"<h2>Cancellation and termination</h2>"
        b"<p>You may cancel your subscription by giving 30 days written notice.</p>"
        b"<h2>Governing law</h2>"
        b"<p>This agreement is governed by the laws of England and Wales.</p>"
        b"<h2>About us</h2>"
        b"<p>The company was founded in 2011 and employs 400 people.</p>"
        b"</main></body></html>"
    )
    price_html: bytes = (
        b"<!doctype html><html><head><title>Acme Pricing</title>"
        b'<meta name="description" content="Plans and prices."></head><body><main>'
        b"<h1>Acme Pricing</h1>"
        b"<p>All prices in USD.</p>"
        b"<h2>Plans</h2>"
        b"<h3>Starter</h3><p>$9 per month</p><ul><li>Up to 10 users</li><li>Email support</li></ul>"
        b"<h3>Pro Plan</h3><p>$29 per month, billed annually</p><p>Was $39, now $29</p>"
        b"<ul><li>Unlimited users</li><li>14-day trial</li></ul>"
        b"<h3>Business</h3><p>Status: Available</p>"
        b"<h2>About us</h2><p>We serve 12,000 teams with 99% uptime.</p>"
        b'<p>Read our <a href="https://acme.example.com/blog">blog</a>.</p>'
        b"</main></body></html>"
    )
    competitor_html: bytes = (
        b"<!doctype html><html><head><title>Acme Pricing</title>"
        b'<meta name="description" content="Plans for every team."></head><body><main>'
        b"<h1>Project management for teams</h1>"
        b"<p>Plan, track and ship work in one place.</p>"
        b'<a class="button" href="https://acme.example.com/signup">Start free trial</a>'
        b"<h2>Plans</h2>"
        b"<h3>Starter</h3><p>$9 per month</p><ul><li>5 projects</li><li>Email support</li></ul>"
        b"<h3>Pro</h3><p>$29 per month</p><ul><li>Unlimited projects</li><li>Priority support</li></ul>"
        b"<h2>Features</h2><ul><li>Kanban boards</li><li>Gantt charts</li></ul>"
        b"<h2>About us</h2><p>We were founded in 2015 by two engineers in Berlin.</p>"
        b'<p>Read our <a href="https://acme.example.com/blog">blog</a> for updates.</p>'
        b"</main></body></html>"
    )
    page_html: bytes = (
        b"<!doctype html><html><head><title>Service Terms</title>"
        b'<meta name="description" content="Terms for the service."></head><body><main>'
        b"<h1>Service Terms</h1><h2>Pricing</h2>"
        b"<p>The standard plan costs 50,000 per year for each licence.</p>"
        b"<p>Delivery is scheduled for 30 June 2026 at the agreed location.</p>"
        b"</main></body></html>"
    )

    def __post_init__(self) -> None:
        self.requests: list[str] = []
        self._server = _Server(("127.0.0.1", 0), _Handler)
        self._server.stub = self  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    def url(self, path: str = "/") -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)

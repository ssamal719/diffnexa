"""Shared-secret authentication for the engine's API.

The engine is a private service: only this product's own server should be able
to reach it. When ENGINE_SHARED_SECRET is set, every request to /v1/* must
carry it as a bearer token, and anything else is refused.

Design notes:

* Missing credentials return 401, wrong credentials return 403, which is the
  conventional split and tells an operator which problem they have.
* The comparison is constant-time, so an attacker cannot learn the secret by
  measuring how long a rejection takes.
* The secret is never logged, never echoed back, and never appears in an error
  message.
* If the variable is unset the engine runs open, which is what local
  development needs. It says so loudly at startup so an unprotected deployment
  is not a silent mistake.
"""

from __future__ import annotations

import hmac
import os

SCHEME = "bearer"


def configured_secret() -> str | None:
    """The shared secret, or None when authentication is switched off."""
    secret = os.environ.get("ENGINE_SHARED_SECRET", "")
    return secret.strip() or None


def extract_bearer_token(header_value: str | None) -> str | None:
    """Pull the token out of an Authorization header, or None if absent/malformed."""
    if not header_value:
        return None
    parts = header_value.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != SCHEME:
        return None
    token = parts[1].strip()
    return token or None


def check_credentials(header_value: str | None, secret: str | None) -> tuple[bool, int | None]:
    """Return (allowed, status_code_if_refused).

    401 means no usable credentials were presented; 403 means credentials were
    presented but are wrong.
    """
    if secret is None:
        return True, None
    token = extract_bearer_token(header_value)
    if token is None:
        return False, 401
    if hmac.compare_digest(token, secret):
        return True, None
    return False, 403

"""
WeKan authenticated session.

Assumes the user has already logged in out-of-band and obtained a bearer token
(e.g. by POSTing to /users/login once, or by generating one in the UI). This
module does NOT log in - it just wraps HTTP calls with that token.

Environment variables:
    WEKAN_BASE_URL   e.g. https://boards.example.com  (no trailing /api)
    WEKAN_TOKEN      bearer token obtained out-of-band

Public API:
    WekanSession()   - session object with .request(), .get(), .post(), .put(), .delete()
    session.userId   - id of the token owner (fetched from /api/user on init)
    session.token    - the bearer token in use

The session:
    - Validates the token by fetching /api/user on construction (fail fast).
    - Sends Authorization: Bearer <token> on every request.
    - Detects the "200 OK with embedded error" pattern and raises WekanError.
    - Raises a clear error on 401 (token is invalid/expired - caller must
      obtain a new one and set WEKAN_TOKEN).

Notes encoded from field experience:
    - Base URL must NOT end in /api.
    - Server must be started with WITH_API=true.
    - HTTPS only - the bearer token is a long-lived credential.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional


class WekanError(Exception):
    """Raised on API failures, including HTTP 200 with embedded error bodies."""

    def __init__(self, message: str, status: Optional[int] = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


def _http(method: str, url: str, headers: dict, body_bytes: Optional[bytes] = None,
          timeout: float = 30.0) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, data=body_bytes, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()


class WekanSession:
    """Authenticated session against a WeKan server, using a pre-obtained bearer token."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        validate: bool = True,
    ):
        self.base_url = (base_url or os.environ.get("WEKAN_BASE_URL") or "").rstrip("/")
        if not self.base_url:
            raise WekanError("WEKAN_BASE_URL not set")
        if self.base_url.endswith("/api"):
            raise WekanError(
                "WEKAN_BASE_URL must be the site root (e.g. https://boards.example.com), "
                "not ending in /api"
            )
        self.token = token or os.environ.get("WEKAN_TOKEN")
        if not self.token:
            raise WekanError(
                "WEKAN_TOKEN not set. Obtain a bearer token by POSTing JSON to "
                "/users/login once, then export it as WEKAN_TOKEN."
            )
        self.userId: Optional[str] = None
        if validate:
            # Validates the token AND populates userId. Costs one request.
            me = self.get("/api/user")
            if isinstance(me, dict):
                self.userId = me.get("_id")

    def request(
        self,
        method: str,
        path: str,
        json_body: Any = None,
        params: Optional[dict] = None,
    ) -> Any:
        """
        Make an authenticated request. Returns the parsed JSON body.
        Raises WekanError on transport errors or embedded error bodies.
        """
        if not path.startswith("/"):
            path = "/" + path
        url = f"{self.base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }
        body_bytes: Optional[bytes] = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            body_bytes = json.dumps(json_body).encode()

        status, _headers, raw = _http(method, url, headers, body_bytes)

        # Parse body first so error paths can include it.
        parsed: Any = None
        if raw:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw.decode("utf-8", errors="replace")

        if status == 401:
            raise WekanError(
                f"{method} {path} -> 401. Token is invalid or expired. "
                f"Obtain a new one and update WEKAN_TOKEN. Also verify the "
                f"server has WITH_API=true.",
                status=status,
                body=parsed,
            )
        if status >= 400:
            raise WekanError(f"{method} {path} -> {status}", status=status, body=parsed)

        # WeKan sometimes returns HTTP 200 with an embedded error object.
        if isinstance(parsed, dict) and "error" in parsed and "reason" in parsed:
            raise WekanError(
                f"{method} {path} embedded error: {parsed.get('reason')}",
                status=status,
                body=parsed,
            )

        return parsed

    def get(self, path: str, **kw): return self.request("GET", path, **kw)
    def post(self, path: str, json_body: Any = None, **kw): return self.request("POST", path, json_body=json_body, **kw)
    def put(self, path: str, json_body: Any = None, **kw): return self.request("PUT", path, json_body=json_body, **kw)
    def delete(self, path: str, **kw): return self.request("DELETE", path, **kw)


def main() -> int:
    """CLI: prints current user info to verify the token works."""
    try:
        s = WekanSession()
    except WekanError as e:
        print(f"error: {e}", file=sys.stderr)
        if e.body:
            print(f"body: {e.body}", file=sys.stderr)
        return 1
    me = s.get("/api/user")
    print(json.dumps({
        "base_url": s.base_url,
        "userId": s.userId,
        "username": me.get("username") if isinstance(me, dict) else None,
        "isAdmin": me.get("isAdmin") if isinstance(me, dict) else None,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Small deployed HTTP/TLS/header smoke checker for Stage 26 evidence."""
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse

REQUIRED_HEADERS = [
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "strict-transport-security",
]


def check_url(url: str, require_headers: bool) -> dict:
    result = {"url": url, "status": "FAIL", "http_status": None, "missing_headers": [], "error": None}
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "GrammarMastery-Stage26-Smoke/1.0"})
        with urllib.request.urlopen(request, timeout=10) as response:
            result["http_status"] = response.status
            headers = {k.lower(): v for k, v in response.headers.items()}
            if require_headers:
                result["missing_headers"] = [h for h in REQUIRED_HEADERS if h not in headers]
            if 200 <= response.status < 400 and not result["missing_headers"]:
                result["status"] = "PASS"
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        result["error"] = type(exc).__name__
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", choices=["staging", "production"], required=True)
    parser.add_argument("--health-url", required=True)
    parser.add_argument("--frontend-url", required=True)
    args = parser.parse_args()

    urls = [args.health_url, args.frontend_url]
    if args.environment == "production" and any(urlparse(u).scheme != "https" for u in urls):
        print(json.dumps({"status": "FAIL", "error": "production URLs must use HTTPS"}, indent=2))
        return 2

    health = check_url(args.health_url, require_headers=True)
    frontend = check_url(args.frontend_url, require_headers=True)
    status = "PASS" if health["status"] == frontend["status"] == "PASS" else "FAIL"
    print(json.dumps({"status": status, "health": health, "frontend": frontend}, indent=2))
    return 0 if status == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

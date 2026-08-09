from __future__ import annotations

from copy import deepcopy
import base64
import hashlib
import hmac
import json
from typing import Any, Iterable

from .errors import APIError


PAGINATION_VERSION = "api-pagination-v1.0.0"


def _encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class CursorCodec:
    def __init__(self, secret: bytes) -> None:
        if not isinstance(secret, bytes) or len(secret) < 16:
            raise ValueError("CURSOR_SECRET_TOO_SHORT")
        self.secret = secret

    def encode(self, offset: int, query_fingerprint: str) -> str:
        body = json.dumps(
            {"v": PAGINATION_VERSION, "offset": int(offset), "query": query_fingerprint},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        signature = hmac.new(self.secret, body, hashlib.sha256).digest()
        return f"{_encode(body)}.{_encode(signature)}"

    def decode(self, cursor: str, query_fingerprint: str) -> int:
        invalid = APIError(400, "QUERY_PARAMETER_INVALID", "The pagination cursor is invalid.")
        try:
            raw_body, raw_signature = cursor.split(".", 1)
            body = _decode(raw_body)
            signature = _decode(raw_signature)
            expected = hmac.new(self.secret, body, hashlib.sha256).digest()
            if not hmac.compare_digest(signature, expected):
                raise invalid
            payload = json.loads(body)
            if payload.get("v") != PAGINATION_VERSION or payload.get("query") != query_fingerprint:
                raise invalid
            offset = int(payload["offset"])
            if offset < 0:
                raise invalid
            return offset
        except APIError:
            raise
        except (ValueError, TypeError, KeyError, json.JSONDecodeError, base64.binascii.Error):
            raise invalid


def query_fingerprint(filters: dict[str, Any], sort: str) -> str:
    canonical = json.dumps(
        {"filters": filters, "sort": sort},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def paginate(
    items: Iterable[dict[str, Any]],
    page_size: int,
    cursor: str | None,
    codec: CursorCodec,
    fingerprint: str,
) -> dict[str, Any]:
    if not 1 <= int(page_size) <= 100:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The page size is invalid.",
            {"page[size]": ["Use a value between 1 and 100."]},
        )
    rows = list(items)
    offset = codec.decode(cursor, fingerprint) if cursor else 0
    if offset > len(rows):
        raise APIError(400, "QUERY_PARAMETER_INVALID", "The pagination cursor is invalid.")
    selected = deepcopy(rows[offset : offset + page_size])
    next_offset = offset + len(selected)
    has_more = next_offset < len(rows)
    return {
        "data": selected,
        "page": {
            "page_size": int(page_size),
            "has_more": has_more,
            "next_cursor": codec.encode(next_offset, fingerprint) if has_more else None,
        },
    }


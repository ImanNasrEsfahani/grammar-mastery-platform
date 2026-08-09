# Stage 21 API Error Contract

**Version:** `api-error-v1.0.0`  
**Owner:** Iman  
**Prepared:** 2026-08-09 UTC  
**Status:** Frozen for API v1 review

Every non-2xx API response uses exactly one top-level `error` object:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "fields": {"question_count": ["Must be at least 1."]},
    "request_id": "req_01J..."
  }
}
```

`code` and HTTP status are stable client contracts. `message` is human-facing and may be localized. `fields` is always an object; each key is a request-field path and each value is an array of messages. `request_id` is non-empty and correlates the response with service logs and audit events.

The selected Django REST Framework adapter applies this envelope to domain errors and to Django/DRF parsing, validation, authentication, permission, routing, media-type, throttling and unexpected failures. `RequestIdMiddleware` returns the same safe identifier in `X-Request-ID`.

## Status and code catalogue

| HTTP | Codes | Meaning |
|---:|---|---|
| 400 | `INVALID_JSON`, `QUERY_PARAMETER_INVALID` | Transport/query cannot be interpreted |
| 401 | `AUTHENTICATION_REQUIRED`, `TOKEN_INVALID`, `SESSION_REVOKED` | No valid authenticated session |
| 403 | `FORBIDDEN` | Authenticated principal lacks permission |
| 404 | `RESOURCE_NOT_FOUND` | Missing resource or concealed owner mismatch |
| 405 | `METHOD_NOT_ALLOWED` | Route exists but the HTTP method is unsupported |
| 406 | `NOT_ACCEPTABLE` | Requested response representation is unsupported |
| 409 | `STATE_CONFLICT`, `ANSWER_ALREADY_SUBMITTED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS` | Request conflicts with current state/replay record |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Request content type is unsupported |
| 422 | `VALIDATION_ERROR`, `NO_ELIGIBLE_QUESTIONS` | Semantically invalid request or safe runtime inventory block |
| 429 | `RATE_LIMITED` | Versioned rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error; no internals leaked |
| 503 | `DEPENDENCY_UNAVAILABLE` | Required database/job dependency unavailable |

Canonical Stage 13–17 domain error codes may be passed through only when their HTTP mapping is recorded in the OpenAPI response. Unknown internal exceptions map to `INTERNAL_ERROR`; stack traces, SQL, tokens, password data and answer keys are never returned.

## Valid example

- Top-level key is only `error`.
- All four required fields exist.
- `fields` is an object, even when empty.
- `request_id` is returned and logged.

## Invalid examples

- `{ "message": "bad" }` — missing stable code and request ID.
- `{ "error": "bad" }` — wrong shape.
- Returning `200` with an error body — status/code mismatch.
- Embedding exception text or a correct answer in `message` — information leak.

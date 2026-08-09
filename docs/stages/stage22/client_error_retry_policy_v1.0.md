# Stage 22 Client Error and Retry Policy

The browser consumes the Stage 21 error envelope through the same-origin Next.js boundary. `error.code` drives stable behavior, `message` is human-readable, field errors attach to forms, and `request_id` is shown for support.

| Condition | Client behavior | Automatic retry |
|---|---|---|
| Network failure / 502 / 503 / 504 | Preserve the visible question and pending answer; show offline/retry state | On `online`, using the same payload and idempotency key |
| 429 | Preserve the answer and show temporary wait/retry | Allowed with the same idempotency key; respect `Retry-After` when surfaced |
| 401 | Clear no server data, offer login, keep bearer token inaccessible | No |
| 403 | Fail closed; do not infer permissions from hidden controls | No |
| 404 | Show not-found without revealing cross-owner existence | No |
| 409 `IDEMPOTENCY_CONFLICT` | Stop retry and expose request ID; never change payload under the key | No |
| 409 invalid attempt state | Offer result/dashboard navigation | No |
| 422 | Render field/item validation; keep user input | No |
| `NO_ELIGIBLE_QUESTIONS` | Explain that no reviewed published inventory is available | No |

Pending answers contain no token, correct answer or explanation. A successful receipt deletes the pending record before the next question is requested. The runner never invents a success response while offline.

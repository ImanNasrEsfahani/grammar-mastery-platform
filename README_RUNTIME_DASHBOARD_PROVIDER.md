# Grammar Mastery — PostgreSQL Dashboard Provider v1

This patch binds the Stage 18 / Stage 21 dashboard surfaces to the canonical
PostgreSQL database:

- `GET /api/v1/dashboard`
- `GET /api/v1/next-actions/current`

It is intentionally read-only and requires no migration.

## Source contracts followed

- Stage 18 dashboard contract `dashboard-contract-v0.9.0`
- Stage 18 confidence gate: do not label a lesson weak/critical below confidence `0.45`
- Stage 18 CTA priority:
  `OVERDUE_REVIEW` → `DUE_REVIEW` → `CRITICAL_CONFIDENT_LESSON` →
  `WEAK_CONFIDENT_LESSON` → `DEVELOPING_LESSON` → `BUILD_EVIDENCE` →
  `REGULAR_PRACTICE`
- Stage 21 `DashboardEnvelope` and `NextActionEnvelope`
- Stage 19 canonical `/fa` and `/en` route slugs

## PostgreSQL sources

The provider reads existing canonical tables/views only:

- `users`
- `user_mastery`
- `review_queue`
- `v_error_review_groups`
- `error_review_items`
- `test_attempts`
- `tests`
- `mastery_snapshots`
- `user_answers`
- `error_review_events`

No table, migration or schema is added.

## Empty-state behavior

A newly registered authenticated user with no learning evidence receives HTTP
`200` from both endpoints.

Dashboard:

- `next_action = BUILD_EVIDENCE`
- `mastery = []`
- all review/activity counts = `0`
- `recent_test = null`
- no fabricated weakness label
- no fabricated trend

Next action points to `/{locale}/tests/new`. The locale comes from the canonical
user profile (`fa-IR` → `/fa`, everything else → `/en`).

## Deployment

After committing this patch to `main`:

```bash
cd /var/www/grammar-mastery
git fetch origin
git reset --hard origin/main

docker compose build --no-cache backend
docker compose up -d --no-deps --force-recreate backend
docker compose ps backend
```

No migration rerun is required.

Health should change to:

```json
{"status":"ready","runtime":"docker-runtime-v1.0.3-postgres-dashboard"}
```

## Smoke test with a fresh token

```bash
TOKEN="$(curl -s -X POST http://127.0.0.1:8005/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test-password-123"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])')"
```

Dashboard:

```bash
curl -i http://127.0.0.1:8005/api/v1/dashboard \
  -H "Authorization: Bearer $TOKEN"
```

For the current new test user, expected essentials are:

```text
HTTP/1.1 200 OK
next_action: BUILD_EVIDENCE
mastery: []
review_queue.due_count: 0
activity.questions_answered: 0
recent_test: null
```

Next action:

```bash
curl -i http://127.0.0.1:8005/api/v1/next-actions/current \
  -H "Authorization: Bearer $TOKEN"
```

Expected for a `fa-IR` new user:

```json
{
  "data": {
    "code": "BUILD_EVIDENCE",
    "destination": "/fa/tests/new"
  }
}
```

## Frontend proxy

The existing Next.js proxy already forwards the `gmp_access_token` cookie as a
bearer token to Django. No frontend rebuild is needed for this patch unless the
frontend image is independently being refreshed.

## Scope boundary

Other Stage 21 providers remain intentionally unbound. For example lessons,
test generation, mastery detail, review operations and admin operations can
still return `503 DEPENDENCY_UNAVAILABLE` until their own runtime providers are
implemented.

The current zero-`PUBLISHED` question inventory still blocks actual learner
test creation. This dashboard patch does not manufacture content or learning
evidence.

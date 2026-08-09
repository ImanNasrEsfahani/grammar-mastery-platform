# Runtime API Routing Hotfix v1

Scope: **only the missing Django HTTP routing surface** (Stage 26 blocker `S26_B01_DJANGO_HTTP`).

This package does not merge or modify earlier stage deliverables and does not invent production service providers.

## What this fixes

The deployed Next.js proxy forwards requests to Django under `/api/v1/*`, while the runtime URL configuration previously exposed only:

- `/health/live`
- `/health/ready`

This hotfix mounts `backend.django_adapter.urls` under `/api/v1/` and explicitly registers all **34 Stage 21 operations** from `docs/stages/stage21/resource_map_v1.0.csv`.

Because several production service/provider bindings are still not implemented in the repository, a successfully routed endpoint fails closed with the frozen JSON error contract:

- `503 DEPENDENCY_UNAVAILABLE`

Protected routes without a Bearer token now fail at DRF authentication/permission handling instead of falling through to Django's HTML 404 page. For `/api/v1/dashboard`, an unauthenticated request should therefore become a contract-shaped `401`, which lets the current Next.js dashboard show its login state correctly.

## Apply

Extract this archive **at the repository root**, preserving paths, then rebuild the backend:

```bash
docker compose build backend
docker compose up -d backend
```

The frontend code does not need a rebuild for this routing-only hotfix.

## Verify

Health must remain good:

```bash
curl -i http://127.0.0.1:8000/health/ready
```

Then verify that the dashboard route no longer returns Django HTML 404:

```bash
curl -i http://127.0.0.1:8000/api/v1/dashboard
```

Expected without a token: a JSON `401` error envelope such as `AUTHENTICATION_REQUIRED`.

Also verify a public Stage 21 path resolves:

```bash
curl -i -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"not-a-real-password"}'
```

Until the AUTH runtime provider is bound, the expected result is JSON `503 DEPENDENCY_UNAVAILABLE`, **not 404**.

## Tests

```bash
PYTHONPATH=src python -m unittest tests.test_runtime_api_routing_hotfix -v
```

The test compares the route manifest directly with the frozen Stage 21 resource map and requires all 34 operation IDs to be present.

## Important boundary

This hotfix solves **problem #1: missing Django routing**. It intentionally does not solve database migrations, production AUTH/session provider binding, question inventory, or full PostgreSQL-backed learner services. Those should be diagnosed separately after this routing layer is deployed.

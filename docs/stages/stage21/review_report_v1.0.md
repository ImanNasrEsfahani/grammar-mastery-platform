# Stage 21 Review Report — Backend and Core APIs

**Package:** `stage21-v1.1-review`  
**Owner:** Iman  
**Prepared:** 2026-08-09 UTC  
**Status:** Reference implementation validated; owner acceptance pending

## Outcome

Stage 21 now has a unified, versioned `/api/v1` contract with 34 operations across authentication, lessons, tests, attempts, Error Review/SRS, mastery, progress/dashboard analytics and Stage 20 administration. Django 5.2 LTS with Django REST Framework 3.16+ is the accepted backend profile. Next.js 16 Active LTS is the accepted frontend profile for Stage 22. The transport-independent application services are retained and a tested Django adapter now owns HTTP-specific authentication, role checks, request correlation and error translation.

## Roadmap deliverables

| Required output | Artifact | Result |
|---|---|---|
| API resource map | `resource_map_v1.0.csv` | 34 rows; exact method/path/operation/service mapping |
| Auth policy | `auth_policy_v1.0.md` + reference security adapter | Session-backed bearer tokens, revocation, roles, ownership and initial rate limits |
| Error contract | `error_contract_v1.0.md` + JSON Schema | One stable error shape with status/code catalogue and request correlation |
| Service boundaries | `service_boundaries_v1.0.md` + application service | Transport/domain/storage separation and atomic answer flow |
| OpenAPI spec | `api/stage21_core_api_spec_v1.0.yaml` | OpenAPI 3.1; 33 paths and 34 unique operations |
| Framework decision | `framework_decision_v1.0.md` + Django adapter | Django/DRF accepted for Backend; Next.js accepted for Stage 22 |

Additional delivery includes additive PostgreSQL storage for credentials, historical role assignments, sessions, idempotency records and heavy analytics jobs; schema contracts for errors/idempotency; Django/DRF runtime requirements; request-ID middleware; bearer authentication and role-permission adapters; and an automated validator.

## Important decisions

- The API is REST/JSON, resource-oriented and versioned at `/api/v1`.
- The existing Stage 20 administration operations and role gates are preserved inside the unified contract.
- Learner resources are owner-scoped in application services; an owner mismatch is concealed as `RESOURCE_NOT_FOUND`.
- Public registration can create only `USER`; staff roles cannot be self-assigned.
- Access tokens are short-lived and session-backed so logout revocation is enforceable. The standard-library reference uses JWT HS256; production key rotation remains Stage 25 work.
- Cursor pagination is opaque, signed and bound to the exact filter/sort query.
- Idempotency is required for create-test, start-attempt, submit-answer, complete-attempt, review grade, analytics job creation and both admin commit operations.
- The pre-answer question response is an allow-list schema. Correct option, correctness, explanations, misconception mappings and internal answer-key metadata cannot appear.
- Answer acceptance writes raw evidence, Stage 15 mastery/snapshot, Stage 16 review state and Stage 17 scheduling state in one unit of work.
- Review retries remain Stage 16 resolution evidence: they do not alter the original attempt score, Stage 15 mastery or Stage 17 schedule.
- Dashboard reads are aggregated and historical progress uses persisted snapshots only. Heavy rebuilds are asynchronous jobs.
- Django does not replace the canonical Stage 12 `users` table with `auth_user`, and Django models/repositories must not generate duplicate learning tables.
- Next.js uses App Router, strict TypeScript and an OpenAPI-derived server-side client in Stage 22. Browser `localStorage` token persistence and frontend learning calculations are forbidden.

## Valid and invalid boundary examples

- Valid: replaying the same answer body with the same idempotency key returns the original answer ID and produces one evidence/SRS event.
- Invalid: reusing that key with another option returns `IDEMPOTENCY_KEY_REUSED` and writes nothing.
- Valid: a wrong answer creates one unresolved review item plus a LEARNING schedule.
- Invalid: a transaction failure after mastery calculation rolls back answer, mastery snapshot, review item and schedule together.
- Valid: an explicit review reveal is audited and leaves the item unresolved.
- Invalid: requesting another user's attempt returns a concealed 404.
- Valid: with no published serving inventory, test creation returns `NO_ELIGIBLE_QUESTIONS`.
- Invalid: fabricating a question or relaxing the PUBLISHED/safety gate is forbidden.

## Risk controls

- **Answer leakage:** separate pre-answer allow-list and post-answer feedback schemas, plus recursive leakage tests.
- **N+1 queries:** aggregate dashboard/resource ports and future Stage 24 query-count budgets.
- **Fat controllers:** Django REST Framework views and serializers translate transport only; reference tests call application/domain services without HTTP.
- **Breaking changes:** stable operation IDs and `/api/v1`; incompatible changes require v2 plus migration/deprecation evidence.
- **Duplicate writes:** request-hash-bound idempotency with in-progress, replay and conflict semantics.
- **Privilege bypass:** Stage 20 roles plus Stage 11 independent-review and bulk transition gates remain backend requirements.

## Validation evidence

- Baseline validator: PASS.
- Existing Stage 1–20 suite: 85/85 PASS.
- Django 5.2.17 and Django REST Framework 3.18.0 runtime import: PASS.
- Django system checks: PASS, 0 issues.
- Django adapter tests: 6/6 PASS.
- Stage 21 tests: 45/45 PASS.
- Integrated repository suite: 130/130 PASS.
- OpenAPI YAML parse: PASS.
- OpenAPI/resource map: 34/34 operations matched and unique.
- Pre-answer leakage controls: PASS.
- Transaction rollback and idempotent replay/conflict tests: PASS.
- PostgreSQL Patch 006 static/additive checks: PASS.
- Live PostgreSQL execution: not run; remains an explicit deployment verification.

## Historical and import impact

Stage 21 does not migrate or rewrite question content, immutable revisions, frozen test snapshots, raw answers, mastery snapshots, audit history or prior imports. Stage 10 and Stage 20 row schemas remain authoritative. The new tables are transport/runtime support only. Historical reports read the existing evidence and are not recomputed silently.

## Decisions

`S21_D01_RUNTIME_FRAMEWORK` is resolved as Django 5.2 LTS plus Django REST Framework 3.16+. `S21_D05_FRONTEND_FRAMEWORK` records Next.js 16 Active LTS for Stage 22. `needs_decision_v1.0.csv` now contains only three non-hidden deployment/security decisions: signing-key lifecycle, analytics worker/queue and production base URL.

## Readiness

All Stage 21 design outputs, valid/invalid examples, dependencies, versions and risk controls are present and testable. The package is `READY_FOR_OWNER_REVIEW`, not yet labeled `READY_FOR_NEXT_STAGE`, because formal Iman acceptance and live PostgreSQL execution are not claimed.

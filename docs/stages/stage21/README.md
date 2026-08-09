# Stage 21 — Backend and Core APIs

- **Package:** `stage21-v1.1-review`
- **Owner:** Iman
- **Prepared:** 2026-08-09 UTC
- **Repository status:** `DJANGO_DRF_IMPLEMENTATION_PROFILE_VALIDATED_PENDING_OWNER_ACCEPTANCE`
- **API base path:** `/api/v1`

Stage 21 freezes a resource-oriented, versioned and testable backend contract for authentication, content, tests, attempts/scoring, Error Review, mastery/SRS, progress/dashboard analytics and the Stage 20 administration surface. The selected backend is Django 5.2 LTS with Django REST Framework; Next.js 16 Active LTS is the selected Stage 22 frontend.

## Deliverables

- `config/stage21_backend_contract_v1.0.json` — canonical cross-service policy and version record
- `api/stage21_core_api_spec_v1.0.yaml` — unified OpenAPI 3.1 contract
- `docs/stages/stage21/resource_map_v1.0.csv` — endpoint-to-service/access/dependency map
- `docs/stages/stage21/service_boundaries_v1.0.md` — domain/application/storage boundaries and transaction flow
- `docs/stages/stage21/auth_policy_v1.0.md` — credentials, sessions, claims, authorization and rate-limit baseline
- `docs/stages/stage21/error_contract_v1.0.md` — stable error envelope and status/code catalogue
- `docs/stages/stage21/framework_decision_v1.0.md` — accepted Django/DRF and Next.js implementation profile
- `schemas/stage21_error_response_v1.0.json` — machine-readable error shape
- `schemas/stage21_idempotency_record_v1.0.json` — replay/conflict storage contract
- `database/postgres/006_stage21_api_runtime_v1.0.sql` — additive auth/session/idempotency/job/role storage
- `src/backend/` — transport-independent application primitives plus the selected `django_adapter`
- `requirements.txt` — selected Django/DRF/PostgreSQL runtime dependency ranges
- `tests/test_stage21_backend_api.py` — contract, security-boundary and transaction tests
- `docs/stages/stage21/validation_v1.0.json` — validation evidence
- `docs/stages/stage21/review_report_v1.0.md` — completion, risk and downstream handoff

## Frozen boundaries

- Django REST Framework views, serializers, authentication and permissions translate transport only; calculations remain in the existing Stage 13–17 domain engines and Stage 21 application services.
- `GET /attempts/{attemptId}/next` uses a dedicated public question projection that cannot contain answer-key fields.
- Start-attempt, submit-answer and complete-attempt writes are idempotent. The answer pipeline commits answer, mastery, Error Review and SRS effects atomically.
- Learner resources are owner-scoped. Staff actions reuse the Stage 20 role matrix and Stage 11 independent-review gate.
- Dashboard reads are aggregated. Heavy analytics use persisted jobs rather than synchronous request fan-out.

## Selected implementation boundary

`S21_D01_RUNTIME_FRAMEWORK` is resolved as Django 5.2 LTS plus Django REST Framework 3.16+. The executable learning services remain transport-independent and the `backend.django_adapter` package adds request correlation, bearer authentication integration, role permission enforcement and uniform exception translation. Canonical Stage 12–21 PostgreSQL tables remain authoritative; Django must not introduce a parallel `auth_user` identity store or duplicate learning tables.

Next.js 16 Active LTS is recorded as the frontend choice, but its component system and application code remain Stage 22 work under the roadmap. The handoff requires strict TypeScript, App Router, OpenAPI-derived types, a server-side API boundary and no learning logic or UI-only authorization.

The repository still has zero real `PUBLISHED` questions. A test-creation request must therefore return `NO_ELIGIBLE_QUESTIONS`; Stage 21 does not fabricate content to make the endpoint appear operational.

## Validate

```bash
python -m pip install -r requirements-dev.txt
python tools/validate_baseline.py
python -m unittest discover -s tests -v
python tools/validate_stage21.py
```

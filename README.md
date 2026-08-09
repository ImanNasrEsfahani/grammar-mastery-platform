# Grammar Mastery Platform

Data-driven French grammar learning platform derived from the project roadmap: knowledge map → taxonomy → content planning → question QA → relational database → test generation → adaptive selection → mastery and later review/SRS/product stages.

## Current repository state

The accepted canonical baseline remains **Stages 1–15**. Repository-ready Stage 16–24 deliverables are layered on top without relabeling historical v0.9 formulas or synthetic measurements as empirical production facts. Stage 16/17 are verified imports of their original Library packages; Stage 18–20 are explicitly marked reconstructions where the earlier sandbox artifacts were not persisted; Stage 21 is the Django/DRF backend/API profile; Stage 22 is the strict-TypeScript Next.js frontend and fast question-solving experience; Stage 23 is the auditable CSV/XLSX question-bank import pipeline; Stage 24 is the deterministic multi-layer test and CI gate.

Key facts:

- 52 lessons and 304 atomic subtopics.
- 11 categories, 27 subcategories, 35 controlled tags.
- TCF-weight model totals 100.00%.
- Planned question bank: Full **10,636**, Expanded **5,331**, MVP **2,666**.
- Four-level difficulty system with Stage 9 per-lesson bank targets.
- Standard 46-column question import contract.
- PostgreSQL 15+ relational contract with immutable question revisions and auditable history.
- Stage 13 deterministic test-generator reference implementation.
- Stage 14 adaptive priority model.
- Stage 15 confidence-aware mastery model.
- Stage 16 Error Review reference engine and additive storage patch.
- Stage 17 concept-level spaced-repetition scheduler and additive storage patch.
- Stage 18 actionable learning-dashboard contract.
- Stage 19 localized site IA and page-responsibility contract.
- Stage 20 admin roles, API, bulk-import and audit contracts.
- Stage 21 unified `/api/v1` OpenAPI contract, Django 5.2 LTS + DRF adapter, auth/error/idempotency policies, additive runtime storage and executable answer→mastery→review→SRS transaction reference.
- Stage 22 Next.js 16.2.11 App Router frontend, OpenAPI-derived types, same-origin server API boundary, mobile-first runner components, resilient answer retry queue and bilingual accessibility contract.
- Stage 23 nine-phase import pipeline with frozen 46-column validation, canonical lookup mapping, multi-layer deduplication, non-mutating preview, atomic Draft-only commit, append-only audit and safe rollback boundary.
- Stage 24 unit, integration, contract, in-process E2E, frontend lifecycle, PostgreSQL migration-profile and synthetic performance tests with fixed fixtures and explicit live-stack evidence boundaries.

See [STATUS.md](STATUS.md) for readiness and blockers.

## Repository layout

- `docs/governance/` — owner/source decisions and governance resolution patch
- `docs/stages/` — per-stage release notes
- `docs/sources/` — provenance only; source PDFs are not committed
- `data/knowledge/` — canonical lesson/subtopic/dependency exports
- `data/taxonomy/` — canonical taxonomy/tag exports
- `data/planning/` — weights, capacity and difficulty targets
- `config/` — versioned stage contracts/policies
- `schemas/` — machine-readable import schema
- `database/postgres/` — Stage 12 base schema plus additive Stage 15–17 and Stage 20–23 patches; Stage 24 identifies and replaces the unapplied Stage 23 v1.0 naming collision with v1.1
- `database/sqlite/` — executable reference patches for Stages 16–17
- `api/` — Stage 20 admin contract, unified Stage 21 API and additive Stage 23 import API
- `src/` — reference engines for Stages 13–17, Stage 21 application services/Django adapter and Stage 23 import pipeline
- `frontend/` — Stage 22 Next.js application, generated API types, runner components and frontend tests
- `data/product/` — product/IA matrices for Stage 19
- `tests/` — repository contract tests
- `tools/` — baseline validation
- `artifacts/` — canonical package artifacts

## Important source policy

The authoritative French grammar book PDF is **not stored in this repository**. Its edition and SHA-256 fingerprint are recorded in `docs/sources/provenance.json`. The project roadmap PDF is also excluded from this public repository.

## Validate

```bash
python -m pip install -r requirements-dev.txt
python tools/validate_baseline.py
python -m unittest discover -s tests -v
python tools/validate_stage21.py
python tools/validate_stage22.py
python tools/validate_stage23.py
python tools/validate_stage24.py
python tools/run_stage24_performance.py --check
cd frontend
npm ci
npm run validate
```

The integrated local Python run discovers **179 tests**: 177 pass and the 2 live-PostgreSQL tests skip unless `GMP_STAGE24_POSTGRES_DSN` is provided. The frontend suite contains **8 passing Vitest tests**, including the Stage 24 answer→complete→result runner lifecycle. The checked-in CI profile supplies PostgreSQL 15 for those two database tests; that workflow has not been claimed as executed from this package-building environment.

## Next roadmap work

Stage 25 — security and abuse hardening. Stage 26 then supplies deployed HTTP/browser/PostgreSQL evidence, and Stage 27 performs empirical calibration. Real learning-runtime validation still requires a reviewed `PUBLISHED` question inventory and live user history. Raw-file retention, object storage, signing-key lifecycle, analytics worker and production URL decisions remain explicit downstream work.

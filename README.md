# Grammar Mastery Platform

Data-driven French grammar learning platform derived from the project roadmap: knowledge map → taxonomy → content planning → question QA → relational database → test generation → adaptive selection → mastery and later review/SRS/product stages.

## Current repository state

The accepted canonical baseline remains **Stages 1–15**. Repository-ready Stage 16–21 deliverables are layered on top without relabeling historical v0.9 formulas as new empirical facts. Stage 16/17 are verified imports of their original Library packages; Stage 18–20 are explicitly marked reconstructions where the earlier sandbox artifacts were not persisted; Stage 21 is a Django/DRF backend/API review package with Next.js selected for Stage 22.

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
- `database/postgres/` — Stage 12 base schema plus additive Stage 15–17, Stage 20 and Stage 21 patches
- `database/sqlite/` — executable reference patches for Stages 16–17
- `api/` — Stage 20 admin contract and unified Stage 21 OpenAPI contract
- `src/` — reference engines for Stages 13–17 plus Stage 21 application services and Django/DRF adapter
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
```

The integrated repository suite contains 130 tests: the prior 85-test Stage 1–20 suite plus 45 Stage 21 contract, Django-adapter, security-boundary, idempotency, leakage and transaction tests.

## Next roadmap work

Stage 22 — Next.js 16 Active LTS frontend and fast question-solving experience. Stage 23+ covers import tooling, multi-layer testing, security, deployment and empirical calibration. Real learning-runtime validation still requires a reviewed `PUBLISHED` question inventory and live user history. Signing-key lifecycle, analytics worker and production URL decisions remain explicitly recorded for Stages 25–26.

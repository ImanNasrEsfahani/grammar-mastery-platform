# Grammar Mastery Platform

Data-driven French grammar learning platform derived from the project roadmap: knowledge map → taxonomy → content planning → question QA → relational database → test generation → adaptive selection → mastery and later review/SRS/product stages.

## Current repository state

The accepted canonical baseline remains **Stages 1–15**. Repository-ready Stage 16–20 deliverables are layered on top without relabeling historical v0.9 formulas as new empirical facts. Stage 16/17 are verified imports of their original Library packages; Stage 18–20 are explicitly marked reconstructions where the earlier sandbox artifacts were not persisted.

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
- `database/postgres/` — Stage 12 base schema plus additive Stage 15–17 and Stage 20 patches
- `database/sqlite/` — executable reference patches for Stages 16–17
- `api/` — API contracts introduced by product/admin stages
- `src/` — reference engines for Stages 13–17
- `data/product/` — product/IA matrices for Stage 19
- `tests/` — repository contract tests
- `tools/` — baseline validation
- `artifacts/` — canonical package artifacts

## Important source policy

The authoritative French grammar book PDF is **not stored in this repository**. Its edition and SHA-256 fingerprint are recorded in `docs/sources/provenance.json`. The project roadmap PDF is also excluded from this public repository.

## Validate

```bash
python tools/validate_baseline.py
python -m unittest discover -s tests -v
```

The integrated repository suite contains 85 tests: the original 74 mapped tests plus 11 conservative integration-hardening regressions.

## Next roadmap work

Stage 21 — Backend/API implementation. Stage 22+ covers frontend, import tooling, testing, security, deployment and empirical calibration. Real learning-runtime validation still requires a reviewed `PUBLISHED` question inventory and live user history.

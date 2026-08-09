# Grammar Mastery Platform

Data-driven French grammar learning platform derived from the project roadmap: knowledge map → taxonomy → content planning → question QA → relational database → test generation → adaptive selection → mastery and later review/SRS/product stages.

## Current baseline

This commit consolidates the **best accepted repository baseline through Stage 15**. It does not relabel historical v0.9 formulas as new empirical facts: validated semantic model IDs remain versioned, while upstream governance blockers have been formally resolved.

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
- `database/postgres/` — Stage 12 base schema + Stage 15 additive patch
- `src/` — reference engines for Stages 13–15
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

## Next roadmap work

Stage 16 — Error Review; Stage 17 — Spaced Repetition; Stage 18+ product/UI/admin/backend/deployment. Real Stage 13/14 runtime remains blocked until a reviewed `PUBLISHED` question inventory exists.

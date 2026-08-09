# Stage 24 — Multi-layer Testing

## Outcome

This Stage 24-only overlay implements the roadmap testing pyramid around the existing Stage 13–23 reference system. It adds fixed synthetic fixtures, critical-scenario tests, a no-retry CI gate, a PostgreSQL 15 fresh-schema profile, an in-process learner journey, a frontend attempt lifecycle test and a production-scale synthetic performance guardrail.

The release state is `REFERENCE_MULTILAYER_SUITE_VALIDATED_LIVE_STACK_EVIDENCE_PENDING_OWNER_ACCEPTANCE`. Local evidence is complete for the available reference adapters. A deployed Django HTTP surface, real browser session, target PostgreSQL instance and real `PUBLISHED` inventory do not exist in the supplied baseline, so this package does not claim those results.

## Roadmap outputs

| Output | Artifact |
|---|---|
| Test pyramid | `test_pyramid_v1.0.md` |
| Critical scenarios | `critical_scenarios_v1.0.csv` |
| Fixed fixtures and seeds | `tests/fixtures/stage24/` |
| CI test suite | `.github/workflows/stage24-ci.yml` |
| Performance baseline | `performance_baseline_v1.0.json` and `tools/run_stage24_performance.py` |
| Review and validation | `review_report_v1.0.md`, `validation_v1.0.json` |

## Dedicated evidence

- Unit: exact 100.00 weight total and rounding, four-option/correct-answer invariant, exact generator composition, fixed mastery numeric result and fixed SRS transition.
- Integration: owner authorization, idempotent single side effect, answer transaction rollback, import commit/rollback audit and malformed UTF-8 fail-closed behavior.
- Contract: unique operation IDs, response/security presence, required idempotency and pre-answer answer-key exclusion.
- E2E: register → login → create test → start → answer → complete → result → review correction → dashboard → logout, using the transport-independent Stage 21 reference application.
- Frontend lifecycle: hidden answer before submit → receipt feedback → complete attempt → result route.
- Performance: 10,636 synthetic bank rows and dashboard history points plus 304 mastery scopes.
- PostgreSQL: an isolated-schema test and GitHub Actions PostgreSQL 15 service apply the approved migration sequence.

## Important Stage 23 dependency correction

Stage 12 already creates `import_batches`. The Stage 23 v1.0 patch also attempted to create `import_batches` with different columns and statuses; `CREATE TABLE IF NOT EXISTS` would skip creation and the next index on `raw_sha256` would fail. No live execution had been reported, so Stage 24 preserves the historical file but supersedes it in the executable plan with `007_stage23_import_pipeline_v1.1.sql`, using `question_import_*` names. No table is dropped or renamed.

## Commands

```bash
python -m pip install -r requirements-dev.txt
python tools/validate_stage24.py
python -m unittest discover -s tests -v
python tools/run_stage24_performance.py --check
cd frontend
npm ci
npm run validate
```

To execute the live PostgreSQL profile outside CI:

```bash
GMP_STAGE24_POSTGRES_DSN='postgresql://USER:PASSWORD@HOST:5432/DATABASE' \
  python -m unittest discover -s tests -p 'test_stage24_postgres.py' -v
```

The test creates and drops only its uniquely named isolated schema. It does not target production data.

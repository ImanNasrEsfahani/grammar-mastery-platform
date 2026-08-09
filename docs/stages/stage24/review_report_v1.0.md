# Stage 24 Review Report

## Outcome

All roadmap artifacts for a multi-layer testing stage are present and reviewable. The available reference implementation passes its unit, integration, contract, in-process E2E, frontend lifecycle and synthetic performance gates. A PostgreSQL 15 isolated-schema test is checked into CI but was not executed locally because this environment has no PostgreSQL server/DSN. Deployed HTTP and real-browser E2E remain impossible until the Stage 26 stack exists.

The latest GitHub `main` baseline used was `e04967b799b8c254dee651d5e54902847f749b29` (Stages through 22). The saved Stage 23-only package SHA-256 was `c74cbee179a837ec812fb890886e9038842492688dc7e473dcd13f356620055f`. `ROADMAP.md` and `AGENTS.md` were absent; the supplied roadmap PDF SHA-256 `8a561160d698ffb811453d20b9c610fbb644c7593cca10b3bca6728c7969e6a7` governed Stage 24.

## Requirement evidence

| Roadmap requirement | Evidence |
|---|---|
| Unit formula/domain tests | exact weights and rounding, question invariant, generator composition, fixed mastery and SRS values |
| Integration tests | owner concealment, idempotency, answer rollback, import atomic commit/rollback, malformed input |
| Contract tests | OpenAPI operation/response/security gates, required idempotency, pre-answer schema/runtime leakage check |
| Full attempt E2E | registration through result/review/dashboard/logout in the transport-independent application |
| Fixed fixtures/seeds | versioned JSON dataset and performance profile; no production data |
| Performance baseline | repeatable Full-bank-scale selection and dashboard projection with p95 regression budgets |
| CI suite | separate Python, frontend and PostgreSQL 15 jobs; no retry masking |

## Critical finding and correction

The Stage 12 base DDL already owns `import_batches` with legacy columns/statuses. Stage 23 v1.0 defines the same name with a different schema. On a fresh database the second `CREATE TABLE IF NOT EXISTS` becomes a no-op, then `idx_s23_import_batches_raw_hash` fails because `raw_sha256` is absent. This was not caught by the Stage 23 static validator.

Because project status records no live execution of Patch 007, Stage 24 introduces a safe replacement, `007_stage23_import_pipeline_v1.1.sql`, with `question_import_batches`, `question_import_batch_rows` and `question_import_batch_events`. The historical v1.0 file is preserved and explicitly excluded from the executable migration plan. The replacement performs no `DROP TABLE` or `TRUNCATE`.

## Executed evidence

- Integrated Python: 179 discovered; 177 passed; 2 PostgreSQL tests explicitly skipped without DSN.
- Dedicated Stage 24: 17 discovered; 15 passed; the same 2 PostgreSQL tests skipped.
- Frontend Vitest: 8/8 passed, including the new full runner lifecycle.
- Local synthetic performance: selection p95 210.621 ms; dashboard p95 18.308 ms; both below the 1,500 ms reference guardrail.
- Baseline Stage 23 before changes: 162/162 Python passed; Stage 22 frontend validation passed.

## Non-claims and dependencies

- No live PostgreSQL migration result is claimed. The executable CI/profile is supplied.
- No deployed HTTP or real-browser E2E result is claimed; the baseline has no complete routed/deployed API.
- No production performance SLA is claimed; the measurement is in-memory and synthetic.
- No real learner/content validation is claimed because the repository has zero `PUBLISHED` inventory.
- Formal Iman acceptance remains pending.

## Readiness

The Stage 24 reference test system is ready for owner review and for CI execution on a repository containing Stage 23. It is not marked fully production-ready until the PostgreSQL job and deployed Stage 26 HTTP/browser profiles produce evidence.

# Stage 24 test pyramid v1.0

## Policy

Critical risk scenarios are explicit gates. Coverage percentage is supplementary and cannot replace them. Fixtures are deterministic, synthetic and non-production. CI performs no automatic retry: a flaky failure remains visible until its cause is fixed or the test is quarantined with an owner decision.

| Layer | Primary risks | Executable evidence | Environment |
|---|---|---|---|
| Unit | rounding drift, invalid answer key, wrong quota, mastery/SRS regression | `tests/test_stage24_unit.py` | pure Python |
| Integration | authorization, duplicate side effects, partial write/import | `tests/test_stage24_integration.py` | in-memory transactional adapters |
| Contract | response drift, answer leakage, auth/idempotency drift, migration collision | `tests/test_stage24_contract.py` | JSON/YAML/SQL plus runtime projection |
| E2E | broken learner journey | `tests/test_stage24_e2e.py` and `AttemptRunner.stage24.test.tsx` | in-process application plus jsdom component lifecycle |
| Performance | slow selection/dashboard at planned volume | `tests/test_stage24_performance.py` and runner | deterministic in-memory reference profile |
| Database integration | invalid migration sequence or missing constraints | `tests/test_stage24_postgres.py` | isolated PostgreSQL 15 schema in CI/live profile |

## Gate order

1. Parse and validate Stage 24 contracts, scenario inventory and migration plan.
2. Run all Python tests; the database profile must run when a DSN is present.
3. Run the fixed-volume performance guardrail.
4. Regenerate OpenAPI types, lint, type-check, run Vitest and build Next.js.
5. Apply the migration plan to an isolated PostgreSQL 15 schema.

## Evidence boundaries

The Python E2E scenario tests the full business journey without an HTTP transport because the supplied Stage 21 adapter does not expose a complete routed Django application. The frontend scenario tests the learner attempt component lifecycle in jsdom, not a deployed browser. Both are useful regression gates; neither is mislabeled as deployed E2E. Stage 26 must add deployed HTTP/browser evidence.

The performance dataset mirrors the planned Full bank volume (10,636) and knowledge-map scope count (304). Results are regression guardrails for this reference implementation, not latency SLOs. Stage 27 owns production calibration after a real inventory and traffic profile exist.

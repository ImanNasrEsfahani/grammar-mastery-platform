# Stage 26 release runbook v1.0

The sequence follows the roadmap release runbook and makes each gate auditable.

1. **CI green** — Stage 24 suite, Stage 25 security validation, Stage 26 validation, frontend validation and PostgreSQL fresh-schema rehearsal pass without retrying a failed assertion until it becomes green.
2. **Backup / restore point** — for production, create and record a recovery point before schema/application change. Verify that the backup mechanism is healthy; do not expose credentials in evidence.
3. **Migration dry run on staging** — verify exact canonical migration file identities and apply the sequence with `ON_ERROR_STOP` behavior to staging or an isolated production-like database.
4. **Deploy schema-compatible app** — deploy the immutable backend/frontend revision that is compatible with both pre- and post-migration state whenever practical.
5. **Execute migration** — use the automated migration runner; no manual production SQL. The historical Stage23 `007 ... v1.0` file is forbidden; only v1.1 is canonical.
6. **Health check** — readiness/database connectivity and configured health URL must pass.
7. **Smoke test** — check HTTPS, required security headers, frontend reachability and the safe API paths supported by the current inventory/runtime.
8. **Monitor metrics** — observe the initial release window and compare with pre-release baseline. Apply versioned rollback thresholds.
9. **Record release** — save release ID, git SHA, environment, migration result, recovery point ID, smoke/health evidence, provider bindings, timestamps and release notes. Never store secrets in the evidence file.
10. **Rollback on breach threshold** — use the rollback runbook; stop writes first when schema/data safety requires it.

Production promotion is prohibited while any required provider binding or security decision in `needs_decision_v1.0.csv` remains unresolved.

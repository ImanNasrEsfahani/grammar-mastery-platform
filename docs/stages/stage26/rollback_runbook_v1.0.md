# Stage 26 rollback runbook v1.0

## Triggers

Rollback is mandatory or strongly indicated for a failed migration, repeated failed health checks, security-header/TLS regression, release-linked 5xx breach, corrupted critical reads, or inability to prove a usable recovery point for a risky schema change.

## Decision tree

1. Freeze further promotion. If data integrity may be at risk, stop or drain writes before diagnosis.
2. Preserve structured non-secret logs and the release evidence record.
3. If the database schema remains backward compatible, roll the application revision back first and re-run health/smoke checks.
4. If schema/data is not safely backward compatible, restore the pre-release recovery point into a controlled environment, verify integrity, then cut over according to the provider's documented recovery procedure.
5. Never execute ad-hoc reverse SQL against production merely to make the version number look older.
6. Verify health, security headers, critical reads and audit availability after rollback.
7. Record actual RTO, data-loss window/RPO, cause, corrective action and whether the failed release may be retried.

The target RTO is 4 hours until measured evidence revises it. Provider-specific rollback commands belong in the selected deployment adapter, not in this provider-neutral package.

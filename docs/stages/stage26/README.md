# Stage 26 — Deploy, Production Operations, Backup and Monitoring

- Package: `grammar-mastery-stage26-v1.0`
- Contract: `stage26-operations-v1.0.0`
- Base main: `f5f281ed52c30667d02e7a8d40d0cbba6d537791`
- Owner: Iman
- Status: `REFERENCE_OPERATIONS_PACKAGE_VALIDATED_LIVE_DEPLOYMENT_EVIDENCE_BLOCKED`

This Stage 26-only overlay implements the roadmap's deployment/operations contract: three separated environments, a versioned PostgreSQL migration sequence, release gates, monitoring guardrails, backup/restore policy, auditable release evidence and rollback rules. It consumes Stage 24 test evidence and Stage 25 security/backup boundaries instead of duplicating them.

## Roadmap output mapping

| Roadmap output | Stage 26 artifact |
|---|---|
| Deployment pipeline | `.github/workflows/stage26-release-gate.yml`, `ops/stage26/migration_runner.py`, `ops/stage26/release_gate.py` |
| Environment matrix | `environment_matrix_v1.0.csv` + operations contract |
| Monitoring | `monitoring_policy_v1.0.md` + provisional thresholds in contract |
| Backup policy | `backup_policy_v1.0.md` + release evidence fields |
| Rollback runbook | `rollback_runbook_v1.0.md` and `release_runbook_v1.0.md` |

## What is validated now

The package has deterministic valid/invalid release-gate tests. It freezes the corrected PostgreSQL sequence through Stage23 v1.1 and explicitly rejects the superseded Stage23 v1.0 migration. It also rejects production release evidence without CI, staging rehearsal, a recovery point, HTTPS/security headers, health/smoke success, provider bindings, monitoring and a rollback path.

The default Stage26 data sequence now has a repository-native canonical Question Bank seed. The current seed catalog covers B001-B081 / L01-L18P04 with 3,640 DRAFT source rows; the canonical fresh-database bootstrap publishes those validated seed rows through the explicit SYSTEM workflow. PostgreSQL rehearsal and CI compare published/serving inventory to the applied canonical seed metadata rather than a hard-coded count.

## What is not claimed

No live production/staging environment, provider, DNS name, TLS edge, secret manager, malware scanner, monitoring service, production backup or measured restore drill was supplied. The canonical seed is available for a fresh PostgreSQL bootstrap, but real learner E2E and production operations evidence still require the deployed Django/PostgreSQL/browser stack. Therefore Stage 26 is **substantively complete as a reference operations package, but not production-ready/live-complete**.

See `needs_decision_v1.0.csv` for the exact inputs required to turn the reference package into measured deployment evidence.

## Validation commands

```bash
PYTHONPATH=src python tools/validate_stage26.py
PYTHONPATH=src python -m unittest tests.test_stage26_operations -v
python ops/stage26/release_gate.py ops/stage26/release_evidence_valid_example_v1.0.json
```

The two release-evidence example files are synthetic fixtures only: the valid example demonstrates the gate contract and the invalid example proves that a production release without a recovery point is rejected.

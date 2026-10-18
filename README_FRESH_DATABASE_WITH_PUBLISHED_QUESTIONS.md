# Question-bank bootstrap — safe current guidance

> **SAFETY NOTICE — REPLACES A HISTORICAL DESTRUCTIVE RUNBOOK.** This document used to include commands that dropped/recreated a database and expected 3,640 published questions. Those instructions were specific to an earlier development snapshot and must **not** be reused on the live customer database. The previous version remains recoverable through Git history.

## Current facts

- The [canonical repository seed catalog](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json) lists **10,636 DRAFT source question records across 52 lesson files** and B001–B238.
- The [static validation record](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json) documents schema/content consolidation checks; it does **not** establish actual production published/serving totals.
- `ops/question_bank/bootstrap.py` reads the canonical catalog and requires consistency with the Stage 23 manifest-drift marker. The **standard Stage 23 Import/Preview/Commit** path is a separate workflow; it cannot be pronounced unblocked just because canonical seed loading is available.
- Grammar Mastery is **LIVE / IN USE** with real customers according to its owner. Therefore preserving existing users, sessions, attempts, answers, mastery history and production data is mandatory.

## Safe steps before any migration or publication change

1. Capture the exact deployed Git SHA, expected source catalog version, source row count and running Docker image digests.
2. Run `python tools/audit_project_static.py --root .` on a clean checkout.
3. On the authorized application server, run `bash tools/report_production_counts.sh` **read-only** to measure actual counts.
4. Produce a dated, encrypted PostgreSQL backup; verify it can be listed/restored in an **isolated** database without affecting production.
5. Rehearse versioned migration/seed changes on a **separate staging database** populated with a suitable sanitized dataset. Inspect idempotency, content fingerprints and preservation of historical answers.
6. Run API/browser E2E and source/import integrity tests against staging.
7. Obtain explicit release approval and a documented rollback plan before any production write. Follow the [Stage 26 runbook](docs/stages/stage26/release_runbook_v1.0.md) and [release verification checklist](docs/verification/PRODUCTION_VERIFICATION.md).

The **plan-only** migration command in the repository can be reviewed without a destructive execution flag:

```bash
python ops/stage26/migration_runner.py --target staging
```

Its exact environment and prerequisite behavior depend on the current checkout. Consult its `--help` and the source before running. **Do not add `--execute`, perform `dropdb`, or use `docker compose down -v` on the live instance as part of a documentation update.**

## Determining the correct expected count

The current repository source baseline is **10,636**, but no constant should be used to rewrite or assert the live database total. Query PostgreSQL and compare `PUBLISHED`, `v_serving_questions`, and canonical seed version metadata. A delta can reflect a legitimate separately deployed source subset, pending publication, or a drift requiring investigation.

If you discover drift, document the deployed commit, image tag, catalog SHA, data migration history and real DB counts first. Resolve it through a reviewed, reversible procedure; never silently edit a published question or reset active learner history.

## Where to continue

- [Current project status](STATUS.md)
- [Standard Import blocker and evidence](docs/verification/QUESTION_BANK_IMPORT_STATUS.md)
- [Stage 26 runbook](docs/stages/stage26/release_runbook_v1.0.md)
- [Production verification checklist](docs/verification/PRODUCTION_VERIFICATION.md)
- [Release approval record](docs/verification/RELEASE_ACCEPTANCE_RECORD.md)

This document **does not claim** that source data was migrated, that the live database was inspected, or that Stage 23 was fixed. It intentionally prevents outdated destructive instructions from being mistaken for a production-approved procedure.

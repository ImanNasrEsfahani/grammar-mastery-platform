# Question Bank Bootstrap v1.0

This package provides the repository-native, idempotent Question Bank bootstrap/publish command. It intentionally does **not** reset PostgreSQL and does **not** use Stage23 Import/Preview/Commit while `STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT` remains active.

## What it reads

- `data/question_authoring/stage6/stage6_question_type_catalogue_reference_v1.0.csv`
- `data/question_authoring/stage6/stage6_lesson_type_compatibility_recovered_v1.0.csv`
- `data/question_authoring/stage6/stage6_subtopic_type_compatibility_recovered_v1.0.csv`
- `data/question_authoring/stage7/stage7_misconception_catalogue_v0.9.csv`
- `data/question_bank/full/v1.0/master/question_bank_seed_catalog.json` when present
- every exact Stage10 CSV listed in the catalog's `sources` array
- the consolidation validation JSON named by the catalog

The current catalog combines these flat `master/` sources:

- `question_bank_full_B001_B041_L01_L09.csv` — 1,806 rows
- `question_bank_full_B042_B081_L10_L18P04.csv` — 1,834 rows

Current canonical repository seed total: **3,640 rows**.

Backward compatibility is preserved. If the catalog is absent, the bootstrap falls back to the historical behavior of discovering exactly one `question_bank_full_*.csv`. Supplying `--master` explicitly also selects one CSV and its matching validation as before.

No `/tmp`, `docker cp`, or shell `COPY` is used. All CSVs are read by Python directly from the versioned repository data copied into the backend image.

## Prerequisite

The Stage12 relational schema and canonical Stage1/2/3 reference seed must already exist. This is deliberate: production database migrations remain under the official Stage26 controlled migration workflow, and persistent production data must never be erased on container restart.

## Import / repair / machine-validation only

```bash
docker compose --env-file .env.docker exec -T backend \
  python ops/question_bank/bootstrap.py
```

This reconciles Stage6 and historical Stage7 IDs, imports or repairs DRAFT Question Bank rows, checks the live database gate, and records machine-validation PASS. It does not claim human review and does not publish.

## Default fresh-database migration

The canonical Stage26 migration runner executes this command automatically after
the SQL schema and Stage12 reference seed:

```bash
python ops/stage26/migration_runner.py \
  --target staging \
  --execute \
  --confirm-release-id rehearsal-YYYYMMDD
```

Its Question Bank phase is equivalent to:

```bash
python ops/question_bank/bootstrap.py --publish-canonical-seed
```

That mode publishes all validated catalog seed rows with an explicit SYSTEM actor and audit marker. It does not claim independent human review. The repository CSV sources stay DRAFT; the database rows finish PUBLISHED and serving. The applied `system_versions` metadata records the catalog-derived `question_count`, and Stage26/CI use that metadata instead of a hard-coded inventory count.

Use `--schema-only` on the migration runner only when you intentionally need schema without canonical data.

## Publish after real independent human review

```bash
docker compose --env-file .env.docker exec -T backend \
  python ops/question_bank/bootstrap.py \
  --publish-reviewed \
  --reviewer-external-id iman-reviewer-v1.0 \
  --confirm-human-review
```

`--confirm-human-review` is an explicit operator attestation. The script then performs the schema-enforced workflow in order: `DRAFT -> READY_FOR_REVIEW -> APPROVED -> PUBLISHED`, creates/reuses an explicit publish batch, writes status events and an audit record, and reports serving count.

The command is transactionally atomic. On any error the current run rolls back.

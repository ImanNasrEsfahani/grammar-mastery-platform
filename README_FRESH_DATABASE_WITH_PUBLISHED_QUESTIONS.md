# Fresh database migration with published questions

The default Stage26 migration is a complete database bootstrap:

1. apply the eight canonical PostgreSQL schema migrations (001-008);
2. seed the canonical Stage1/2/3 reference data;
3. load the repository-native Question Bank seed catalog, import and machine-validate all 3,640 canonical rows for B001-B081 / L01-L18P04, and publish them through the canonical SYSTEM workflow.

The repository CSV sources remain `DRAFT`. Database rows are moved through the schema
gates and finish as `PUBLISHED`. Automatic migration publication uses the
`canonical-question-bank-publisher-v1.0` SYSTEM actor and explicitly records
`human_review_claimed=false`.

The Question Bank seed is intentionally split into versioned Stage10 CSV sources under
`data/question_bank/full/v1.0/master/`. `question_bank_seed_catalog.json` defines which
sources belong to the canonical fresh-install seed. This avoids requiring one ever-growing
CSV while keeping the normal Stage26 installation flow unchanged.

Stage23 Import/Preview/Commit is **not** part of this seed path and remains blocked by
`STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT`.

## Before changing the server database

This procedure replaces the current database. It removes users, sessions,
attempts, answers, mastery history, and any server-only content. First create and
verify a backup:

```bash
cd /var/www/grammar-mastery
export BACKUP_ID="pre-fresh-bootstrap-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups

docker compose --env-file .env.docker exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/${BACKUP_ID}.dump"

test -s "backups/${BACKUP_ID}.dump"
docker compose --env-file .env.docker exec -T postgres pg_restore -l \
  < "backups/${BACKUP_ID}.dump" > "backups/${BACKUP_ID}.list"
test -s "backups/${BACKUP_ID}.list"
sed -n '1,20p' "backups/${BACKUP_ID}.list"
```

Do not continue if the dump is empty or `pg_restore -l` cannot read it.

## Pull and rebuild

```bash
git fetch origin
git switch main
git pull --ff-only origin main
docker compose --env-file .env.docker build --pull backend frontend
```

The backend image must be rebuilt because it contains the versioned Question Bank
seed inputs and bootstrap code.

## Rehearse on an isolated database first

Create a separate empty rehearsal database on the same PostgreSQL service:

```bash
docker compose --env-file .env.docker exec -T postgres sh -lc '
  set -eu
  dropdb --if-exists -U "$POSTGRES_USER" grammar_mastery_rehearsal
  createdb -U "$POSTGRES_USER" grammar_mastery_rehearsal
'

docker compose --env-file .env.docker run --rm \
  -e PGDATABASE=grammar_mastery_rehearsal \
  -e DJANGO_DB_NAME=grammar_mastery_rehearsal \
  --entrypoint python \
  backend ops/stage26/migration_runner.py \
  --target staging \
  --execute \
  --confirm-release-id "rehearsal-${BACKUP_ID}"
```

Verify the rehearsal result:

```bash
docker compose --env-file .env.docker exec -T postgres sh -lc '
  psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d grammar_mastery_rehearsal \
    -c "SELECT status,count(*) FROM questions GROUP BY status ORDER BY status;" \
    -c "SELECT count(*) AS serving_questions FROM v_serving_questions;" \
    -c "SELECT component,version,status,metadata FROM system_versions WHERE component IN ('"'"'stage12.reference_seed'"'"','"'"'question_bank.canonical_seed'"'"') ORDER BY component;"
'
```

Expected current canonical seed counts are `PUBLISHED = 3640` and
`serving_questions = 3640`. The Stage26 rehearsal gate and CI derive the expected
count from `system_versions.metadata.question_count`, so later Question Bank seed
extensions do not require another hard-coded count change.

## Recreate production and run the canonical bootstrap

The following database recreation is destructive and is appropriate only when
you intentionally want a clean server database and have verified the backup:

```bash
docker compose --env-file .env.docker stop backend frontend

docker compose --env-file .env.docker exec -T postgres sh -lc '
  set -eu
  case "$POSTGRES_DB" in
    ""|postgres|template0|template1)
      echo "Refusing unsafe production database name: $POSTGRES_DB" >&2
      exit 2
      ;;
  esac
  dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
'

docker compose --env-file .env.docker run --rm \
  --entrypoint python \
  backend ops/stage26/migration_runner.py \
  --target production \
  --execute \
  --bootstrap-empty-production \
  --bootstrap-rehearsal-db grammar_mastery_rehearsal \
  --backup-id "$BACKUP_ID" \
  --confirm-release-id "fresh-production-${BACKUP_ID}"

docker compose --env-file .env.docker up -d backend frontend
```

Finally verify production:

```bash
docker compose --env-file .env.docker exec -T postgres sh -lc '
  psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "SELECT status,count(*) FROM questions GROUP BY status ORDER BY status;" \
    -c "SELECT count(*) AS serving_questions FROM v_serving_questions;" \
    -c "SELECT count(*) AS lessons FROM grammar_lessons;" \
    -c "SELECT count(*) AS subtopics FROM grammar_subtopics;" \
    -c "SELECT component,version,status,metadata FROM system_versions WHERE component='"'"'question_bank.canonical_seed'"'"';"
'
```

Expected current essentials: 52 lessons, 304 subtopics, 3,640 `PUBLISHED`
questions, 3,640 serving questions, and canonical seed metadata with
`question_count = 3640`.

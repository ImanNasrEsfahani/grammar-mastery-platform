# Fresh database migration with published questions

The default Stage26 migration is now a complete database bootstrap:

1. apply the eight canonical PostgreSQL schema migrations (001-008);
2. seed the canonical Stage1/2/3 reference data;
3. import, machine-validate, audit, and publish the 1,806 repository Question Bank rows for L01-L09.

The repository CSV remains `DRAFT`. Database rows are moved through the schema
gates and finish as `PUBLISHED`. Automatic migration publication uses the
`canonical-question-bank-publisher-v1.0` SYSTEM actor and explicitly records
`human_review_claimed=false`.

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

The backend image must be rebuilt because it now contains the versioned
Question Bank migration inputs.

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

Expected counts are `PUBLISHED = 1806` and `serving_questions = 1806`.

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
    -c "SELECT count(*) AS subtopics FROM grammar_subtopics;"
'
```

Expected essentials: 52 lessons, 304 subtopics, 1,806 PUBLISHED questions, and
1,806 serving questions.

# Grammar Mastery — Canonical Knowledge/Taxonomy Seed v1

This patch is a one-time operational seed for the already-migrated Stage 12
PostgreSQL schema. It does **not** merge stage deliverables and it does **not**
introduce a schema migration.

It exists because production currently has:

```text
grammar_lessons   = 0
grammar_subtopics = 0
PUBLISHED questions = 0
```

The Stage 12 DDL correctly created the tables, but DDL does not populate the
canonical Stage 1/2/3 reference rows.

## What this seed writes

Only these reference tables:

- `grammar_categories` — 11 categories + 27 subcategories
- `tags` — 35 controlled tags
- `grammar_lessons` — 52 lessons
- `grammar_subtopics` — 304 atomic subtopics
- `lesson_tags` — the canonical Stage 2 lesson/tag assignments
- one provenance marker in `system_versions`

It does **not** touch:

- `users`
- `user_credentials`
- `user_role_assignments`
- `auth_sessions`
- questions
- tests/attempts/answers
- mastery/review data

## Pinned canonical inputs

The seed reads the repository's existing versioned CSVs and verifies their Git
blob identities before any write:

- `data/knowledge/stage1_lessons_v1.0.csv`
- `data/knowledge/stage1_subtopics_v1.0.csv`
- `data/taxonomy/stage2_categories_v1.0.csv`
- `data/taxonomy/stage2_subcategories_v1.0.csv`
- `data/taxonomy/stage2_controlled_tags_v1.0.csv`
- `data/taxonomy/stage2_lesson_category_mapping_v1.0.csv`
- `data/taxonomy/stage2_lesson_tags_v1.0.csv`
- `data/planning/stage3_lesson_weights_v1.0.csv`

The Stage 3 `final_weight_pct` values are loaded into
`grammar_lessons.tcf_weight`; the script requires exactly 52 weight rows and a
total of exactly `100.00`.

## Safety behavior

- dry-run by default
- production execution requires a backup id and confirmation id
- source identities are verified before connecting/writing
- target reference tables must all be empty
- partial/non-empty reference state causes a hard stop
- all inserts and post-insert validations run in one PostgreSQL transaction
- failure rolls back the complete seed
- an advisory transaction lock prevents two concurrent seed runs
- the script does not use upsert/merge behavior
- a successful prior seed marker prevents reseeding

## Deploy the patch first

After adding this ZIP to GitHub `main`:

```bash
cd /var/www/grammar-mastery
git fetch origin
git reset --hard origin/main
git status

docker compose build --no-cache backend
docker compose up -d --no-deps --force-recreate backend
docker compose ps backend
```

The backend is rebuilt because the Docker image must contain the pinned
canonical CSV inputs. This seed patch does not change the HTTP runtime version.

## 1. Validate inputs without writing

```bash
docker compose exec backend python ops/stage12/seed_canonical_reference.py \
  --target production
```

Expected top-level result:

```json
{
  "status": "DRY_RUN",
  "writes_performed": false
}
```

It should report:

```text
categories    11
subcategories 27
tags          35
lessons       52
subtopics     304
```

If any source identity mismatch appears, stop. Do not change the pinned hashes
just to make the command pass.

## 2. Take a new production backup

Use a **new** backup because Auth/user data was created after the earlier
pre-schema backup:

```bash
cd /var/www/grammar-mastery
mkdir -p backups

export BACKUP_ID="pre-reference-seed-$(date -u +%Y%m%dT%H%M%SZ)"

docker compose exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/${BACKUP_ID}.dump"

test -s "backups/${BACKUP_ID}.dump" && echo "backup file exists"

cat "backups/${BACKUP_ID}.dump" \
  | docker compose exec -T postgres pg_restore -l \
  | sed -n '1,20p'
```

Do not proceed if the dump is empty or `pg_restore -l` cannot read it.

## 3. Execute the one-time seed

```bash
export SEED_ID="canonical-reference-20260809"

docker compose exec backend python ops/stage12/seed_canonical_reference.py \
  --target production \
  --execute \
  --backup-id "$BACKUP_ID" \
  --confirm-seed-id "$SEED_ID"
```

Expected:

```text
status = PASS
seed_version = canonical-knowledge-taxonomy-seed-v1.0.0
lessons = 52
subtopics = 304
```

## 4. Verify PostgreSQL

```bash
docker compose exec postgres sh -lc '
psql -P pager=off -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
-c "SELECT count(*) AS taxonomy_nodes FROM grammar_categories;" \
-c "SELECT count(*) AS lessons FROM grammar_lessons;" \
-c "SELECT count(*) AS subtopics FROM grammar_subtopics;" \
-c "SELECT count(*) AS tags FROM tags;" \
-c "SELECT sum(tcf_weight) AS tcf_weight_total FROM grammar_lessons;" \
-c "SELECT component,version,status FROM system_versions WHERE component='\''stage12.reference_seed'\'';"
'
```

Expected essentials:

```text
taxonomy_nodes 38
lessons        52
subtopics      304
tags           35
tcf_weight_total 100.0000
```

## 5. Verify the runtime lesson API

Get a fresh bearer token and run:

```bash
curl -i 'http://127.0.0.1:8005/api/v1/lessons?page[size]=100' \
  -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP `200`, 52 active lesson rows, ordered by `lesson_no`.

The current question bank remains at zero `PUBLISHED` questions, so
`POST /api/v1/tests` should still fail safely with
`422 NO_ELIGIBLE_QUESTIONS`. This seed intentionally does not create questions.

## If execution says reference tables are not empty

Stop. Do not delete rows, truncate tables, or manually merge CSV data. Inspect
the counts and the `stage12.reference_seed` marker first. The script is designed
to refuse ambiguous partial state rather than guessing how to repair it.

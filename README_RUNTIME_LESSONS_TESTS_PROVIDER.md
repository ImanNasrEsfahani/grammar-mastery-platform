# Grammar Mastery — Lessons + Test Creation Runtime Provider v1

This is an independent runtime patch. It does not aggregate earlier stage
packages.

It binds exactly these Stage 21 operations:

- `GET /api/v1/lessons`
- `GET /api/v1/lessons/{lessonId}`
- `POST /api/v1/tests`

Existing Auth, Dashboard and Next Action providers remain intact.

## Contract/source basis

The patch follows the frozen Stage 21 OpenAPI response/request shapes and the
Stage 13/14 reference engines already present in the repository.

Stage 13 rules retained by the runtime adapter:

- current exact revision only
- `PUBLISHED` only
- active lesson/subtopic/question type
- exact four-option snapshot and a non-null correct option
- compatibility is `PREFERRED`/`ALLOWED`, or guarded `CONDITIONAL`
- stable UUID scope
- deterministic seed streams
- strict shortage failure; no unpublished fallback
- exact test/question snapshot persistence

Adaptive mode uses `adaptive.selector.select_adaptive`; custom/TCF use
`test_generator.generator.generate_plan`.

`review` and `mistakes` modes remain an explicit later runtime dependency and
return `503 DEPENDENCY_UNAVAILABLE` until the Review provider is bound.

## Important production-data boundary

The Stage 12 PostgreSQL migration creates the relational schema. It does not
seed the canonical Stage 1/2 lesson/taxonomy CSV rows into `grammar_lessons`
and `grammar_subtopics`.

Therefore this provider never fabricates the 52 lessons. It returns only rows
actually present in PostgreSQL.

Before claiming that `/lessons` returns 52 rows, verify:

```bash
docker compose exec postgres sh -lc '
psql -P pager=off -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
-c "SELECT count(*) AS lessons FROM grammar_lessons;" \
-c "SELECT count(*) AS subtopics FROM grammar_subtopics;" \
-c "SELECT count(*) AS published_questions FROM questions WHERE status='\''PUBLISHED'\'';"
'
```

If lessons/subtopics are zero, stop there. Do not insert rows manually in
production. A separate checksum-validated canonical knowledge/taxonomy seed
package should load the repository's versioned Stage 1/2 data.

This patch intentionally keeps that data-loading concern separate.

## Test creation and current zero-question state

The current project status records zero `PUBLISHED` inventory. With a valid
authenticated request, `POST /api/v1/tests` should therefore return:

```text
HTTP 422
NO_ELIGIBLE_QUESTIONS
```

This is a successful safe failure, not a runtime-provider 503.

No `tests`, `test_questions`, or completed idempotency record is left behind
when selection fails because the operation is transactional.

When eligible inventory exists later, successful test creation:

1. validates the Stage 21 request
2. resolves stable UUID scope
3. applies Stage 13 or Stage 14 selection
4. freezes exact question and option snapshots
5. writes `tests` + `test_questions`
6. completes `api_idempotency_records` in the same PostgreSQL transaction
7. returns the Stage 21 `TestEnvelope`

The `Idempotency-Key` is required and a repeated identical successful request
replays the stored response rather than creating a second test.

## Deploy

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

No migration is introduced by this patch.

Health:

```bash
curl -i http://127.0.0.1:8005/health/ready
```

Expected runtime:

```text
docker-runtime-v1.0.4-postgres-lessons-tests
```

## Get a fresh token

```bash
TOKEN="$(curl -s -X POST http://127.0.0.1:8005/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test-password-123"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])')"
```

## Lesson smoke tests

```bash
curl -i 'http://127.0.0.1:8005/api/v1/lessons?page[size]=100' \
  -H "Authorization: Bearer $TOKEN"
```

If PostgreSQL has the canonical lessons loaded, this returns them in
`lesson_no` order.

For one real lesson UUID returned above:

```bash
LESSON_ID='<UUID_FROM_LIST>'

curl -i "http://127.0.0.1:8005/api/v1/lessons/$LESSON_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## Test creation smoke test

Use the same payload currently emitted by the Stage 22 frontend:

```bash
IDEM_KEY="$(python3 -c 'import uuid; print(uuid.uuid4())')"

curl -i -X POST http://127.0.0.1:8005/api/v1/tests \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{
    "schema_version":"adaptive-selection-config-v0.9.0",
    "mode":"adaptive",
    "question_count":10,
    "scope":{"all_active_lessons":true},
    "difficulty_mix_pct":{"EASY":20,"MEDIUM":40,"HARD":30,"VERY_HARD":10}
  }'
```

With the current zero-`PUBLISHED` bank, expected:

```text
HTTP/1.1 422
error.code = NO_ELIGIBLE_QUESTIONS
```

That proves `/tests` is bound to the real provider even though content
publication is still the upstream blocker.

## Scope boundary after this patch

Still intentionally unbound:

- `GET /tests/{testId}`
- `POST /tests/{testId}/attempts`
- attempt runner/answer/result operations
- review runtime
- detailed mastery/progress runtime
- admin runtime providers not already bound

The next useful runtime patch after this one is normally test retrieval +
attempt start + next-question delivery, but only after the lesson seed state is
known and before claiming a complete learner flow.

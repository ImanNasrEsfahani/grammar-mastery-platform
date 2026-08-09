# Empty-production bootstrap patch

This patch adds a narrow `--bootstrap-empty-production` mode to the Stage 26
migration runner.

It is intended only for a pre-launch production database whose `public` schema
has zero relations. It does not relax the normal Stage 26 production gate for
an existing production database.

Required checks before execution:

1. Canonical migration file identities still match the Stage 26 contract.
2. `--backup-id` is present.
3. The production target's `public` schema contains zero tables/views/sequences.
4. A separate rehearsal database exists and contains the expected Stage 21 and
   Stage 23 terminal schema/version markers.
5. The rehearsal DB name is not the production DB name.

After merging and rebuilding the backend:

docker compose exec backend python ops/stage26/migration_runner.py \
  --target production \
  --execute \
  --bootstrap-empty-production \
  --bootstrap-rehearsal-db grammar_mastery_rehearsal_20260809 \
  --confirm-release-id "production-bootstrap-20260809" \
  --backup-id "<REAL_BACKUP_ID>"

Never use the literal placeholder `<REAL_BACKUP_ID>`.

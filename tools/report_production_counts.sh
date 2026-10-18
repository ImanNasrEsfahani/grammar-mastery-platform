#!/usr/bin/env bash
# Aggregate, read-only counts from an AUTHORIZED Grammar Mastery Docker host.
# No user rows, credentials, migrations, writes, or content exports.
set -euo pipefail
ENV_FILE="${GMP_ENV_FILE:-.env.docker}"
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is unavailable on this host" >&2
  exit 2
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found (run from authorized deployment root)" >&2
  exit 2
fi
cat >&2 <<'NOTICE'
Read-only aggregate report. No live data is changed.
Counts below reflect the CONNECTED SERVER, not necessarily the repository catalog.
Do not publish server IPs, connection details or credentials.
NOTICE

docker compose --env-file "$ENV_FILE" exec -T postgres sh -lc '
  set -eu
  export PGOPTIONS="-c default_transaction_read_only=on"
  psql -X -v ON_ERROR_STOP=1 -P pager=off \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "SELECT count(*) AS lessons FROM grammar_lessons;" \
    -c "SELECT count(*) AS subtopics FROM grammar_subtopics;" \
    -c "SELECT status, count(*) AS questions FROM questions GROUP BY status ORDER BY status;" \
    -c "SELECT count(*) AS serving_questions FROM v_serving_questions;" \
    -c "SELECT component, version, status, metadata FROM system_versions WHERE component = '\''question_bank.canonical_seed'\'';"
'

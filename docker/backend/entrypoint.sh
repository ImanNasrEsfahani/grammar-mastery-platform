#!/bin/sh
set -eu

# Deliberately do NOT run database migrations here. Stage 26 requires staging
# rehearsal and a production recovery point before production migration.
python -m django check --settings="${DJANGO_SETTINGS_MODULE:-gmp_runtime.settings}"

exec gunicorn \
  --config /app/docker/backend/gunicorn.conf.py \
  gmp_runtime.wsgi:application

# Docker deployment overlay — Linux server

Package: `grammar-mastery-docker-runtime-v1.0`

## Scope

This overlay starts:

- PostgreSQL 15 on an internal Docker network with a persistent volume.
- the selected Django 5.2 / DRF backend runtime under Gunicorn.
- the existing Next.js 16 frontend under Node 24.

It intentionally **does not fabricate the missing Stage 21 HTTP resource views**. The current repository's Stage 26 package explicitly records `S26_B01_DJANGO_HTTP` as `NOT_EVIDENCED`. The Docker runtime therefore adds only deployable Django process/settings wiring and `/health/live` + `/health/ready`. Backend API-dependent frontend flows remain unavailable until the real Stage 21 HTTP surface is implemented.

It also intentionally **does not auto-run migrations** at container startup. Stage 26 requires a staging rehearsal and a production recovery point before production migration.

## Add these files to the repository

Copy this archive's contents into the repository root, preserving paths. No Stage 1–27 package is replaced or merged.

## First start (server preview / staging)

```bash
cp docker.env.example .env.docker
# Edit .env.docker and replace every CHANGE_ME value.

docker compose --env-file .env.docker config
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d

docker compose --env-file .env.docker ps
curl -fsS http://127.0.0.1:8000/health/live
curl -fsS http://127.0.0.1:8000/health/ready
curl -I http://127.0.0.1:3000/
```

By default the backend and frontend bind to `127.0.0.1`, which is appropriate when Nginx/Caddy on the Linux host terminates HTTPS. For a temporary direct test only, set `FRONTEND_BIND=0.0.0.0` in `.env.docker` and firewall the port appropriately. The backend should normally remain private.

## Database migration policy

The existing Stage 26 migration runner is available inside the backend image because the image contains `ops/`, `config/`, `database/`, `psql`, and libpq variables.

Plan-only check:

```bash
docker compose --env-file .env.docker run --rm backend \
  python ops/stage26/migration_runner.py --target staging
```

Staging execution still requires a deliberate release id:

```bash
docker compose --env-file .env.docker run --rm backend \
  python ops/stage26/migration_runner.py \
  --target staging --execute --confirm-release-id STAGING-YYYYMMDD-001
```

Do not convert this into an automatic entrypoint migration. Production execution must continue to satisfy the existing Stage 26 backup and accepted staging-evidence gates.

### Current Stage 27 migration note

The current repository also contains `database/postgres/008_stage27_calibration_v1.0.sql`, while the Stage 26 canonical migration contract predates Stage 27. Do not silently append that file to the frozen Stage 26 sequence for production. Revise/version the operational migration plan before a real production release.

## Reverse proxy / HTTPS

This archive does not guess a domain, DNS provider, TLS provider, or existing host reverse-proxy setup. Point your HTTPS reverse proxy to `127.0.0.1:3000` for the public application. If you need direct operational health routing, proxy a dedicated health URL to `127.0.0.1:8000/health/ready` without publishing the backend API port broadly.

The Stage 25/26 security-header contract should be applied at the final public edge. Do not weaken the frozen CSP merely to make a generic proxy example work; Next.js CSP should be implemented with a compatible nonce/hash strategy when production TLS/origins are selected.

## Backups

The Docker named volume `postgres_data` is persistent storage, **not a backup**. Stage 26 requires scheduled encrypted backups outside the primary failure domain and periodic measured restore drills. Bind the final backup mechanism only after the backup target/provider is selected.

## Useful operations

```bash
# Logs
docker compose --env-file .env.docker logs -f backend
docker compose --env-file .env.docker logs -f frontend

# Rebuild after pulling new code
docker compose --env-file .env.docker build --pull
docker compose --env-file .env.docker up -d

# Stop without deleting PostgreSQL data
docker compose --env-file .env.docker down

# WARNING: this deletes the PostgreSQL volume and all database data.
# docker compose --env-file .env.docker down -v
```

## Remaining live-production inputs

A real production deployment still needs the Stage 26 owner inputs: public origin/domain and TLS edge, backup destination, production secret/signing-key store, monitoring/alert provider, upload malware scanner, MFA enforcement, retention approval, and measured RPO/RTO evidence. The most important code blocker is the full deployable Stage 21 Django HTTP API surface.

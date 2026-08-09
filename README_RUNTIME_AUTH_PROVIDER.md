# Grammar Mastery — PostgreSQL Runtime Auth Provider v1

This patch binds the three Stage 21 authentication operations to the canonical
PostgreSQL schema that was already created by migrations 001–007.

## Scope

Bound now:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `STAGE21_TOKEN_VERIFIER` for bearer authentication

Still intentionally unbound in this patch:

- learning/content/test/dashboard/admin providers other than authentication

Therefore, after a successful login, `/api/v1/dashboard` can still return
`503 DEPENDENCY_UNAVAILABLE` until its own provider is implemented. That is
separate from authentication.

## Canonical storage

No new migration is required. This patch uses the existing tables:

- `users`
- `user_credentials`
- `user_role_assignments`
- `auth_sessions`

New registration always receives only the `USER` role.

## Security profile

- New passwords: Django `Argon2PasswordHasher` / Argon2id.
- Legacy Stage 21 PBKDF2 reference hashes can be verified as a migration bridge
  and are upgraded to Argon2id after successful login.
- Access token: JWT HS256, 15 minutes by default.
- Server-side session: 30 days by default and immediately revocable.
- Required claims: `iss`, `aud`, `sub`, `sid`, `roles`, `iat`, `exp`, `jti`.
- Current and optional previous signing keys are selected by non-secret `kid`.
- Active user, active session and current role assignments are checked on every
  bearer-authenticated request.
- Five consecutive bad passwords lock an existing account for 15 minutes while
  responses remain generic.
- Public registration cannot inject staff roles.

The Stage 25 source-IP rate-limit policy still belongs at a shared edge/rate
limit layer; this patch does not use per-Gunicorn-worker in-memory counters.

## Required server secret — do not commit it

Before recreating the backend, add a signing key to the server's existing
`.env.docker`:

```bash
cd /var/www/grammar-mastery
printf '\nSTAGE21_JWT_SIGNING_KEY=%s\n' "$(openssl rand -hex 32)" >> .env.docker
printf 'STAGE21_JWT_KEY_ID=auth-20260809-v1\n' >> .env.docker
```

Check that each key appears only once in `.env.docker` before deployment.

Optional rotation overlap variables:

```text
STAGE21_JWT_PREVIOUS_SIGNING_KEY=
STAGE21_JWT_PREVIOUS_KEY_ID=
```

Do not put `.env.docker`, tokens or key values in Git.

## Deploy after this patch is committed to main

```bash
cd /var/www/grammar-mastery
git fetch origin
git reset --hard origin/main

docker compose build --no-cache backend
docker compose up -d --no-deps --force-recreate backend
docker compose ps backend
```

Health should report the new runtime:

```bash
curl -i http://127.0.0.1:8005/health/ready
```

Expected runtime value:

```text
docker-runtime-v1.0.2-postgres-auth
```

## Register a real learner

```bash
curl -i -X POST http://127.0.0.1:8005/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test-password-123"}'
```

Expected: HTTP `201` with a `UserEnvelope`.

A repeated registration for the same email should return HTTP `409`.

## Login

```bash
curl -i -X POST http://127.0.0.1:8005/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test-password-123"}'
```

Expected: HTTP `200` with `access_token`, `token_type=Bearer`,
`expires_in=900`, and `session_id`.

## Verify database records

```bash
docker compose exec postgres sh -lc '
psql -P pager=off -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
-c "SELECT id,email,status FROM users ORDER BY created_at DESC LIMIT 5;" \
-c "SELECT user_id,password_algorithm,failed_attempt_count,locked_until FROM user_credentials ORDER BY created_at DESC LIMIT 5;" \
-c "SELECT user_id,role_code,revoked_at FROM user_role_assignments ORDER BY granted_at DESC LIMIT 5;" \
-c "SELECT id,user_id,status,issued_at,expires_at FROM auth_sessions ORDER BY created_at DESC LIMIT 5;"
'
```

## Logout/revocation smoke test

Get a fresh token:

```bash
TOKEN="$(curl -s -X POST http://127.0.0.1:8005/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test-password-123"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])')"
```

Logout:

```bash
curl -i -X POST http://127.0.0.1:8005/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP `204`.

Reusing that token on an authenticated route should return
`401 SESSION_REVOKED` before the route provider executes.

## No migration rerun

Do not rerun migrations for this auth patch. The patch is deliberately built on
the canonical Stage 21 tables already created by the completed production
bootstrap.

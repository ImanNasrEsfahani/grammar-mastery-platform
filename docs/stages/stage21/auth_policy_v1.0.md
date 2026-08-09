# Stage 21 Authentication and Authorization Policy

**Version:** `auth-policy-v1.0.0`  
**Owner:** Iman  
**Prepared:** 2026-08-09 UTC  
**Status:** Initial versioned policy; production hardening continues in Stage 25

## Identity and credentials

- Email is normalized with trim plus lowercase for lookup and uniqueness. The original display form is not an authorization identifier.
- Registration creates only the `USER` role. Public input cannot grant staff roles.
- The transport runtime is Django 5.2 LTS with Django REST Framework 3.16+. The Stage 12 `users` table remains canonical; Django must not create a second `auth_user` identity store.
- The domain reference password adapter uses PBKDF2-HMAC-SHA256 with a per-password 16-byte random salt, 600,000 iterations and a 32-byte derived key. The Django persistence adapter must use Django's versioned password-hasher interface and rehash when the selected policy changes. The encoded record stores algorithm and parameters so a later policy can upgrade without guessing.
- Password comparison is constant-time. Plaintext passwords, tokens and signing keys are never logged or stored in repository files.
- Duplicate-email registration returns a generic conflict without disclosing credential state beyond the already attempted identifier.

## Session-backed access tokens

`POST /auth/login` creates a server-side session and a 15-minute bearer access token. The reference token is JWT HS256 and requires these claims:

| Claim | Meaning |
|---|---|
| `iss`, `aud` | fixed issuer and audience |
| `sub` | user UUID |
| `sid` | revocable session UUID |
| `roles` | current role codes |
| `iat`, `exp` | issue and expiry time |
| `jti` | unique token identifier |

Verification checks signature, issuer, audience, timestamps, active user and active unexpired session. `POST /auth/logout` revokes `sid`; later tokens for the same session fail with `SESSION_REVOKED`. Key rotation and external secret management are explicit Stage 25/deployment decisions; key material must be injected at runtime.

The Django adapter reads the bearer header through `Stage21BearerAuthentication` and returns one verified `Principal`. Next.js uses a server-side API boundary and forwards the bearer token to Django. Browser persistence in `localStorage` is forbidden. The final renewal/cookie/key lifecycle is security work in Stage 25 and must not weaken server-side session revocation.

## Authorization

- `USER` may access its own tests, attempts, reviews, mastery, progress and dashboard.
- `CONTENT_EDITOR` may view the bank, create/revise Drafts and preview/commit Draft-only imports or safe bulk transitions.
- `REVIEWER` may view review context, make dedicated review decisions, request retirement and read audit history.
- `ADMIN` has the Stage 20 administration permissions, including immediate retirement and analytics jobs.
- Django REST Framework performs coarse role checks and the application/service layer performs resource ownership checks. A mismatched learner resource returns `RESOURCE_NOT_FOUND` to avoid confirming another user's identifier.
- UI visibility is never an authorization control. Every staff operation checks roles again in the backend.
- Stage 11 independent review remains binding: an Admin or Reviewer cannot approve a question they authored/generated.

## Rate-limit baseline

| Operation | Baseline | Key |
|---|---:|---|
| Register | 5/hour | IP |
| Login | 5/15 minutes | IP + normalized email |
| Submit answer | 120/minute | user UUID |
| Admin mutation | 30/minute | user UUID |

Exceeding the limit returns `429 RATE_LIMITED` and `Retry-After`. These are conservative initial values, versioned for Stage 25 abuse testing and calibration.

## Failure behavior

- Missing credentials: `401 AUTHENTICATION_REQUIRED`
- Malformed, expired or wrongly scoped token: `401 TOKEN_INVALID`
- Revoked session: `401 SESSION_REVOKED`
- Authenticated but missing role: `403 FORBIDDEN`
- Wrong learner owner: `404 RESOURCE_NOT_FOUND`
- Disabled/deleted user: fail closed as `401 TOKEN_INVALID`

Authentication errors use the same Stage 21 error envelope and request correlation ID as every other API error.

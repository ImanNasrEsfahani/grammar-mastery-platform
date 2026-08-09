# Stage 21 Framework Decision - Django Backend and Next.js Frontend

**Decision version:** stage21-django-nextjs-profile-v1.0.0  
**Owner and technical reviewer:** Iman  
**Decision date:** 2026-08-09 UTC  
**Status:** Accepted; implementation profile validated; final Stage 21 acceptance pending

## Decision

| Layer | Selected technology | Version policy | Scope |
|---|---|---|---|
| Backend runtime | Django | 5.2 LTS, minimum patch 5.2.17, latest supported 5.2 patch required | Selected and introduced in Stage 21 |
| API adapter | Django REST Framework | 3.16 or later compatible 3.x release | Selected and introduced in Stage 21 |
| Python | CPython | 3.12 or later supported by Django 5.2 | Backend runtime |
| Database | PostgreSQL | 15 or later | Canonical Stage 12-21 relational store |
| Frontend | Next.js | 16 Active LTS, minimum security patch 16.2.11 | Selected now; implemented in Stage 22 |
| Frontend language | TypeScript | Strict mode | Stage 22 |

Django 5.2 was selected instead of a short-lived feature branch because it is an LTS release. Next.js 16 Active LTS was selected for the frontend handoff; the application must remain on current security patches within that supported line.

## Runtime topology

1. The browser renders and interacts with the Next.js application.
2. The Next.js server boundary calls the versioned Django REST API under /api/v1.
3. Django REST Framework handles HTTP parsing, authentication, coarse role permission, throttling hooks, request IDs and error translation.
4. Stage 21 application services enforce ownership and orchestrate domain work.
5. Stage 13-17 engines remain the sole owners of selection, scoring evidence, mastery, Error Review and SRS calculations.
6. Repository adapters persist to the versioned PostgreSQL schema.

The public deployment should present one origin and reverse-proxy /api/v1 to Django when feasible. Cross-origin browser access is not the default architecture.

## Backend boundaries

- Django views and serializers are transport adapters only. They must not calculate mastery, select questions, update SRS intervals or bypass content workflow gates.
- The existing Stage 12 users table remains the canonical identity record. Stage 21 must not silently create a second Django auth_user identity store.
- The versioned SQL files remain the canonical schema contract. Any Django model mapped to those tables must avoid generating duplicate tables or destructive migrations until a reviewed schema-ownership migration plan exists.
- The Stage 21 error handler converts Django, Django REST Framework and domain failures to the same error envelope.
- The Stage 21 authentication adapter converts a verified session-backed bearer token to one Principal. Application services still perform owner checks and conceal cross-owner resources as RESOURCE_NOT_FOUND.
- Request IDs are accepted only when syntactically safe; otherwise Django generates a new correlation ID and returns it in X-Request-ID.

## Next.js handoff boundary

Stage 21 selects Next.js but does not implement the frontend, because the roadmap assigns component system, test runner UI, responsive states, accessibility and client error handling to Stage 22.

Stage 22 must:

- use the App Router and strict TypeScript;
- derive API types from the frozen OpenAPI contract rather than duplicating response models manually;
- call Django through a server-side API boundary for authenticated operations;
- avoid storing bearer access tokens in localStorage;
- forward X-Request-ID and Idempotency-Key unchanged where applicable;
- implement the exact Stage 21 error, empty, loading and retry states;
- keep scoring, authorization, mastery, review scheduling and next-action priority out of the browser.

## Migration and historical impact

This decision changes the transport implementation, dependency packaging and deployment topology only. It does not rewrite question revisions, test snapshots, raw answers, mastery snapshots, Error Review history, SRS events, audit records or earlier import files. The OpenAPI resource contract remains version 1.

## Validation evidence required

- Django and Django REST Framework import successfully from the declared requirements.
- Request-ID middleware returns one safe correlation ID.
- Domain and DRF validation failures use the frozen error envelope.
- Bearer authentication returns the Stage 21 Principal facade.
- backend role permissions fail closed when no required role is declared.
- framework choices are present in the canonical JSON contract, OpenAPI metadata and Stage 21 documentation.

## Primary references

- Django 5.2 LTS release notes: https://docs.djangoproject.com/en/6.0/releases/5.2/
- Django REST Framework supported versions: https://www.django-rest-framework.org/
- Next.js July 2026 security release and Active LTS line: https://nextjs.org/blog/july-2026-security-release


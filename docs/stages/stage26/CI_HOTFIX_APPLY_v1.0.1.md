# Stage 26 CI hotfix — apply instructions

This is a **Stage 26-only corrective overlay** for current `main` commit
`6fbc78b0e75f574244b131ed0ca29de91d11bba6`
(`feat: integrate stage 26 operations package`).

## Why this overlay exists

The first GitHub Actions run of **Stage 26 release readiness gate** completed with:

- `reference-gate`: PASS
- `frontend`: PASS
- `postgres-migration-rehearsal`: FAIL

Inside the PostgreSQL job, Stage 26 validation and the migration runner both passed.
The failure occurred at the live `test_stage24_postgres.py` step.

The workflow job did not install `requirements-dev.txt` before that test, while the
test imports `psycopg` and `psycopg` is declared by the repository runtime requirements.
The GitHub logs endpoint available during review returned no text, so the dependency
omission is recorded as a **high-confidence root-cause inference**, not as a quoted log error.

## Correction

The PostgreSQL rehearsal job now:

1. sets up Python 3.12 with pip cache;
2. installs `requirements-dev.txt`;
3. installs the PostgreSQL client;
4. validates Stage 26;
5. executes the canonical migration rehearsal;
6. runs the live PostgreSQL integration test.

A regression validator and unit test are included so this prerequisite cannot be
silently removed from the Stage 26 workflow later.

## Apply

Extract this ZIP at the repository root, preserving paths. Review the diff, then use
your normal Git workflow to commit/push it. No commit or push is performed by this
delivery.

After push, the expected evidence is a fresh **Stage 26 release readiness gate** run.
Do not mark Stage 26 live/production-complete solely because CI becomes green.

## Remaining live-production inputs

The roadmap and current Stage 26 package still require real owner/environment inputs
before a production claim is possible:

- compute/runtime hosting;
- staging and production origins, DNS and TLS;
- target PostgreSQL and backup/recovery provider;
- production secret/signing-key manager;
- upload malware scanner;
- error monitoring/metrics service and alert channel;
- administrator/reviewer MFA policy;
- retention approval;
- measured restore drill validating RPO/RTO;
- a deployable full Django HTTP surface for the Stage 21 API contract.

Zero `PUBLISHED` question inventory does not block infrastructure deployment, but it
does block real learner test-generation E2E evidence.

## Repository documentation note

At the reviewed commit, root `ROADMAP.md` and `AGENTS.md` are absent. The uploaded
project roadmap PDF remains the source of truth. Root `README.md` and `STATUS.md` also
lag the newly integrated Stage 25/26 state; this is documentation drift, not the cause
of the CI failure.

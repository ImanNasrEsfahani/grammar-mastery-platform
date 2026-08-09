# Stage 26 CI hotfix review v1.0.1

**Base main:** `6fbc78b0e75f574244b131ed0ca29de91d11bba6`  
**Scope:** Stage 26 only  
**Status:** `HOTFIX_PREPARED_RERUN_REQUIRED`

## Roadmap alignment

Stage 26 requires separate Development/Staging/Production environments, versioned
migrations rehearsed in staging, structured logs/health/error monitoring, scheduled
backup plus restore drills, rollbackable releases with release notes, and correct
DNS/HTTPS/security-header configuration. It explicitly forbids manual production
migrations, public deployment of `.env`/credentials, risky schema deployment without
a recovery point, unlimited logs without retention/privacy policy, and using
production as an experimental environment.

The current Stage 26 package covers those reference contracts. This hotfix corrects
the CI implementation detail that prevented the PostgreSQL rehearsal from proving its
final integration-test step.

## Current GitHub evidence reviewed

- Commit: `6fbc78b0e75f574244b131ed0ca29de91d11bba6`
- Stage 24 multi-layer workflow: SUCCESS
- Stage 26 workflow run `31303438214`: FAILURE
- Stage 26 `reference-gate`: SUCCESS
- Stage 26 `frontend`: SUCCESS
- Stage 26 `postgres-migration-rehearsal`: FAILURE
- In that job, `validate_stage26.py`: SUCCESS
- `migration_runner.py --target staging --execute`: SUCCESS
- final live PostgreSQL unittest step: FAILURE

## Root-cause assessment

The PostgreSQL job invokes a Python integration test that imports `psycopg`, but the
job does not install project Python requirements. `psycopg>=3.2,<4.0` is declared in
`requirements.txt`, which is pulled by `requirements-dev.txt`.

Because the available Actions log endpoint returned no log body, the exact exception
text was not observed. The missing dependency-install step is nevertheless a direct,
reproducible workflow defect and is fixed by this overlay.

## Completion boundary

After applying this overlay, rerun GitHub Actions. A green rerun proves the corrected
reference CI path; it still does **not** prove live production deployment, restore
performance, DNS/TLS, provider bindings, monitoring delivery, or the missing full
Django HTTP deployment surface.

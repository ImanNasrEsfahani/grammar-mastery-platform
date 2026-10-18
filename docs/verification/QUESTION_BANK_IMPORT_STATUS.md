# Question Bank & Stage 23 Import — Current Evidence Boundary

**Audit baseline:** GitHub `main` commit [`9fda187`](https://github.com/ImanNasrEsfahani/grammar-mastery-platform/commit/9fda187ce939be1d0722a94640e2a7a4630740b4), observed October 17, 2026 PT.

## Three different quantities, three different states

| Concept | Value | Evidence |
| --- | ---: | --- |
| Canonical authored source bank | **10,636 rows** | [`seed catalog`](../../data/question_bank/full/v1.0/master/question_bank_seed_catalog.json), [`static validation`](../../data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json) |
| Earlier historical seed | **3,640 rows** | Older Stage 26 runbook/status snapshots; **not** the current complete source inventory |
| Currently published and serving in production | **Unknown from public repository** | Must be measured on authorized production PostgreSQL; `STATUS.md` does not assert a number |

The 10,636 records span 52 CSV files / 52 lessons, B001–B238. Their *authoring source* status is DRAFT. Production status may legitimately differ.

## Stage 23 manifest marker: do not silently remove

The current source catalog and static validation contain:

`STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT`

Moreover, `ops/question_bank/bootstrap.py` explicitly checks for the same marker during canonical source validation. Therefore merely deleting the string from JSON or announcing that the blocker is fixed could **break existing code paths** and would be a false release claim.

Separate the two workflows:

- **Canonical seed/bootstrap:** a controlled system path for importing validated canonical seed content. Source DRAFT and production publication are different states.
- **Stage 23 standard import:** Upload → Parse → Normalize → Validate → Dedupe → Preview → Commit. The recorded manifest-drift blocker requires a separate reproduced failure, an exact manifest/input diagnosis and integration tests before declaring fixed.

The reference Stage 23 unit tests do **not** by themselves prove the specific production manifest issue is resolved. Likewise, a running learner website does **not** automatically imply the optional administration import path passes its release gates.

## Safe remediation procedure

1. **Record versions:** checkout SHA, commit of the question-bank catalog, validation JSON SHA, Stage 23 import configuration/manifest checksums and deployed image SHA.
2. **Reproduce safely:** run Stage 23 validations in an isolated staging environment with no production data modifications. Capture the exact expected/observed manifest hashes and source file paths.
3. **Identify cause:** distinguish stale generated manifests, changed CSV bytes, a legitimate new source revision, mismatched deployment versions and an implementation bug.
4. **Correct the appropriate artifact:** update the canonical manifest and corresponding code/tests **together** only after reproducing the root cause. Do not edit immutable historical evidence or bypass integrity checks.
5. **Verify:** run unit/contract tests, successful and deliberately failing import cases, checks for duplicate IDs and content fingerprints, and a rollback/idempotency rehearsal on PostgreSQL.
6. **Release:** capture actual staging results and owner approval. Only then update the status marker and its consumers as part of one reviewed commit.

## Read-only source audit

```bash
python tools/audit_project_static.py --root .
```

The audit checks the declared source inventory and consistency of historical blocker markers, but **does not execute Stage 23, change its code, or read production data**. A `PASS` from that script means only that static source integrity checks passed.

## Production counts (server only, read-only)

```bash
bash tools/report_production_counts.sh
```

The output contains aggregate counts only, not identities or user records. Use a secured internal evidence record; avoid publishing production infrastructure details unnecessarily.

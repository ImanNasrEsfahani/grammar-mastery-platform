# Grammar Mastery — Project Status

**Product:** [Grammar Mastery](https://grammar.imannasr.com)  
**Maintainer and product owner:** [Iman Nasr](https://github.com/ImanNasrEsfahani)  
**Status updated:** 2026-10-17 (Pacific Time; historical snapshots may have different dates)  
**Evidence baseline:** GitHub `main` commit [`9fda187`](https://github.com/ImanNasrEsfahani/grammar-mastery-platform/commit/9fda187ce939be1d0722a94640e2a7a4630740b4).

> **Current operational status: LIVE / IN USE (owner-confirmed).** Grammar Mastery is a production-deployed French learning application used by real customers and by its creator. This is an account of current product usage, **not** a claim that all production endpoints, analytics, backups, security gates or adaptive-learning outcomes have been independently audited.

## Snapshot: product, content and verification are different dimensions

| Dimension | Current statement | Evidence / limitation |
| --- | --- | --- |
| Live application | **LIVE / IN USE**, with real learners/customers | Confirmed by the product owner; public URL above. Exact customer and usage counts are not claimed. |
| Main stack | Next.js 16 / React 19 / TypeScript; Django 5.2 / DRF; PostgreSQL 15; Docker | `frontend/package.json`, `requirements.txt`, `docker-compose.yml` |
| Authored question-bank inventory | **10,636 records** / **52 lessons** / **B001–B238** / **46 columns** | [`question_bank_seed_catalog.json`](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json) and [static validation](data/question_bank/full/v1.0/validation/question_bank_full_B001_B238_L01_L52_validation.json) |
| Source question status | **DRAFT** in the canonical authoring CSV files | Source status is not the same as database publication/serving status. |
| Currently `PUBLISHED` / serving in production | **Not measured in this repository audit** | Run the read-only [production count report](tools/report_production_counts.sh) on an authorized server. Do not substitute source counts. |
| Stage 23 Import/Preview/Commit | **OPEN GATE:** manifest-hash drift marker recorded | Existing bootstrap validates the marker; do not remove it from JSON to simulate resolution. See [import status](docs/verification/QUESTION_BANK_IMPORT_STATUS.md). |
| Stage 26 live release evidence | **Not included in checked-in historical reference package** | An operating product does not imply that its backup/restore, E2E, security and monitoring records have been attached to GitHub. |
| Stage 27 empirical calibration | **Not demonstrated by current public records** | Reference tests exist; real-learner calibration needs aggregate, privacy-conscious production observations. |

**Historical number reconciliation:** Earlier stage documents report a **3,640-question** seed and an **8,175-question** intermediate bank. The latest authoritative **repository source inventory** has **10,636** rows. These are dated snapshots, not conflicting claims about the current live database. No number is asserted for production serving until measured.

## Engineering-stage ledger (historical, not live-availability flags)

The following summarizes the versioned stage documents. `Reference validated` means that local/specification tests were described as passing at the time; it does **not** mean a corresponding production feature is absent today, nor that a live end-to-end release is formally signed off.

| Stages | Historical development scope | Current evidence boundary |
| --- | --- | --- |
| 01–12 | Learning map, taxonomy, difficulty/weighting, QA policy, relational schema | Source and design artifacts recorded in `docs/`, `data/`, `database/`. |
| 13–15 | Test generation, adaptive selection, mastery | Reference and integration implementations; measure actual behavior in the current live environment separately. |
| 16–17 | Error review and spaced repetition | Reference-tested packages; historical owner-acceptance notes should not be interpreted as the product being offline. |
| 18–20 | Dashboard, information architecture and administration contracts | Reconstructed/reviewed reference artifacts; live feature matrix requires a current release evidence record. |
| 21 | Django/DRF backend and core REST API contracts | Code and API contracts present; published per-endpoint live verification not consolidated in repo. |
| 22 | Next.js/React frontend | Source, components, tests and build pipeline present. |
| 23 | Question-bank import workflow | Reference-test artifacts present, but the explicitly recorded **manifest-hash drift** in the standard Import/Preview/Commit path is not signed off as resolved. |
| 24 | Multi-layer test coverage | Local/reference test evidence recorded; do not convert historical pass counts into current production pass claims. |
| 25 | Security policies and contracts | Validate production secrets, auth, headers and release-specific security behavior separately. |
| 26 | Deploy, migration, backup, monitoring, rollback | Runbooks and release gates documented; actual live verification record and restore exercise must be supplied. |
| 27 | Question-quality and learning-model calibration | Versioned reference framework; live/empirical calibration evidence pending publication. |

For historical per-stage status strings and original acceptance commentary, inspect `docs/stages/`, previous Git history of `STATUS.md`, and their immutable stage manifests. This dashboard deliberately separates **current product availability** from **historical formal acceptance records** instead of silently rewriting history.

## Release verification gates still requiring evidence

1. **Production counts:** read-only measurement of lesson, question-by-status, serving-question and migration metadata counts. Use [`tools/report_production_counts.sh`](tools/report_production_counts.sh). Never publish user-level/private data.
2. **Learner journey:** capture dated evidence of registration/login, lesson navigation, question serving, submission, results, review and next practice recommendation. Validate each feature actually claimed for the current release.
3. **Standard Import path:** reproduce, diagnose and resolve the Stage 23 manifest-drift blocker with a test and a reversible migration plan; do not alter immutable historical package evidence to force PASS.
4. **Operations:** record live deployment SHA, backups and restore drill, monitoring/alerts, HTTPS/security headers and approved rollback plan.
5. **Learning-model calibration:** use real aggregate usage to validate adaptive, mastery and spaced-repetition quality, without implying that synthetic reference fixtures are empirical results.
6. **Owner sign-off:** record `APPROVED`, `CONDITIONAL APPROVED` or `BLOCKED`, with dated evidence, in the [acceptance record](docs/verification/RELEASE_ACCEPTANCE_RECORD.md).

**None of these open *evidence* gates contradicts the owner-confirmed fact that the product is operating and used by customers.** Equally, the product's operation alone does not prove each specialized gate has passed.

## Read-only checks and evidence

```bash
# From the repository root: source CSV, catalog, schema and blocker consistency
python tools/audit_project_static.py --root .

# On the authorized Docker host only; no database writes or user details
bash tools/report_production_counts.sh
```

- [Production verification checklist](docs/verification/PRODUCTION_VERIFICATION.md)
- [Question-bank / import status](docs/verification/QUESTION_BANK_IMPORT_STATUS.md)
- [Release approval record](docs/verification/RELEASE_ACCEPTANCE_RECORD.md)
- [Source inventory](data/question_bank/full/v1.0/master/question_bank_seed_catalog.json)
- [Current user-facing README](README.md)

**Governance:** Product/content owner and final approver: **Iman Nasr**. A PASS in static tests, a successful build, or generation of this document does **not** substitute for explicit owner approval and measured live evidence.

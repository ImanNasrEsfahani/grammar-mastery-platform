# Project status — canonical baseline + Stage 16–24 handoff

| Stage | Scope | Repository status |
|---:|---|---|
| 1 | Knowledge Map | `READY_FINAL` |
| 2 | Taxonomy | `READY_FINAL` |
| 3 | TCF Weighting | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 4 | Question Capacity | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 5 | Excel Master | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 6 | Question Type Catalogue | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 7 | Distractor Engineering | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 8 | Difficulty System | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 9 | Difficulty Distribution | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 10 | Question Import Schema | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 11 | Question QA Workflow | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 12 | Relational Database | `ACCEPTED_REFERENCE_GOVERNANCE_RESOLVED` |
| 13 | Test Generator | `ACCEPTED_REFERENCE_DEFAULT_MIGRATION_SEEDS_PUBLISHED_INVENTORY_LIVE_EVIDENCE_PENDING` |
| 14 | Adaptive Selection | `ACCEPTED_REFERENCE_STAGE15_PROVIDER_RESOLVED_SEEDED_INVENTORY_LIVE_EVIDENCE_PENDING` |
| 15 | Mastery System | `ACCEPTED_REFERENCE_OWNER_APPROVED_RUNTIME_AWAITS_REAL_EVIDENCE` |
| 16 | Error Review | `REFERENCE_VALIDATED_26_26_SQLITE_PASS_PENDING_OWNER_ACCEPTANCE` |
| 17 | Spaced Repetition | `REFERENCE_VALIDATED_32_32_SQLITE_PASS_PENDING_OWNER_ACCEPTANCE` |
| 18 | Learning Dashboard | `RECONSTRUCTED_REFERENCE_PENDING_OWNER_REVIEW` |
| 19 | Site IA / Page Responsibilities | `RECONSTRUCTED_REFERENCE_PRIOR_63_PASS_PENDING_OWNER_REVIEW` |
| 20 | Admin Panel Contract | `RECONSTRUCTED_REFERENCE_PENDING_OWNER_REVIEW` |
| 21 | Backend and Core APIs | `DJANGO_DRF_PROFILE_VALIDATED_PENDING_OWNER_ACCEPTANCE` |
| 22 | Frontend and Fast Question Experience | `NEXTJS_REFERENCE_IMPLEMENTATION_VALIDATED_PENDING_OWNER_ACCEPTANCE` |
| 23 | Question Bank Import Pipeline | `REFERENCE_IMPLEMENTATION_VALIDATED_PENDING_OWNER_ACCEPTANCE` |
| 24 | Multi-layer Testing | `REFERENCE_MULTILAYER_SUITE_VALIDATED_LIVE_STACK_EVIDENCE_PENDING_OWNER_ACCEPTANCE` |

## Operational blockers (not design defects)

- **Question inventory:** the repository contains 3,640 canonical B001-B081 / L01-L18P04 rows across the seed catalog's two Stage10 source shards. The default Stage26 migration imports the catalog seed and leaves all 3,640 `PUBLISHED` and serving on a fresh database; live target execution is still evidence-pending.
- **Independent review:** the owner-requested canonical migration publication is recorded as a SYSTEM seed release with `human_review_claimed=false`. New or non-seed real questions still require Stage 11 independent review (`reviewer != author/generator`) before `APPROVED/PUBLISHED`.
- **PostgreSQL target execution:** the canonical PostgreSQL DDL still needs to be exercised on the eventual target environment.
- **Empirical calibration:** observed difficulty, adaptive weights, distractor quality and mastery/SRS calibration remain Stage 27 responsibilities after live data exists.
- **Stage 16/17 acceptance:** the original packages are checksum-verified and reference-tested, but their source manifests recorded final Iman acceptance as pending.
- **Stage 18–20 artifact provenance:** the earlier sandbox deliverables were not persisted in Library. The repository versions are explicit reconstructions from the roadmap and recoverable prior decisions, not byte-identical recoveries.
- **Stage 21 selected stack:** Django 5.2 LTS plus Django REST Framework 3.16+ is fixed for Backend; Next.js 16 Active LTS is fixed for the Stage 22 Frontend. Production base URL and analytics worker remain explicit deployment decisions.
- **Stage 21 security/deployment:** signing-key lifecycle and calibrated production rate limits remain Stage 25 work; PostgreSQL Patch 006 has not been executed on a live target.
- **Stage 21 acceptance:** 45/45 Stage 21 tests and the integrated 130/130 suite pass, but formal Iman content/technical acceptance is not inferred from implementation alone.
- **Stage 22 runtime evidence:** the Next.js implementation is contract-tested and the default migration supplies a published seed inventory, but real end-to-end learning validation still requires a deployed Django/PostgreSQL target.
- **Stage 22 production decisions:** the public origin, production API base URL, analytics worker and security header/key lifecycle remain Stage 25–26 deployment decisions; bearer tokens are already excluded from browser storage.
- **Stage 22 acceptance:** 142/142 integrated Python tests, 12/12 dedicated Stage 22 contract tests and 7/7 frontend tests pass; lint, strict TypeScript and the Next.js production build also pass. The implementation is ready for Iman's content/technical review; owner acceptance is not inferred automatically.
- **Stage 23 migration compatibility:** Stage 24 found that the unapplied v1.0 Patch 007 reuses the Stage 12 `import_batches` name with an incompatible shape. The historical v1.0 file remains immutable evidence and is explicitly superseded by v1.1 using `question_import_*` tables. The corrected sequence still needs live PostgreSQL execution.
- **Stage 23 production adapters:** the CSV/XLSX reference behavior is validated, but object storage, background-worker behavior and the HTTP adapter still need Stage 26 execution on the eventual target environment.
- **Stage 23 security/retention:** raw-file scanning, production retention/privacy rules and calibrated upload limits belong to Stage 25; the safe current policy retains hashed evidence and performs no automated deletion.
- **Stage 23 acceptance:** 20/20 dedicated Stage 23 behavior tests and the integrated 162/162 Python suite pass. Imported rows are Draft-only and still require Stage 11 independent review before publication; owner acceptance is not inferred automatically.
- **Stage 24 local evidence:** the integrated run discovers 179 Python tests; 177 pass and 2 live-PostgreSQL tests skip without `GMP_STAGE24_POSTGRES_DSN`. The 8/8 frontend Vitest suite passes, including the full runner lifecycle; lint, strict TypeScript and production build are part of the Stage 24 CI gate.
- **Stage 24 performance boundary:** the deterministic in-memory reference profile uses 10,636 candidate questions, 304 mastery scopes and 10,636 dashboard history points. Its local p95 guardrails pass, but this is not a production SLA or deployed-system measurement.
- **Stage 24 live evidence:** PostgreSQL 15 CI service, deployed HTTP API E2E and real browser E2E cannot be claimed from this environment. The checked-in Stage26 PostgreSQL rehearsal validates published/serving inventory against the canonical seed count recorded in `system_versions` instead of a hard-coded row count; deployed HTTP/browser evidence still depends on the Stage26 deployed stack.
- **Stage 24 acceptance:** roadmap outputs and local reference gates are reviewable, but formal Iman acceptance and live-stack evidence remain pending and are not inferred automatically.

## Governance

Content Owner: **Iman**. Technical Owner/Reviewer: **Iman**. The authoritative source book and Persian wording decisions are frozen in `docs/governance/`.

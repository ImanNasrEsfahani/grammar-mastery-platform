# Project status — canonical baseline + Stage 16–20 handoff

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
| 13 | Test Generator | `ACCEPTED_REFERENCE_RUNTIME_BLOCKED_NO_PUBLISHED_INVENTORY` |
| 14 | Adaptive Selection | `ACCEPTED_REFERENCE_STAGE15_PROVIDER_RESOLVED_RUNTIME_BLOCKED_NO_PUBLISHED_INVENTORY` |
| 15 | Mastery System | `ACCEPTED_REFERENCE_OWNER_APPROVED_RUNTIME_AWAITS_REAL_EVIDENCE` |
| 16 | Error Review | `REFERENCE_VALIDATED_26_26_SQLITE_PASS_PENDING_OWNER_ACCEPTANCE` |
| 17 | Spaced Repetition | `REFERENCE_VALIDATED_32_32_SQLITE_PASS_PENDING_OWNER_ACCEPTANCE` |
| 18 | Learning Dashboard | `RECONSTRUCTED_REFERENCE_PENDING_OWNER_REVIEW` |
| 19 | Site IA / Page Responsibilities | `RECONSTRUCTED_REFERENCE_PRIOR_63_PASS_PENDING_OWNER_REVIEW` |
| 20 | Admin Panel Contract | `RECONSTRUCTED_REFERENCE_PENDING_OWNER_REVIEW` |

## Operational blockers (not design defects)

- **Question inventory:** current production/reference bank has zero `PUBLISHED` questions. Stage 13/14 runtime cannot produce real tests yet.
- **Independent review:** real questions must pass Stage 11 independent review (`reviewer != author/generator`) before `APPROVED/PUBLISHED`.
- **PostgreSQL target execution:** the canonical PostgreSQL DDL still needs to be exercised on the eventual target environment.
- **Empirical calibration:** observed difficulty, adaptive weights, distractor quality and mastery/SRS calibration remain Stage 27 responsibilities after live data exists.
- **Stage 16/17 acceptance:** the original packages are checksum-verified and reference-tested, but their source manifests recorded final Iman acceptance as pending.
- **Stage 18–20 artifact provenance:** the earlier sandbox deliverables were not persisted in Library. The repository versions are explicit reconstructions from the roadmap and recoverable prior decisions, not byte-identical recoveries.

## Governance

Content Owner: **Iman**. Technical Owner/Reviewer: **Iman**. The authoritative source book and Persian wording decisions are frozen in `docs/governance/`.

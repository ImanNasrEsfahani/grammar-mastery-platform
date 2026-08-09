# Stage 27 — Calibration after Deploy and data-driven improvement

- Package: `grammar-mastery-stage27-v1.0`
- Contract: `stage27-calibration-v1.0.0`
- Base GitHub main tree inspected: `37bd1461c7b4870438d8bffebe99aa2e6ce980bd`
- Owner: Iman
- Status: `REFERENCE_CALIBRATION_FRAMEWORK_VALIDATED_EMPIRICAL_EXECUTION_BLOCKED`

This Stage 27-only overlay implements the roadmap's calibration architecture without pretending that synthetic fixtures are live production evidence. It adds versioned item-metric snapshots, review-only calibration rules, retirement workflow, model-version registry, limited experiment contract and deterministic reference tests.

## Roadmap output mapping
| Required output | Artifact |
|---|---|
| Question quality dashboard | `question_quality_dashboard_v1.0.md` + `v_question_calibration_current` |
| Calibration rules | `calibration_rules_v1.0.md` + `config/stage27_calibration_contract_v1.0.json` + `src/calibration/` |
| Retirement workflow | `retirement_workflow_v1.0.md` + `calibration_decisions` |
| Model versions | `model_versioning_v1.0.md` + `calibration_model_versions` + seed CSV |
| Experiment log | `experiment_log_v1.0.csv` + experiment schema/storage |

## What is validated now
The reference metrics/rules satisfy the roadmap's anti-shortcut cases: ten answers cannot trigger a final quality decision; a 500-answer item with 18% correctness and elevated ambiguity reports is routed to content QA rather than automatically labeled VERY_HARD; Stage7's <5%/N>=100 weak-distractor heuristic is preserved. Historical answer/model comparability is explicit.

## What is blocked
Stage26 itself records no live staging/production deployment evidence, no target PostgreSQL execution, unresolved provider decisions, and zero PUBLISHED inventory. Therefore **empirical Stage27 calibration cannot truthfully be executed yet**. This package is ready to collect/analyze data once the runtime exists, but formal Stage27 completion requires real production telemetry and owner acceptance.

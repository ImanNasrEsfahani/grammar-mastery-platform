# Stage 27 review report v1.0

## Source and baseline review

The latest GitHub `main` tree was inspected before preparing this package. Root `README.md` and `STATUS.md` are present but lag the already-integrated Stage25/26 artifacts. Root `ROADMAP.md` and `AGENTS.md` are not present, so the uploaded project guide v1.0 remains the roadmap source of truth.

Stage26 is not live-complete: its own validation says reference operations are validated while live staging/production, target PostgreSQL execution, provider bindings, monitoring/backup evidence and owner acceptance are not claimed. Its handoff also records zero `PUBLISHED` question inventory. Consequently Stage27 cannot truthfully produce empirical calibration results yet.

## Roadmap coverage

All five Stage27 outputs are represented:

- **Question quality dashboard:** immutable metric snapshot/read-model contract with required sample size, correct rate, response time, option selection, discrimination, report rate and repeat-error rate.
- **Calibration rules:** versioned thresholds with N gates; very easy/hard items and weak distractors open review rather than auto-mutate production content.
- **Retirement workflow:** proposal → human QA → audited Stage11 workflow; no automatic retirement and no history deletion.
- **Model versions:** registry and seed versions for difficulty, adaptive, mastery and SRS; candidate changes require new versions/config digest.
- **Experiment log:** schema/storage/template plus deterministic limited-cohort assignment; no experiment is falsely marked as executed.

## Compatibility with prior stages

- Stage7 weak-distractor heuristic is preserved: non-correct option share <5% with N>=100 opens review.
- Stage8 observed difficulty remains review-gated; negative discrimination routes to QA first.
- Stage11 published immutability and independent review/retirement workflow remain authoritative.
- Stage12 already stores answers, response time, reports, current `question_metrics` and option metrics. Patch 008 adds **historical metric snapshots** and pre-answer calibration context rather than overwriting those records.
- Stage14 adaptive weights, Stage15 mastery settings and Stage17 SRS intervals remain initial versioned configurations; Stage27 provides the controlled calibration path.
- Stage26 migration order remains unchanged through canonical Stage23 v1.1; Patch 008 is additive and must only be executed after Stage26 production migration/recovery gates are satisfied.

## Reference validation

- Overlay validator: PASS.
- Dedicated Stage27 unit tests: 8/8 PASS.
- Roadmap example: synthetic 500-answer fixture yields 18% correct, 0.8% selection for distractor C and 6% report rate; it opens content QA/weak-distractor review and explicitly does **not** auto-label the item `VERY_HARD`.
- Small-sample guard: 10 answers produces only `S27_INSUFFICIENT_SAMPLE`.
- Destructive-history guard: validator rejects Stage27 SQL that updates/deletes canonical answer/mastery history.

Synthetic fixtures are validation examples only, not production evidence.

## Remaining blockers / required real inputs

1. Complete Stage26 live deployment/provider decisions and measured operations evidence.
2. Create independently reviewed `PUBLISHED` question inventory.
3. Collect real learner answer, response-time, report and pre-answer mastery telemetry.
4. Execute the canonical PostgreSQL sequence plus Patch 008 on the actual target after recovery gates are satisfied.
5. Only then run real calibration windows/A-B experiments and review thresholds/model changes.

## Conclusion

Stage27 is **substantively complete as a versioned reference calibration framework and collection/analysis contract**. Empirical calibration and formal final completion remain `BLOCKED_PENDING_LIVE_PRODUCTION_DATA`; marking those as PASS now would contradict the roadmap's core requirement to use real post-deploy data and preserve historical comparability.

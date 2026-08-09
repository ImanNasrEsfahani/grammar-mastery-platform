# Retirement workflow v1.0

1. Metric snapshot crosses one or more review guardrails.
2. System creates a **proposal** (`OPEN_REVIEW` or `RETIREMENT_CANDIDATE`); no automatic status change.
3. Content reviewer inspects source/provenance, ambiguity, correct answer, distractors and user reports.
4. For urgent confirmed content risk, existing Stage11 serving override can fail closed without deleting history.
5. Outcomes: KEEP; new corrected revision; difficulty-change candidate; or RETIRE candidate.
6. RETIRE is applied only through the existing auditable QA/status workflow. Historical question revision, attempts, answers, reports and metric snapshots remain queryable.
7. If a new revision is published, calibration starts a new evidence window; metrics from the old revision are not merged as if they were the same item.

A low correct rate alone is not a retirement reason. Negative discrimination or low correctness combined with elevated ambiguity reports is a stronger QA signal, still requiring review.

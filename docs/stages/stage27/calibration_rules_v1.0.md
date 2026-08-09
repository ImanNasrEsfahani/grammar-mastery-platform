# Stage 27 calibration rules v1.0

These are **initial review guardrails**, not empirical truths. All thresholds are configuration and must be revised only by a versioned calibration decision.

## Data gates
- N < 30: descriptive only.
- N < 100: collect more data; no content/difficulty decision.
- N >= 100: review flags may open, including Stage7 weak-distractor heuristic (<5% selection share).
- N >= 200: difficulty/retirement candidates may be proposed, never auto-applied.
- Discrimination uses pre-answer mastery and compares top/bottom 27% groups; each band needs at least 20 observations.

## Quality flags
- Correct rate <=20% or >=95% at N>=200: open review; do not infer quality from hardness alone.
- Distractor share <5% at N>=100: weak distractor review.
- Discrimination <=0.10 at N>=200: review; negative discrimination at N>=100 routes to QA first.
- Report rate >=3% at N>=100: ambiguity/content review.
- Repeat-error rate >=20% at N>=100: educational/misconception review.
- Low correctness + high report rate: content QA **before** difficulty relabeling.

## Non-negotiable rules
Historical answers/mastery snapshots are never rewritten. A content correction creates a new question revision. Model changes create a new model version. TCF weights are never changed from one user's behavior. No metric is optimized in isolation; delayed learning/repeat-error guardrails are required.

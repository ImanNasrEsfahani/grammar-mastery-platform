# Model versioning and calibration v1.0

Seed versions inherited from prior stages:
- Difficulty: `initial-difficulty-model-v0.9.0`
- Adaptive selector: `adaptive-selector-v0.9.0`
- Adaptive score: `adaptive-score-v0.9.0`
- Mastery: `mastery-evidence-v0.9.0`
- SRS: `spaced-review-v0.9.0`

Every candidate change receives a distinct semantic version and immutable configuration digest. Attempts/answers keep the versions under which they were served/evaluated. New versions do not replay or overwrite old history.

## Promotion path
DRAFT candidate → validated offline → limited cohort/A-B → analyzed → owner/reviewer decision → ACTIVE. No automatic promotion. Experiments must predeclare a learning metric and guardrails; question count/engagement alone is insufficient.

## Components explicitly owned by Stage 27 calibration
Adaptive weights/exploration/cooldown/diversity, mastery thresholds/decay/confidence, difficulty observed mapping, SRS intervals/lapse/growth/diversity, and operational alert/rate-limit thresholds may all be calibrated, but each remains a separate versioned component.

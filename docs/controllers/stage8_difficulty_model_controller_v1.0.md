# Stage 8 — Difficulty Model Controller

**Status: COMPLETE**

The canonical Stage 8 policy remains untouched. This controller makes the separation between authoring difficulty and observed/calibrated difficulty explicit.

Final bank actual counts:
- EASY: 2,181
- MEDIUM: 4,116
- HARD: 3,203
- VERY_HARD: 1,136

Historical `difficulty_score_initial` / `difficulty_model_version` belong to a question revision and must never be overwritten by observed user performance. Recalibration is a separate, versioned review process.

Ambiguous or multiple-correct items remain `BLOCKED_NOT_SCORABLE`; ambiguity must never be used to manufacture a Very Hard item.

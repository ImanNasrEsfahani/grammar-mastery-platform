# Stage 18 Review Report — Learning Dashboard

Stage 18 turns Stage 15–17 learning signals into a small, actionable dashboard. The contract explicitly prevents a large mastery percentage from being shown without confidence and coverage.

## Decisions

- Overall mastery is sourced from the Stage 15 provider rather than recalculated in the UI.
- The Stage 15 minimum-confidence gate (`0.45`) is reused; below it, the dashboard reports `INSUFFICIENT_EVIDENCE` rather than a weakness label.
- Display bands are versioned product policy: Critical <40, Weak 40–<55, Developing 55–<80, Strong >=80, applied only after the confidence gate.
- Stage 17 due/overdue state outranks ordinary practice in the next-action CTA.
- Stage 16 unresolved misconceptions are diagnostic context, not a replacement mastery score.
- Progress charts use persisted snapshots only. Missing periods are not interpolated into a learning claim.

## Roadmap coverage

- Dashboard wireframe: complete.
- KPI definitions: complete.
- Action priority: complete.
- Mobile layout: complete.
- Empty/loading/error/offline states: complete.

## Risk controls

- KPI misleadingness: confidence + coverage + incomplete-data warning.
- Dashboard overload: fixed mobile-first hierarchy.
- Streak distortion: activity is kept separate from mastery.
- Heavy queries: Stage 21 should provide aggregated dashboard resources instead of chatty per-card calls.

## Provenance note

No `stage18_*` file survived in Library. This artifact set is a reconstruction from the roadmap and upstream accepted contracts and is labeled as such; it is not represented as a byte-for-byte recovery of the earlier chat package.

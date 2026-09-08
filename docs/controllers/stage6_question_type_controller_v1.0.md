# Stage 6 — Question Type Catalogue Controller

**Status: COMPLETE**

The historical Stage 6 policy, catalogue and compatibility matrices remain canonical and are intentionally not rewritten by this overlay.

Closure checks:
- 15 active catalogue types expected; **15 observed** in the final 10,636-question registry.
- All current types use explicit `question_type`; the controller prohibits inferring type from the stem.
- Compatibility remains governed by the lesson/subtopic matrices (`PREFERRED`, `ALLOWED`, `CONDITIONAL`, `NOT_SUITABLE`).
- A controller contract now records pedagogical goal, stem contract, distractor contract, ambiguity guards, UI contract and media extensibility for every current type.
- Final inventory type counts are reconciled in `stage6_question_type_contracts_controller_v1.0.json`.

No canonical v0.9 semantic version was renamed or silently upgraded.

# Stage 7 — Distractor / Misconception Controller

**Status: COMPLETE**

The overlay adds the missing `config/stage7_distractor_rules.json` expected by the authoring/orchestration plan and corrects the stale Stage 7 source README.

Key invariants:
- exactly one defensible correct option;
- correct option has no misconception ID;
- every diagnostic wrong option maps to a valid misconception ID;
- distractors are plausible, balanced and non-duplicative;
- option-level/full explanations stay consistent with the answer key and misconception;
- historical misconception IDs are preserved;
- Stage 6 compatibility is a hard gate;
- post-deployment selection statistics may flag weak distractors but do not rewrite historical authoring data.

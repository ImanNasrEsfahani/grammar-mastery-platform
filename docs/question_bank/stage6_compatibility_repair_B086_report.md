# B086 Stage6 compatibility repair report

Repository main inspected read-only: `60ffc8b04f1a390c476dd9d4f73a55c09bfa37d6`.

The runtime bootstrap rejected `GMP-FULL-B086-Q028` because the question was `PREPOSITION_CHOICE` on `L19-S04`, where the current recovered Stage6 matrix marks that pairing `NOT_SUITABLE`. Inspection also established `GMP-FULL-B086-Q029` as the same class of defect on `L19-S05`. For Lesson 19, `PREPOSITION_CHOICE` is permitted on `L19-S03` (Quantité exprimée + « de »), so the two items were semantically rewritten rather than merely relabelled.

The source book, Lesson 19 printed p. 88, explicitly gives the rule that `de` replaces `du`, `de la`, and `des` when quantity is expressed, including `cent grammes de sucre` and `un morceau de sucre`. The repairs use those patterns.

Static repair checks: exact Stage10 46-column schema; `DRAFT`; four distinct options; one correct answer; correct-option misconception blank; all distractor misconception fields populated; question type and difficulty preserved; target subtopic changed to L19-S03; no >=0.80 normalized-stem near duplicate against the 8,175 uploaded seed rows.

A repository-level preflight script is included to audit all catalogued seed rows against the *current checkout's* recovered Stage6 matrix before bootstrap. It deliberately does not auto-relabel unknown failures: additional failures must be repaired semantically under their own Stage1–11 rules.

Stage23 runtime was not executed. Marker retained: `STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT`.

# Question Bank Stage6 Compatibility Repair v1.0

Purpose: repair the concrete B086 Stage6 incompatibility that blocks `ops/question_bank/bootstrap.py`, without relaxing Stage6 and without running Stage23 Import/Preview/Commit.

## Reviewed repairs
- `GMP-FULL-B086-Q028`: rewritten from `L19-S04 / PREPOSITION_CHOICE` to a source-grounded `L19-S03 / PREPOSITION_CHOICE` item about `cent grammes de sucre`.
- `GMP-FULL-B086-Q029`: rewritten from `L19-S05 / PREPOSITION_CHOICE` to a source-grounded `L19-S03 / PREPOSITION_CHOICE` item about `un morceau de sucre`.

Both preserve external ID, question type, difficulty, `DRAFT` status, 46-column Stage10 schema, and one-correct/four-option contract. Distractor misconception IDs reuse the already-established L19-S03 diagnostic IDs present in the Question Bank.

The grammar basis is Lesson 19, printed p. 88: when a quantity is expressed, `de` replaces `du / de la / des`; examples include `cent grammes de sucre` and `un morceau de sucre`.

## Safe application on a current checkout
Copy the contents of this package into the repository root, then run:

```bash
python ops/question_bank/apply_stage6_compatibility_repairs_v1_0.py
python ops/question_bank/validate_seed_stage6_compatibility.py
```

The apply tool locates the rows by `external_id`, verifies the expected preimage, changes only those two rows, and writes atomically. The preflight then audits **every source listed in `question_bank_seed_catalog.json`** against the repository's current recovered Stage6 compatibility matrix. It fails closed on any remaining `NOT_SUITABLE` or missing compatibility rule and lists all CONDITIONAL rows for explicit guardrail review.

Only after preflight reports `status: PASS` should the normal backend bootstrap be rerun. Stage23 is not run by either script.

## Stage23
`STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT`

This is intentionally retained as an Import/Preview/Commit blocker only.

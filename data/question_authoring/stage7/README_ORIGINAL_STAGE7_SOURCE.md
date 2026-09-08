# Stage 7 source status — corrected controller record

Stage 7 is governed by the historical misconception catalogue plus the recovered/provenance artefacts already present in this repository.

The older note that the historical v0.9 catalogue still needed to be committed is obsolete. The canonical source set is now:

- `stage7_misconception_catalogue_v0.9.csv` — historical catalogue; existing IDs are authoritative.
- `stage7_misconception_catalogue_recovered_v1.0.csv` — recovered/controller copy.
- `stage7_recovery_id_provenance_v1.0.csv` — provenance linking recovered records to preserved IDs.
- `stage7_distractor_rules_recovered_v1.0.csv` — canonical recovered rule table.
- `config/stage7_distractor_rules.json` — operational controller config added by the Stage 6–9 closure pack.

## ID integrity

Historical misconception IDs must never be regenerated merely because the catalogue was recovered or consolidated. New IDs require an explicit, versioned migration. The provenance file is retained so a wrong option can be traced deterministically through misconception → subtopic → weakness/review.

## Completion status

**Stage 7 controller: COMPLETE**

The controller requires:
1. exactly one defensible correct option;
2. blank misconception ID on the correct option;
3. a valid misconception ID on each diagnostic distractor;
4. plausible, balanced and non-duplicate distractors;
5. option-level/full explanations consistent with the key and misconception;
6. the Stage 6 compatibility gate;
7. post-deployment distractor metrics without rewriting historical authoring data.

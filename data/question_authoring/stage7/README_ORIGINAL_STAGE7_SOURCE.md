# Original Stage 7 misconception catalogue location

The historical Stage 7 source file must be committed at exactly:

`data/question_authoring/stage7/stage7_misconception_catalogue_v0.9.csv`

Keep it **alongside** the recovered Stage 7 files. Do not overwrite:

- `stage7_misconception_catalogue_recovered_v1.0.csv`
- `stage7_recovery_id_provenance_v1.0.csv`
- `stage7_distractor_rules_recovered_v1.0.csv`

Why this original file is retained:

- it preserves historical misconception UUIDs used by earlier Question Bank artifacts;
- it provides durable repository provenance instead of depending on a chat/File Library copy;
- it can be copied from the checked-out repository into PostgreSQL containers for one-time repair/migration work.

Expected historical filename:

`stage7_misconception_catalogue_v0.9.csv`

Important: this package intentionally does not fabricate or reconstruct that CSV. The exact historical source bytes must be taken from the existing project File Library copy.

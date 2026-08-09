# Stage 23 Import Schema and DB Mapping

The row contract remains `question-import-schema-v0.9.0`; Stage 23 does not invent a second authoring format. CSV must be UTF-8 and XLSX uses the first worksheet. The first row must contain the exact 46 columns from `schemas/question_import.schema.json`, in order. A batch has 1-1000 non-empty data rows in the reference profile.

## Processing layers

| Layer | Input | Output | Failure behavior |
|---|---|---|---|
| Upload | CSV/XLSX bytes, UUID `batch_id`, schema version | retained raw object, name/type/size/SHA-256 | reject unknown type, empty/oversize file, reused batch or wrong schema |
| Parse | retained bytes | header and source rows with spreadsheet row numbers | reject encoding/workbook/shape/header errors |
| Normalize | parsed cells | NFC text, trimmed line endings, known enum casing, stable pipe lists | no spelling correction and no lookup creation |
| Validate | normalized 46-column row + lookup snapshot | stable row/field issues | fail closed for missing/unknown/mismatched values |
| Dedupe | validated row + bank/batch signatures | exact/fingerprint result or semantic-review flag | exact blocks; semantic requires reviewed decision |
| Preview | all row results | counts, issues, dispositions, preview SHA-256, one-time token | no question mutation |
| Commit | exact token/hash-bound preview | Stage 12 question graph in one transaction | any non-valid row, stale preview or DB conflict aborts all rows |

## Canonical mapping

| Import fields | Stage 12 targets |
|---|---|
| `external_id`, `question_revision` | `questions.external_id`, `questions.revision`; pair must be unique |
| `lesson_id` + `lesson_code` | one active `grammar_lessons` record; canonical code is `L` plus two-digit lesson number |
| `subtopic_id` + `subtopic_code` | one active `grammar_subtopics` record owned by the resolved lesson |
| `secondary_subtopic_ids` | `question_secondary_subtopics`; pipe-delimited canonical UUIDs |
| `question_type` | active `question_types.code`; no type creation |
| stem/explanation/difficulty/source/version fields | `questions` with the Stage 10 length, enum and version gates |
| options/explanations/misconceptions | four `question_options` rows; correct option has no misconception and every distractor has an approved mapping |
| `tags` | `question_tags`; each pipe token resolves as tag UUID or canonical code in the adapter |
| media fields | zero/one `question_media`; NONE requires empty media fields, IMAGE requires alt text, AUDIO/VIDEO require transcript |
| `status` | exactly `DRAFT`; later transitions belong to Stage 11 review/publish workflows |

`author_id` must resolve to an active actor. `reviewer_id` may be blank on a Draft; when present it must resolve and differ from the author. Importing a reviewer value never approves the content.

## Examples

- Valid: `difficulty=MEDIUM`, `lesson_id=<Lesson 1 UUID>`, `lesson_code=L01`, and `subtopic_id/subtopic_code` resolve to the same active Lesson 1 subtopic.
- Invalid: spreadsheet row 128 contains `difficulty=meduim`. Preview returns row 128, field `difficulty`, code `ENUM_INVALID`; commit remains disabled and no new value is created.

# Stage 23 Batch Audit Contract

Every import is addressed by an immutable UUID `batch_id`. The audit projection joins three layers without replacing earlier history:

1. `import_batches` - raw provenance, state, counts, preview hash and timestamps.
2. `import_batch_rows` - original/normalized row evidence, row/field issues, duplicate signatures, reviewed semantic decisions and committed question link.
3. `import_batch_events` - append-only phase and decision events correlated to Stage 12 `audit_logs` and Stage 20 `admin_audit_events`.

## Required event evidence

| Event | Minimum evidence |
|---|---|
| `UPLOADED` | actor, request, file name/type/size, object key, raw SHA-256 |
| `PARSED` | schema version, row count, parser version |
| `PREVIEWED` | valid/invalid/duplicate/review counts and preview SHA-256 |
| `SEMANTIC_REVIEW_RESOLVED` | row, decision, actor and non-empty reason |
| `COMMITTED` | exact preview SHA-256 and committed count |
| `POST_CHECKED` | count/FK/DRAFT/audit checks |
| `FAILED` | stable failure code and safe detail |
| `ROLLED_BACK` | actor, reason, affected IDs/count and retained evidence confirmation |

The plaintext confirmation token is never stored in audit data; only its SHA-256 is persisted until commit. A new preview or semantic decision invalidates the prior token.

## Integrity and retention

- Batch identity and raw provenance are immutable.
- Import events cannot be updated or deleted.
- Raw bytes/object, original rows, normalized rows, preview reports and event history remain available after rollback.
- Stage 25 decides the production retention period and sensitive-data controls. Until then the safe reference policy is retention with no automated deletion.
- Stage 26 selects object storage and proves backup/restore. The database contract uses an opaque `raw_object_key` plus content hash so provider choice is not hard-coded.

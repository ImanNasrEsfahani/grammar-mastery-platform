# Stage 23 Rollback Strategy

Rollback is a compensating import operation, not permission to erase learning history.

## Automatic batch rollback

Automatic rollback succeeds only when all conditions hold:

- batch state is `COMMITTED`;
- every linked question remains `DRAFT`;
- no imported question has a later revision;
- no review/status event, test snapshot, user answer, Error Review/SRS evidence, metric, report, publish batch, serving override or other downstream reference exists;
- the caller is `ADMIN`, supplies an idempotency key and records a non-empty reason.

The adapter locks the batch and linked questions, rechecks these conditions, deletes only the newly imported question graph in one transaction, marks row links and batch as rolled back, writes canonical/admin/import audit events, and verifies the affected count before commit. The raw source, normalized rows, preview hash and audit trail are retained.

## Blocked rollback

If any linked question changed state or gained a downstream reference, the operation fails with `ROLLBACK_REQUIRES_RETIREMENT_WORKFLOW` and makes no mutation. The Admin must then use the Stage 11/20 retirement path. That path preserves immutable attempts and snapshots and can disable serving without deleting evidence.

## Recovery cases

| Failure point | Recovery |
|---|---|
| Upload/parse/validate/preview | mark batch failed; no question rollback is needed |
| Commit exception before transaction success | database transaction rolls back all question and audit writes |
| Post-check mismatch | raise inside the same transaction; zero partial questions remain |
| Operator discovers duplicate immediately after clean Draft commit | automatic batch rollback if preconditions still hold |
| Question already reviewed/published/served | rollback blocked; audited retirement/revision workflow |

Deletion is therefore limited to pre-review import cleanup. Historical learning evidence is never hard-deleted by Stage 23.

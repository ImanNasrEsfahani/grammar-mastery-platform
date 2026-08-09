# Stage 26 backup policy v1.0

This policy operationalizes the Stage 25 backup/restore contract without pretending a provider has been selected.

## Backup sets

1. PostgreSQL data and schema state.
2. Raw import objects that are still within approved retention.
3. Audit evidence required for security/content traceability.
4. Deployment configuration **excluding secrets and live tokens**.

Backups must be encrypted, access-controlled, versioned and stored outside the primary failure domain. The planning targets inherited from Stage 25 are RPO <=24 hours and RTO <=4 hours. These are not production claims until a measured Stage 26 drill proves or revises them.

## Restore drill

At least every 90 days and after material storage/migration changes:

1. Create an isolated restore environment.
2. Select a recorded recovery point and verify its manifest/integrity metadata.
3. Restore database and in-scope objects.
4. Apply only the canonical Stage 26 migration sequence.
5. Compare expected table/object counts and integrity checks.
6. Exercise safe critical reads and authentication/audit paths that exist in the deployed runtime.
7. Record start/end times, measured RPO/RTO, failures and corrective actions.
8. Destroy the isolated environment after retaining the non-secret drill evidence.

A backup is `USABLE` only after a successful restore drill. The last known-good recovery point must never be overwritten as part of a failed recovery attempt.

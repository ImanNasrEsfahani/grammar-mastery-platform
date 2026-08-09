# Stage 25 backup and restore plan v1.0

Owner: Iman. Review frequency: quarterly and after material storage changes.

PostgreSQL, raw-import objects, audit evidence and deployment configuration are separate backup sets. Secrets and live tokens are never copied into application backups. Backups are encrypted, access-controlled, versioned and stored outside the primary failure domain. The target RPO is 24 hours and target RTO is 4 hours; Stage 26 must confirm or revise these targets with measured evidence.

A restore drill creates an isolated environment, selects a recorded recovery point, verifies the signed/versioned inventory and SHA-256 manifest, restores database and objects, applies the approved migration sequence, compares table/object counts, exercises login, question read, attempt read and audit read, and destroys the isolated environment after retaining the drill report. A backup is not marked usable until this drill succeeds.

Failures page the operational owner, preserve logs without credentials, prohibit overwrite of the last known-good recovery point, and open a dated corrective action. Production credentials, provider selection, scheduling and the first measured drill are Stage 26 deployment work; this package supplies the verification contract and corruption tests without claiming a production restore.

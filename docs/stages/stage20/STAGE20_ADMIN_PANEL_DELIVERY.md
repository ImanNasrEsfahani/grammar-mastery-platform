# Stage 20 Admin Panel Delivery

Stage 20 freezes the operational contract for managing the question bank before backend/frontend implementation.

The required roadmap outputs are represented:

- Admin IA: seven focused operational screens.
- Roles/permissions: Admin, Content Editor and Reviewer with backend-enforced actions.
- Review queue: independent review and one-screen decision context.
- Bulk import UI: preview/validation/confirmation before commit.
- Audit log: append-only PostgreSQL audit events for admin mutations.

Destructive bulk operations cannot commit without a preview and confirmation token. Immediate retirement is restricted to Admin; Editor/Reviewer use an auditable request path. Historical attempts and frozen test snapshots remain intact after question retirement.

Bulk import accepts `DRAFT` rows only. Bulk status operations may target only `DRAFT`, `READY_FOR_REVIEW` or `CHANGES_REQUESTED`; they cannot approve, publish, reject or retire content. Approval remains a dedicated independent-review action, and publication remains an explicit Stage 11/12 publish batch.

Stage 12 `audit_logs` remains the canonical audit history. The Stage 20 `admin_audit_events` table is a linked domain supplement and must be written in the same Stage 21 transaction. `CONTENT_EDITOR` maps to the existing Stage 12 `CONTENT_AUTHOR` actor type.

This package intentionally stops at the Stage 20 product/technical contract boundary. Stage 21 owns backend API implementation; Stage 22 owns frontend implementation; Stage 23 owns the complete import pipeline/rollback behavior.

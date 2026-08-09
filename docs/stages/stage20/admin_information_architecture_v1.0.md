# Stage 20 Admin Information Architecture

The normal operational workflow never requires direct database editing.

1. Bank List — search/filter by lesson, status, type, difficulty, author and quality metric.
2. Question Editor — create/edit a Draft through immutable question revisions.
3. Review Queue — prioritize items awaiting independent content review.
4. Review Detail — stem, options, answer, explanations, source, duplicates, quality metrics and revision history on one screen.
5. Bulk Import Preview — parse/validate/preview before any commit.
6. Bulk Status Preview — show exact affected IDs and require confirmation before commit.
7. Audit Log — search immutable admin actions and batch outcomes.

Permissions are backend-enforced. Admin can immediately retire a problematic question. Content Editor and Reviewer can request retirement. Approval/rejection belongs to Admin/Reviewer, while bulk import belongs to Admin/Content Editor.

All admin screens live under the Stage 19 reserved `/staff` prefix. Bulk imports create Drafts only, and bulk status changes cannot target Approved, Published, Rejected or Retired. Those states use their dedicated Stage 11 review, publish-batch and retirement workflows.

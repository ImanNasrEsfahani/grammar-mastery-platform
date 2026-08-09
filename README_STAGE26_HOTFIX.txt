Grammar Mastery Platform — Stage 26 CI hotfix v1.0.1

Base main:
6fbc78b0e75f574244b131ed0ca29de91d11bba6

Purpose:
Fix the Stage 26 PostgreSQL rehearsal workflow so Python project dependencies
(including psycopg) are installed before the live PostgreSQL integration test.

This ZIP contains only Stage 26 corrective files; it does not aggregate earlier stages.

Apply:
Extract at the repository root preserving paths.
Then review/commit/push through your normal Git workflow.
A fresh GitHub Actions Stage 26 run is required after application.

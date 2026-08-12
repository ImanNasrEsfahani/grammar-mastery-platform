# Grammar Mastery — auth guard + logout + Stage 7 source placement patch

Base repository inspected: `ImanNasrEsfahani/grammar-mastery-platform`
Base `main` commit at package creation: `d78dc2742a6a5502489ee865bec0fa86910b5adb`

## Included frontend changes

- `frontend/src/proxy.ts` — optimistic auth-cookie guard for protected localized routes.
- `frontend/src/components/navigation/LogoutButton.tsx` — top-bar logout control.
- `frontend/src/components/navigation/AppHeader.tsx` — shows Logout when authenticated and Login when unauthenticated.
- `frontend/src/app/[locale]/layout.tsx` — reads the HttpOnly session cookie server-side and passes auth state to the header.
- `frontend/src/app/api/session/logout/route.ts` — deletes the local cookie before attempting upstream logout, so local logout cannot be blocked by a backend outage.

Protected route sections:

- dashboard
- tests
- review
- lessons
- attempts
- history
- profile
- progress
- settings

Unauthenticated requests to those sections under `/fa/...` or `/en/...` redirect to the corresponding localized login page.

## Historical Stage 7 file

Commit the original file at exactly:

`data/question_authoring/stage7/stage7_misconception_catalogue_v0.9.csv`

This ZIP contains `README_ORIGINAL_STAGE7_SOURCE.md` at that location, but it does **not** contain the CSV bytes because the historical file is available only as a project File Library reference in the current environment. Do not replace it with a reconstructed or partial CSV.

## Apply to a local repository checkout

Extract this ZIP at the repository root and allow these frontend files to replace the corresponding files.
Then add the exact historical Stage 7 CSV at the path above before committing.

No GitHub commit or push was performed by the package builder.

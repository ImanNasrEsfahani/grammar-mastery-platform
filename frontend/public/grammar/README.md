# Static grammar lesson HTML

This directory is the runtime home for authored grammar lesson HTML files.
The Next.js frontend serves files from `frontend/public/` at the same-origin
URL that follows the directory structure below.

## Canonical book in this patch

Book slug:

`grammaire-progressive-francais-intermediaire-3e`

Repository directory:

`frontend/public/grammar/grammaire-progressive-francais-intermediaire-3e/`

Runtime URL root:

`/grammar/grammaire-progressive-francais-intermediaire-3e/`

## Lesson naming contract

Use the canonical lesson number from the lesson API and save exactly:

- Lesson 1 -> `L01.html`
- Lesson 2 -> `L02.html`
- ...
- Lesson 52 -> `L52.html`

Adding another lesson HTML to this already-registered book does not require a
code change. Put the correctly named HTML file in the directory and rebuild / redeploy
the frontend so Docker includes the new static file.

The learner route remains UUID-based:

`/{locale}/lessons/{lessonId}?book=grammaire-progressive-francais-intermediaire-3e`

The UI fetches the canonical lesson detail, reads `lesson_no`, then resolves the
matching static file. The UUID therefore remains the stable application ID; the
filename is only a presentation/content lookup derived from canonical lesson data.

## HTML authoring contract

The existing L01/L02 style is supported: an HTML fragment may contain its own
root wrapper and inline `<style>` block. Keep selectors scoped/prefixed to the
lesson wrapper, especially for mixed Persian RTL and French LTR content.

Do not add JavaScript to lesson HTML. The viewer uses a sandboxed iframe without
`allow-scripts`, which keeps authored CSS isolated from the application and blocks
script execution. Relative image/media paths are allowed and should be stored under
the same book directory (for example `assets/...`).

## Adding another book

1. Create a new stable ASCII slug directory under `frontend/public/grammar/`.
2. Add one registry entry to `frontend/src/lib/grammar-content/books.ts` with the
   book title, edition, lesson count and public root.
3. Put that book's `LNN.html` files in the new directory.

Do not use the display title as a storage key; the slug is the stable system name.

# Stage 18 dashboard wireframe

## Mobile-first order

1. Next action card — one primary CTA selected by the Stage 18 priority contract.
2. Overall mastery — score, confidence and coverage shown together.
3. Due reviews — overdue/due counts and next due time.
4. Lesson attention — Critical/Weak/Developing lessons only when confidence is sufficient.
5. Recent test — score/breakdown link, never merged with Review.
6. Progress trend — persisted snapshots only; incomplete data is visibly flagged.
7. Activity — quantity metrics separated from mastery/quality.

## Desktop

Use the same semantic order in a two-column layout. The left column contains next action, overall mastery and lesson attention. The right column contains due reviews, recent test and activity. Trend spans the content width below both columns.

## Required states

- Loading: skeleton only; no placeholder mastery percentages.
- No evidence: explain that a weakness cannot yet be inferred; CTA = Build evidence.
- No due reviews: show next due time when known.
- Partial history: chart may render observed points but must show an incomplete-data warning.
- Offline/error: identify snapshot timestamp and offer retry; unsafe mutations remain disabled.

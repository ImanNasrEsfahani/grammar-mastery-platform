# Question Quality Dashboard — contract v1.0

The dashboard is a read model over immutable `question_metric_snapshots` plus current question/QA metadata. It must not directly mutate question status or difficulty.

## Required columns
`question_id`, `question_uid/revision`, lesson/subtopic/type, status, sample size, correct rate, median/p90 response time, option A-D selection shares, discrimination, report rate, repeat-error rate, metric window, metric version, current difficulty/model version, flags, review state.

## Default views
1. **Needs QA now** — negative discrimination, low-correct+high-report, critical reports.
2. **Weak distractors** — any non-correct option <5% at N>=100.
3. **Difficulty review** — extreme rates/low discrimination only when sample gates are met.
4. **Insufficient evidence** — N<100, clearly separated from quality failures.
5. **Model comparison** — metric windows grouped by model version; never blend versions silently.

## Safety
Dashboard actions create proposals/review queue entries. Retirement and difficulty changes require human workflow. Published content remains immutable in place.

# Grammar Mastery — Production Verification Checklist

**Purpose:** provide concrete acceptance evidence for an **already operating product**; this is not an assertion that previously missing acceptance evidence has been collected.

**Product URL:** https://grammar.imannasr.com  
**Owner:** Iman Nasr  
**Reference repository baseline at package creation:** `9fda187ce939be1d0722a94640e2a7a4630740b4`

## 1. Environment and release identity

- [ ] Authorized reviewer recorded name, date/time, timezone, application release SHA/image digests and target environment.
- [ ] Confirmed the running frontend/backend versions and database migration history.
- [ ] Confirmed current deployment is not being confused with a historical staged or reference-only environment.
- [ ] Documented whether privacy, security and accessibility approvals exist and their evidence links.

## 2. Real learner workflow (run without disclosing customer data)

| Check | Expected observable result | Evidence link / actual | Result |
| --- | --- | --- | --- |
| Public HTTPS | Page loads using trusted TLS without mixed content | _Fill in_ | NOT TESTED |
| Authentication | Login/register and logout work for a consenting test account | _Fill in_ | NOT TESTED |
| Lesson navigation | Actual lesson/subtopic data are returned and displayed | _Fill in_ | NOT TESTED |
| Test creation | A test is created from genuinely serving questions | _Fill in_ | NOT TESTED |
| Question runner | Answers can be submitted and are persisted | _Fill in_ | NOT TESTED |
| Results and progress | Progress/attempt/results are correct after refresh | _Fill in_ | NOT TESTED |
| Error review | A missed question can appear in the user's own review flow (if advertised as live) | _Fill in_ | NOT TESTED |
| Adaptive next action | Recommendations use actual available evidence and safe empty states (if advertised as live) | _Fill in_ | NOT TESTED |
| Spaced repetition | Scheduled review behavior matches stated rules (if advertised as live) | _Fill in_ | NOT TESTED |
| Language/responsiveness | Required supported locales, mobile keyboard and responsive layout work | _Fill in_ | NOT TESTED |

A `NOT TESTED` row means **no review evidence has been supplied for this checklist**, not that the production feature is absent or broken.

## 3. Source and serving inventory

```bash
python tools/audit_project_static.py --root .
# Run the following on the authorized server only:
bash tools/report_production_counts.sh
```

- [ ] Source catalog declares 10,636 rows / 52 lesson files / 46-column schema, and read-only source audit passes.
- [ ] Capture production `questions` by status and `v_serving_questions` total; do not assume it equals the catalog total.
- [ ] Record canonical seed metadata and deployed migration schema version; explain differences.
- [ ] If a newer source set is intended for serving, record the independently reviewed publication decision and privacy-safe test.
- [ ] Stage 23 import drift investigated separately, with exact hash comparison and a reproducible pass/fail record.

## 4. Security and data protection

- [ ] Authentication and authorization tested across distinct users/roles; no cross-account document or progress leakage.
- [ ] Session cookies and token expiry/revocation tested against the release's intended policy.
- [ ] HTTPS, response security headers and allowed CORS origins reviewed.
- [ ] Sensitive secrets absent from source and build logs; credentials rotated as required.
- [ ] Upload limits/scanning and secure media handling tested wherever file uploads are enabled.
- [ ] Privacy/retention and access restrictions reviewed for learning/analytics data.

## 5. Reliability, operations and recovery

- [ ] Deployment/CI workflow run references recorded; no stale or skipped failing tests represented as passed.
- [ ] Application readiness/health checks captured under both normal and controlled failure conditions.
- [ ] Database backup exists; backup can be read and **restored in an isolated environment** without exposing users.
- [ ] RTO/RPO/restore duration recorded from a real drill; no values invented.
- [ ] Monitoring alert configuration tested and assigned to an owner.
- [ ] Rollback plan and stop conditions accepted before schema/content changes.

## 6. Validation coverage

- [ ] Frontend: type-check, lint, test and production build outcomes recorded for the deployed commit.
- [ ] Backend: contract/unit/integration test report recorded for the deployed commit.
- [ ] Real PostgreSQL API/browser E2E executed against staging or production-safe test account.
- [ ] Accessibility and performance evidence is tied to measured device/browser/environment, not synthetic-only claims.
- [ ] Stage 27 empirical calibration conclusions cite **real aggregate data** and a sample-size gate; reference fixture results are not reported as production outcomes.

## Approval

Only the product owner or authorized release approver can complete the final sign-off in [RELEASE_ACCEPTANCE_RECORD.md](RELEASE_ACCEPTANCE_RECORD.md). A static audit ZIP, a deployed homepage, or owner-reported use cannot alone certify all checklist rows.

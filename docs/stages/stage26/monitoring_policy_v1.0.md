# Stage 26 monitoring policy v1.0

Owner: Iman. Thresholds in this document are **initial release guardrails**, not empirical learning calibration. Stage 27 may revise them through a versioned change after real production evidence exists.

## Required signals

Every production request must carry a request/release correlation identifier in structured logs. Logs must exclude passwords, tokens, cookies, authorization headers and secret values using the Stage 25 redaction boundary. At minimum, operations must observe HTTP status counts, request latency, health/readiness, database connectivity/utilization, background-job failures when a worker exists, backup age, restore-drill age and security-control failures.

## Release-time hard gates

- Health/readiness: any failure blocks promotion; two consecutive failures after production cutover are a rollback trigger.
- Migration failure: stop immediately; do not continue remaining migrations or new writes blindly.
- HTTPS/security headers: missing required Stage 25 headers blocks release.
- Smoke path: login/auth boundary (or an unauthenticated readiness substitute before accounts exist), safe content read, attempt/read path when inventory permits, and audit read for staff must pass for the capabilities actually deployed.
- Backup age must be <=26 hours once scheduled production backups are active. A restore drill older than 95 days alerts.

## Initial alert guardrails

- HTTP 5xx >2% over 5 minutes after a release: rollback candidate, correlated against the previous release.
- API p95 >2000 ms for 10 minutes: investigate; rollback when the regression is release-linked and user-impacting.
- Database connection utilization >=80%: alert before saturation.
- Security-header mismatch, secret exposure signal, failed migration or unusable recovery point: page the operational owner immediately.

The monitoring provider and alert channel are intentionally not hard-coded. A Stage 26 release evidence record must identify the active provider bindings without embedding credentials.

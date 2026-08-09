# Stage 25 security checklist v1.0

- [x] Standard password hashing contract and uniform login failure.
- [x] Revocable short-lived access token/session contract and rotation policy.
- [x] Backend RBAC and object-level matrix.
- [x] Pre-submit answer-leak fail-closed validator.
- [x] Login, answer, import and admin rate-limit profiles.
- [x] Sensitive logging redaction.
- [x] CSP, HSTS, nosniff, referrer and permissions header profile.
- [x] Upload quarantine and fail-closed scanner boundary bound to SHA-256.
- [x] Privacy minimization and versioned retention defaults.
- [x] Backup/restore plan and manifest corruption test.
- [ ] Production secret-manager/key-rotation adapter selected and exercised (Stage 26).
- [ ] Production malware scanner selected and exercised (Stage 26).
- [ ] Production-like encrypted backup restored within RPO/RTO (Stage 26).
- [ ] Owner approves retention periods and release (pending Iman review).

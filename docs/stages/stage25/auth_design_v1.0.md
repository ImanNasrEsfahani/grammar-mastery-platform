# Stage 25 authentication and privacy design v1.0

Passwords use the framework's maintained Argon2id profile where available; existing PBKDF2-SHA256 hashes are verified and upgraded on successful login. Authentication errors do not reveal whether an account exists. Login is limited by both normalized account and source IP.

Access credentials live for 15 minutes and are tied to a server-side, revocable session. Browser credentials use Secure, HttpOnly, SameSite cookies at the same-origin server boundary and never browser storage. Unsafe cookie-authenticated methods require CSRF protection. Signing keys are injected at runtime, identified by a non-secret key id, rotated with an overlap window, and removed after all tokens they signed have expired. Logout and security response revoke the session immediately.

Authorization is enforced in the backend for both role and object ownership. UI visibility is convenience only. Editors cannot publish, reviewers cannot approve their own work, and only administrators change roles. High-risk actions emit immutable audit events with actor, target, outcome, request id and policy version; request bodies, credentials and answer keys are excluded.

Privacy follows minimization and purpose limitation. Raw imports default to 90-day retention and security audit events to 365 days, subject to owner/legal confirmation before automated deletion is enabled. Export/erasure must preserve the minimum integrity of immutable security and assessment evidence using pseudonymization where deletion would invalidate required history.

# Password Recovery Extension v1.0

This is an additive account-recovery surface requested by the product design. It does **not** alter the existing frozen Stage 21 34-operation core contract.

## Public flow

1. `POST /api/v1/auth/password-reset/request` accepts a normalized email and locale. A syntactically valid request receives the same `202 ACCEPTED` envelope whether or not an active account exists.
2. For a deliverable account, the server generates a cryptographically random single-use token. Only SHA-256 of that token is persisted. A newer request invalidates older live tokens for that user.
3. The email contains a reset URL rooted at the configured `PASSWORD_RESET_PUBLIC_ORIGIN`. Production requires an HTTPS origin controlled by the deployment; the request Host header is never used to construct reset links.
4. `POST /api/v1/auth/password-reset/confirm` validates and consumes the token transactionally, stores the new password with the existing Argon2id policy, clears credential lock counters, revokes active sessions, and consumes all remaining reset tokens for the user.

## Security properties

- No raw reset token or normalized email is stored in `password_reset_requests`.
- Request throttling uses a domain-separated HMAC email fingerprint and suppresses more than five requests per fingerprint per hour without changing the public response.
- Links expire after 30 minutes by default and are single use.
- Account existence is not disclosed in the request response.
- Delivery failures are logged by reset-request UUID only; the email address and raw token are not logged.
- Browser storage is not used for reset tokens. The token stays in the URL until submitted and is never copied to localStorage/sessionStorage.
- Successful reset revokes active server-side sessions, requiring a fresh login.

## Deployment dependencies

Apply `database/postgres/009_password_recovery_v1.0.sql` through the project's normal staged SQL migration procedure. Configure `PASSWORD_RESET_PUBLIC_ORIGIN` and the Django email backend. In production, use HTTPS and a real SMTP/transactional email service. Edge/IP abuse controls are still recommended in addition to the per-email suppression in this extension.

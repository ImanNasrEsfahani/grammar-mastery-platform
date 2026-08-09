# Stage 22 — Frontend and Fast Question-Solving Experience

- **Package:** `stage22-nextjs-v1.0-review`
- **Owner / reviewer:** Iman
- **Prepared:** 2026-08-09 UTC
- **Status:** `NEXTJS_REFERENCE_IMPLEMENTATION_VALIDATED_PENDING_OWNER_ACCEPTANCE`
- **Frontend:** Next.js 16.2.11, React 19.2.8, strict TypeScript, App Router

Stage 22 implements the roadmap's mobile-first, low-friction question experience on top of the Stage 21 Django/DRF `/api/v1` contract. It does not move scoring, authorization, mastery, Error Review or SRS logic into the browser.

## Deliverables

- `frontend/` — runnable Next.js application and frontend tests
- `frontend/src/components/runner/` — independent `QuestionCard`, `Option`, `Progress`, `Explanation` and `Navigation` components
- `frontend/src/components/runner/AttemptRunner.tsx` — question lifecycle, keyboard interaction, focus management and safe retry orchestration
- `frontend/src/app/api/` — same-origin BFF/session boundary; bearer token remains in an httpOnly cookie
- `frontend/src/lib/api/generated.ts` — generated from the Stage 21 OpenAPI file
- `frontend/src/lib/offline/pending-answer-store.ts` — IndexedDB pending-answer record with stable idempotency key
- `config/stage22_frontend_contract_v1.0.json` — canonical frontend policy and risk controls
- `schemas/stage22_pending_answer_v1.0.json` — retry-record schema
- `responsive_state_matrix_v1.0.csv` — breakpoint-independent layout/state decisions
- `accessibility_checklist_v1.0.md` — review evidence and Stage 24 follow-ups
- `client_error_retry_policy_v1.0.md` — status/error/retry behavior
- `review_report_v1.0.md` and `validation_v1.0.json` — formal handoff evidence

## Frozen boundaries

- Browser code calls same-origin `/api/backend/*`; the Next.js server attaches the session-backed bearer token.
- Access tokens are never returned by the login BFF and are never written to localStorage, sessionStorage or IndexedDB.
- The next-question projection comes only from the OpenAPI `AttemptQuestion` schema, which has no correct-answer fields.
- An answer retry reuses the exact idempotency key and payload. Validation/auth/conflict errors are not silently retried.
- `fa` and `en` use stable route slugs. Persian UI is RTL while French question content is LTR.
- Current production inventory remains empty. `NO_ELIGIBLE_QUESTIONS` is displayed as a recoverable product state; the frontend does not invent practice content.

## Validate

```bash
python tools/validate_stage22.py
python -m unittest tests.test_stage22_frontend_contract -v
cd frontend
npm ci
npm run validate
```

## Acceptance boundary

The code and automated evidence are ready for Iman's review. Formal owner acceptance and public visual branding are not inferred. Real end-to-end learning evidence requires a deployed backend and independently reviewed `PUBLISHED` questions.

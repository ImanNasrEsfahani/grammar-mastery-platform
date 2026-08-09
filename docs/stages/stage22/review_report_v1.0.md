# Stage 22 Review Report

## Outcome

The roadmap outputs are present: component system, test-runner UI, responsive-state matrix, accessibility checklist and client error handling. The implementation is compatible with the frozen Stage 21 Django/DRF API and the Stage 18–20 product contracts.

The GitHub `main` snapshot used for this work was commit `4c0bf330a9f692659223731bbebf74fbc6f1ba0c` and contained Stages 1–20. `ROADMAP.md` and `AGENTS.md` were not present anywhere in that branch. The supplied authoritative roadmap PDF (SHA-256 `8a561160d698ffb811453d20b9c610fbb644c7593cca10b3bca6728c7969e6a7`) therefore governed Stage 22. The checksum-identified Stage 21 Django/Next.js package was applied as the direct dependency before implementation.

## Requirement evidence

| Roadmap requirement | Enforcement |
|---|---|
| Independent runner components | Five exported components under `frontend/src/components/runner/` |
| Keyboard and touch | 1–4/Enter/N handler, native buttons, 48px CSS minimum, component tests |
| Clear answered/correct/incorrect/review states | Icon + text + restrained semantic styles; no color-only state |
| Safe retry after temporary network loss | IndexedDB record and exact idempotency-key replay |
| Avoid reload/re-render/latency | Fetch lifecycle inside one client runner, memoized leaf components, no dashboard fan-out |
| Persian/French direction | Locale layout direction, explicit stem direction, `bdi dir=auto` option content |
| No pre-submit answer leakage | OpenAPI-derived `AttemptQuestion`, recursive leakage test, feedback rendered only after POST response |

## Valid and invalid examples

- **Valid:** A French stem is rendered LTR inside a Persian RTL page. Option 2 is selected with key `2`; the same answer and idempotency key survive a temporary 503 and are replayed once online.
- **Invalid:** A next-question response contains `correct_option_id`. The contract test rejects it; the runner does not accept a separate hand-authored pre-answer model.

## Risk controls

- Long-session slowdown: bounded runner tree now; Stage 24 owns measured browser budgets.
- RTL/LTR defects: semantic direction rules now; Stage 24 owns screenshot regression.
- Lost answer: durable pending record and visible state now; same-key replay prevents duplicate domain effects.
- UI distraction: learning runner excludes dashboard/admin cards and heavy animation.

## Dependencies and decisions

- Stage 23 may add import UI only behind the frozen preview/commit server contract.
- Stage 24 must add browser E2E, automated accessibility, OpenAPI consumer compatibility, visual regression and performance budgets.
- Stage 25 owns CSP, security headers, key/session hardening and privacy controls.
- Stage 26 owns production URL, reverse proxy, worker and deployment topology.
- Final product visual branding remains `S22_D02_PRODUCT_VISUAL_BRAND: NEEDS_OWNER_DECISION_BEFORE_PUBLIC_LAUNCH`; neutral accessible tokens are used meanwhile.
- Stage 19 requires History, Profile and Settings pages, but the frozen Stage 21 OpenAPI contract exposes no matching resources. `S22_D03_MISSING_PAGE_RESOURCES` records this gap; the routes fail transparently instead of fabricating data.

## Readiness

Validation passed: integrated Python 142/142, dedicated Stage 22 contract 12/12, frontend Vitest 7/7, ESLint, strict TypeScript, OpenAPI type generation and Next.js production build. The resulting status is `NEXTJS_REFERENCE_IMPLEMENTATION_VALIDATED_PENDING_OWNER_ACCEPTANCE`, not automatic final acceptance.

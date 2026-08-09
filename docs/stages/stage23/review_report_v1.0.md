# Stage 23 Review Report

## Outcome

The roadmap outputs are present: the frozen import schema is operationalized, a CSV/XLSX reference pipeline validates and previews rows before mutation, duplicate checks include exact/fingerprint/semantic layers, commit is atomic and Draft-only, batch evidence is append-only, and rollback is safe-boundary constrained.

The latest GitHub `main` snapshot used for this work was commit `f82e7d68b3f48ac184f07f2328107808a8fa6ad8` and contained Stages 1-21. The saved Stage 22-only package (SHA-256 `287a1e9600beb3a6cade0ca3d0508664881ffc01990c15eb903da07a53b8a32e`) was applied as the direct frontend dependency. `ROADMAP.md` and `AGENTS.md` were not present on `main`; the supplied authoritative roadmap PDF (SHA-256 `8a561160d698ffb811453d20b9c610fbb644c7593cca10b3bca6728c7969e6a7`) governed Stage 23.

## Requirement evidence

| Roadmap requirement | Enforcement |
|---|---|
| `schema_version` and `batch_id` | immutable batch contract, UUID reuse rejection and raw provenance |
| Separate parse/normalize/validate/dedupe/preview/commit | nine explicit phases in config and reference service |
| Row/field errors | stable `RowError` shape and preview schema |
| Lookup resolution | ID/code/ownership checks; unknown lesson/subtopic/type/tag/misconception/actor never creates data |
| Raw file + audit | raw SHA-256/object-key contract, row evidence and append-only events |
| Preview before mutation | tests prove preview leaves question repository empty |
| Duplicate beyond exact stem | option-order-resistant Stage 10 fingerprint and conservative semantic review |
| Atomic commit | invalid/duplicate/review row blocks the entire transaction; stale preview/token rejected |
| Rollback/soft revert | untouched/unreferenced Drafts only; later evidence routes to retirement |
| Valid and invalid examples | valid row test plus explicit `difficulty=meduim` row/field rejection |

## Anti-pattern review

- No direct first-file insert path exists.
- Normalization changes known casing/spacing only; it never repairs a typo or creates a lookup value.
- Partial import is forbidden and cannot silently leave valid rows behind.
- Exact text is not the only duplicate signal.
- The correct option is never inferred. A value outside A-D is a blocking error.

## Risk controls

- Polluted data: frozen 46-column header, version gates, cross-field validation and post-check.
- Widespread duplicates: in-batch and existing-bank exact/fingerprint checks plus reviewed semantic flag.
- Wrong lesson mapping: lesson ID/code and subtopic ownership must agree.
- Half-finished import: all-or-none transaction; count/Draft/audit post-check runs before success.

## Dependencies and decisions

- Stage 24 must execute PostgreSQL/API/browser/concurrency/malformed-file/property/performance tests against real adapters.
- Stage 25 decides raw-file retention, scanning, privacy and abuse controls.
- Stage 26 selects object storage, worker topology and proves backup/restore.
- Stage 27 calibrates semantic duplicate thresholds from reviewed batches; v1.0 never auto-merges.
- The Stage 22 staff import route remains an explicit product surface; Stage 23 supplies its server contract but does not move validation into the browser.

## Readiness

Dedicated behavior tests pass 20/20, integrated Python tests pass 162/162, static JSON/YAML/Python/SQL checks pass, and the Stage 23-only package manifest is verified during packaging. The status is `REFERENCE_IMPLEMENTATION_VALIDATED_PENDING_OWNER_ACCEPTANCE`: technically ready for Stage 24, while formal Iman acceptance and live PostgreSQL/object-storage execution remain explicit.

# Stages 16–20 repository handoff

Prepared from `main` commit `74736cb04d5868a629bdf67c4d4cbd8470400da7`.

## Stage 1–15 baseline comparison

The Library `MANIFEST.sha256.json` for `grammar-mastery-baseline-v1.0` contains 68 files and matches the repository baseline semantically. Fifty files match byte-for-byte. The remaining 18 are CSV files whose only difference is Git line-ending normalization (Library CRLF, repository LF); converting the repository copies back to CRLF reproduces every Library checksum.

No Stage 1–15 content/data/model change is being carried by this handoff.

## Stage 16

Imported from the persisted Library package `stage16-v0.9-review`. The source package manifest was checksum-verified before repository mapping. Reference tests: 26/26 PASS. SQLite integration evidence: PASS.

## Stage 17

Imported from the persisted Library package `stage17-v0.9-review`. The source package manifest was checksum-verified before repository mapping. Reference tests: 32/32 PASS. SQLite integration evidence: PASS.

## Stage 18

No persisted `stage18_*` Library artifact was found. The repository package is an explicit reconstruction from the roadmap and Stage 15–17 contracts. The Critical threshold (<40) is a versioned product-policy choice introduced by this reconstruction and remains owner-reviewable.

## Stage 19

The original sandbox package was not persisted, but the prior conversation summary recovered: `stage19_ia_site_pages_v0.9.zip`, seven artifact filenames, 12 page responsibilities, 26 canonical routes, four parameterized templates, `/en` and `/fa` locale policy, and 63 PASS / 0 FAIL / 0 WARN. Those invariants are preserved in the reconstructed repository contract.

## Stage 20

The original sandbox package was not persisted. The prior conversation recovered `stage20_admin_panel_v1.0.zip` and core artifact names for delivery documentation, admin API, audit migration and bulk-import schema. The reconstructed contract additionally preserves Stage 11 independent review, Stage 12 immutable history and the roadmap permission/bulk/audit requirements.

## Validation

- Stage 1–15 baseline data validation: PASS.
- Original repository-ready package tests: 74/74 PASS (6 baseline + 26 Stage 16 + 32 Stage 17 + 10 Stage 18–20).
- Conservative integration-hardening regressions: 11/11 PASS.
- Final repository unit/integration tests after hardening: 85/85 PASS.
- JSON syntax: PASS.
- Stage 20 YAML parse: PASS.
- `git diff --check`: PASS.

## Conservative integration hardening

The repository integration adds compatibility and fail-closed corrections without changing the declared Stage 16/17 semantic model versions:

- Stage 16 accepts Python/PostgreSQL booleans and SQLite `0/1` values, rejects ambiguous correctness values, and safely supports one-shot iterables in repeat filtering.
- Stage 17 keeps its in-code default configuration aligned with the canonical JSON/schema, validates all required version/safety/event/queue policies, and uses timezone-safe SQLite due-date comparison.
- Stage 19 preserves 26 canonical localized landing routes and classifies `/:locale/review/:group_key` as a supplemental deep-link template outside that landing-route count.
- Stage 20 forces bulk imports to `DRAFT`, prevents bulk approval/publication/rejection/retirement, preserves Stage 11 review/publish gates, maps `CONTENT_EDITOR` to Stage 12 `CONTENT_AUTHOR`, and links the Stage 20 domain audit log to canonical Stage 12 audit history.
- The Stage 20 YAML is structurally complete as an OpenAPI 3.1 contract while implementation remains owned by Stage 21/22.

The original Stage 16/17 source manifests remain unchanged as provenance records. Repository-mapped files that received the hardening above are intentionally no longer byte-identical to those source-package hashes.

## Runtime boundaries

Stage 13–17 live learning behavior still requires a reviewed `PUBLISHED` question inventory and real user history. Stage 20 defines the admin product/technical contract; Stage 21/22 own backend/frontend implementation.

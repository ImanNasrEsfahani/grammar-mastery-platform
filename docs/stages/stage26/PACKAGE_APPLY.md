# Apply the Stage 26-only overlay

Base reviewed main commit: `f5f281ed52c30667d02e7a8d40d0cbba6d537791` (Stage 25 integrated).

1. Verify the ZIP SHA-256 from the handoff.
2. Extract this archive at the repository root, preserving relative paths.
3. Review `docs/stages/stage26/needs_decision_v1.0.csv`. Do **not** replace provider placeholders with secrets in Git.
4. Run `PYTHONPATH=src python tools/validate_stage26.py` from the full repository.
5. Run `PYTHONPATH=src python -m unittest tests.test_stage26_operations -v`, then the full repository suite and frontend validation.
6. Use `.github/workflows/stage26-release-gate.yml` as a release-readiness gate. It does not claim or silently perform a provider deployment.
7. After providers/origins exist, create a real release evidence record matching `schemas/stage26_release_evidence_v1.0.schema.json` and pass it through `python ops/stage26/release_gate.py`.

No commit, push, database migration or production change is performed by this package itself.

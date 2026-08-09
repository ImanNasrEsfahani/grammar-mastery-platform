# Apply the Stage 25-only overlay

This archive contains only files introduced by Stage 25. Apply it to repository `main` commit `b6ba24c` or a reviewed descendant with Stages 21–24 present.

1. Verify the ZIP SHA-256 supplied in the handoff.
2. Extract at the repository root, preserving relative paths.
3. Review the five entries in `needs_decision_v1.0.csv`; do not silently enable automated deletion.
4. Set `PYTHONPATH=src` and run `python tools/validate_stage25.py`.
5. Run `python -m unittest tests.test_stage25_security -v`, then the full repository suite.

No database migration, commit or push is performed by this overlay. Stage 26 must integrate production providers and record deployed/restore evidence.

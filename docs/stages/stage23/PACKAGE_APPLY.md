# Apply the Stage 23-only Package

The ZIP contains only files added or modified for Stage 23. It is an overlay, not a standalone repository.

1. Start from the repository state that already contains Stages 1-22.
2. Inspect `docs/stages/stage23/package_manifest_v1.0.json` and verify the ZIP checksum supplied with the package.
3. Extract at the repository root, preserving paths and allowing the Stage 23 versions of `README.md`, `STATUS.md` and `requirements.txt` to replace their Stage 22 versions.
4. Review the diff before commit. Do not copy any wrapper directory or temporary validation files.
5. Run `python -m pip install -r requirements-dev.txt`, `python tools/validate_stage23.py` and `python -m unittest discover -s tests -v`.
6. Execute PostgreSQL Patch 007 only in the eventual reviewed migration environment. This package does not apply it automatically.

The package does not contain prior-stage files except the three intentional root/dependency updates named above. It performs no Git commit or push.

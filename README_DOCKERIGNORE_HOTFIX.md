# Canonical Seed Docker Context Hotfix v1

Root cause: `.dockerignore` excluded the entire `data/` tree, while the canonical
reference-seed Dockerfile now copies eight pinned CSV files from `data/`.

This hotfix changes only `.dockerignore`. It keeps the general data tree out of
the Docker build context while allowing exactly the eight canonical CSV inputs
required by `ops/stage12/seed_canonical_reference.py`.

No database writes, migrations, runtime code changes, or stage aggregation are
included.

# Empty-production bootstrap patch v2

This corrective patch contains the Stage 26 empty-production bootstrap mode and
two fixes required for the current deployment:

1. Fix `git_blob_sha()` to use the real Git blob header NUL byte:
   `f"blob {len(data)}\0"` rather than a literal backslash + `0`.
   This resolves false `migration identity mismatch` errors for canonical
   migrations 001 through 007.
2. Add `backups/` to the root `.gitignore` so server-side database backup files
   do not appear as untracked Git files.

The normal Stage 26 production gate remains unchanged for non-empty production
databases.

After merging this patch into `main`, pull/re-sync the server, rebuild the
backend image, and confirm:

    docker compose exec backend python ops/stage26/migration_runner.py --help | grep bootstrap

Then run the production bootstrap using the already successful rehearsal DB and
a real backup ID.

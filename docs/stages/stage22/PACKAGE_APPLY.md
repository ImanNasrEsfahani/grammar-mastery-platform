# Applying the Stage 22 Package

This archive is a cumulative repository overlay for GitHub `main` commit `4c0bf330a9f692659223731bbebf74fbc6f1ba0c`.

The inspected `main` branch contains Stages 1–20 but not Stage 21. Because Stage 22 imports the Stage 21 OpenAPI contract and depends on its Django/Next.js framework decision, this archive includes the checksum-verified Stage 21 Django/DRF package plus the new Stage 22 files. Apply the archive at the repository root; preserve paths and allow Stage 22 `README.md` and `STATUS.md` to replace the earlier versions.

No source book PDF, roadmap PDF, dependency directory (`node_modules`) or Next.js build output (`.next`) is included.

After applying:

```bash
python -m pip install -r requirements-dev.txt
python tools/validate_baseline.py
python -m unittest discover -s tests -v
python tools/validate_stage21.py
python tools/validate_stage22.py
cd frontend
npm ci
npm run validate
```

Expected evidence: 142 Python tests, 12 dedicated Stage 22 contract checks, 7 frontend tests, clean ESLint and strict TypeScript checks, and a successful Next.js production build.

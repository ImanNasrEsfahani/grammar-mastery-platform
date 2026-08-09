# Publish this baseline to GitHub

Target repository: `ImanNasrEsfahani/grammar-mastery-platform`

> Before publishing, decide whether the repository should remain public. Source PDFs are excluded, but the repository contains project-derived grammar knowledge and internal design artifacts.

## Safe local workflow

```bash
git clone https://github.com/ImanNasrEsfahani/grammar-mastery-platform.git repo
cd repo
# Copy the CONTENTS of grammar_mastery_baseline_v1 into this directory, preserving paths.
git status
git add .
git commit -m "chore: establish Stage 1-15 canonical baseline"
git push origin main
```

If you prefer review before merging, create a branch before copying:

```bash
git checkout -b baseline/stage-1-15-v1
# copy files, then:
git add .
git commit -m "chore: establish Stage 1-15 canonical baseline"
git push -u origin baseline/stage-1-15-v1
```

Then open a pull request into `main`.

## Validation before commit

```bash
python tools/validate_baseline.py
python -m unittest discover -s tests -v
```

Expected result: baseline validation PASS and 6 integration smoke tests PASS.

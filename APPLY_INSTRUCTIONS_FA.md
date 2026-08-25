# روش اعمال امن

## روش پیشنهادی: dry-run و سپس write

ZIP را extract کنید. از root checkout پروژه ابتدا فقط baseline check بگیرید:

```bash
python /PATH/TO/test_builder_selection_hotfix_2026-08-24/apply_hotfix.py \
  --repo-root .
```

این دستور هیچ فایلی را تغییر نمی‌دهد. ابزار Git blob دو فایل مقصد را با نسخه‌ای که روی commit مبنا بررسی شده مقایسه می‌کند و در صورت drift، fail-closed می‌شود.

اگر `Baseline check: PASS` بود:

```bash
python /PATH/TO/test_builder_selection_hotfix_2026-08-24/apply_hotfix.py \
  --repo-root . \
  --write \
  --with-test
```

این کار فقط checkout محلی را تغییر می‌دهد؛ commit یا push نمی‌کند.

## Validation محلی

از root repository:

```bash
python -m py_compile \
  src/test_generator/generator.py \
  src/adaptive/selector.py
```

سپس تست جدید:

```bash
python -m unittest -v tests/test_selection_fairness_hotfix.py
```

و حداقل regression اصلی:

```bash
python -m unittest -v tests/test_core.py tests/test_runtime_lessons_tests_provider.py
```

اگر محیط کامل تست پروژه آماده است، اجرای کل suite ارجح است.

## بعد از اعمال روی سرور Docker

این hotfix migration دیتابیس ندارد. چون کد Backend تغییر می‌کند، image مربوط به backend باید rebuild/recreate شود. از root پروژه:

```bash
docker compose --env-file .env.docker build backend

docker compose --env-file .env.docker up -d --no-deps --force-recreate backend

docker compose --env-file .env.docker ps backend
```

پس از بالا آمدن سرویس، یک تمرین `custom` با scope همه درس‌ها، یک `tcf` و یک `adaptive` بسازید و snapshotهای `tests.config` / `test_questions.selection_reason` را audit کنید.

## نکته درباره baseline drift

اگر ابزار اعلام کرد Git blob با baseline فرق کرده، به‌صورت خودکار فایل را overwrite نکنید. main از commit مبنا به بعد تغییر کرده و لازم است همان دو فایل دوباره merge/review شوند. گزینه `--skip-baseline-check` فقط برای حالتی است که خودتان تغییرات جدید را دستی بررسی کرده باشید.

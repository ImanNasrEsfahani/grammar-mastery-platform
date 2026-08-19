# Question Bank Bootstrap Progress Logging v1.0

این بسته برای اضافه‌کردن **گزارش مرحله‌به‌مرحله و رنگی** به فایل زیر آماده شده است:

`ops/question_bank/bootstrap.py`

مبنای بررسی read-only:

- Repository: `ImanNasrEsfahani/grammar-mastery-platform`
- Branch: `main`
- Reviewed commit: `1d23edcf8399b313e7fa629267de44a28e4580da`
- Reviewed `bootstrap.py` Git blob: `36ce26fd729ae5f1d689d3a5c6b13b071174e955`

هیچ commit یا push انجام نمی‌شود. ابزار داخل این بسته فقط روی checkout محلی شما کار می‌کند و پیش‌فرض آن **dry-run** است.

## چه چیزی اضافه می‌شود؟

در زمان اجرای `bootstrap.py` هر مرحله ابتدا با `RUNNING` نمایش داده می‌شود و سپس:

- `FINISHED / SUCCESS` با رنگ سبز
- `FAILED` با رنگ قرمز
- `SKIPPED` با رنگ زرد
- `RUNNING` با رنگ cyan

در خطا، علاوه بر پیام قرمز، خلاصه نهایی دقیقاً مشخص می‌کند:

- آخرین مرحله موفق (`last_completed_stage`)
- مرحله شکست‌خورده (`failed_stage.code` و `failed_stage.name`)
- آیا commit دیتابیس انجام شده یا خیر (`database_commit_completed`)
- اگر قبل از commit شکست رخ داده باشد، پیام rollback نمایش داده می‌شود.

## مراحل قابل مشاهده

| Code | Operation |
|---|---|
| S00 | Validate command-line publication arguments |
| S01 | Load and validate canonical Question Bank source |
| S02 | Connect to PostgreSQL |
| S03 | Verify Stage12 schema and canonical reference seed |
| S04 | Seed Stage6 question types and compatibility |
| S05 | Seed Stage7 misconceptions and build identity map |
| S06 | Resolve Question Bank misconception compatibility bridge |
| S07 | Upsert questions, options, tags and subtopics |
| S08 | Run live Stage11 machine validation gate |
| S09 | Register validation PASS evidence |
| S10 | Publication workflow (reviewed/canonical) or SKIPPED |
| S11 | Verify final database status and serving postcondition |
| S12 | Commit PostgreSQL transaction |
| DONE | Bootstrap finished successfully |

## نمونه خروجی موفق

```text
[20:31:02] [QB-BOOTSTRAP][S01][RUNNING] Load and validate canonical Question Bank source
[20:31:03] [QB-BOOTSTRAP][S01][FINISHED] Load and validate canonical Question Bank source | SUCCESS; rows=8175; source=question_bank_seed_catalog.json; 0.74s
...
[20:31:15] [QB-BOOTSTRAP][S12][FINISHED] Commit PostgreSQL transaction | SUCCESS; transaction committed; database changes persisted; 0.18s
[20:31:15] [QB-BOOTSTRAP][DONE][FINISHED] Question Bank bootstrap | SUCCESS; target_questions=8175; committed=yes
```

## نمونه خروجی خطادار

```text
[20:31:08] [QB-BOOTSTRAP][S07][FAILED] Upsert questions, options, tags and subtopics | BootstrapError: ...
[20:31:08] [QB-BOOTSTRAP][STOP][STOPPED] Bootstrap halted | last_failed_stage=S07 (Upsert questions, options, tags and subtopics); database transaction was not committed; transactional DB changes were rolled back
```

در JSON خطا نیز چیزی شبیه این اضافه می‌شود:

```json
{
  "progress": {
    "completed_stages": ["S00", "S01", "S02", "S03", "S04", "S05", "S06"],
    "last_completed_stage": "S06",
    "failed_stage": {
      "code": "S07",
      "name": "Upsert questions, options, tags and subtopics",
      "error": "BootstrapError: ..."
    },
    "database_commit_completed": false
  }
}
```

## روش اعمال امن

بسته را جایی extract کنید و از root ریپازیتوری ابتدا dry-run بگیرید:

```bash
python /PATH/TO/apply_bootstrap_progress_logging_v1_0.py --repo-root .
```

این دستور هیچ فایلی را تغییر نمی‌دهد و diff پیشنهادی را نشان می‌دهد.

برای اعمال واقعی روی checkout محلی:

```bash
python /PATH/TO/apply_bootstrap_progress_logging_v1_0.py --repo-root . --write
```

ابزار قبل از تغییر، Git blob فایل فعلی را با نسخه‌ای که بررسی شده مقایسه می‌کند. اگر `bootstrap.py` از زمان این بسته تغییر کرده باشد، **fail-closed** می‌شود و هیچ تغییری اعمال نمی‌کند.

بعد از اعمال:

```bash
python -m py_compile ops/question_bank/bootstrap.py
```

و سپس bootstrap را با همان روش معمول خود اجرا کنید.

## کنترل رنگ و progress

حالت پیش‌فرض رنگ `auto` است؛ اگر terminal یک TTY باشد رنگ نمایش داده می‌شود.

برای اجبار رنگ (مثلاً در بعضی Docker/CI logها):

```bash
GMP_BOOTSTRAP_COLOR=always python ops/question_bank/bootstrap.py
```

برای حذف رنگ ولی نگه داشتن پیام‌های progress:

```bash
GMP_BOOTSTRAP_COLOR=never python ops/question_bank/bootstrap.py
```

برای خاموش کردن کامل progress و نزدیک‌شدن به خروجی قدیمی:

```bash
GMP_BOOTSTRAP_PROGRESS=0 python ops/question_bank/bootstrap.py
```

`NO_COLOR=1` نیز پشتیبانی می‌شود.

## نکته مهم درباره transaction

مرحله‌های S03 تا S11 داخل transaction دیتابیس اجرا می‌شوند. سبزشدن آنها یعنی آن عملیات داخل transaction با موفقیت انجام شده، اما **فقط سبزشدن S12 به معنی persist/commit شدن تغییرات است**. اگر S07 یا S08 یا هر مرحله قبل از S12 fail شود، transaction commit نمی‌شود و تغییرات transactional rollback می‌شوند.

## حفظ سازگاری خروجی

Progress lines عمداً روی `stderr` نوشته می‌شوند. JSON موفق اصلی همچنان روی `stdout` باقی می‌ماند تا مصرف‌کننده‌های ماشینی خروجی موفق شکسته نشوند. در JSON خطا فقط یک فیلد افزوده‌ی `progress` اضافه شده است.

## Stage23

این تغییر Stage23 Import/Preview/Commit را اجرا یا باز نمی‌کند. وضعیت پروژه همچنان:

`STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT`

این marker فقط blocker مرحله Import/Preview/Commit است و تغییری در static/bootstrap validation ایجاد نشده است.

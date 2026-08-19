# Apply order

1. مطمئن شوید checkout شما روی نسخه‌ای است که `ops/question_bank/bootstrap.py` آن Git blob برابر `36ce26fd729ae5f1d689d3a5c6b13b071174e955` دارد.
2. Dry-run:
   `python apply_bootstrap_progress_logging_v1_0.py --repo-root /PATH/TO/grammar-mastery-platform`
3. Diff را بررسی کنید.
4. Apply:
   `python apply_bootstrap_progress_logging_v1_0.py --repo-root /PATH/TO/grammar-mastery-platform --write`
5. Syntax check:
   `python -m py_compile ops/question_bank/bootstrap.py`
6. Bootstrap را با command معمول پروژه اجرا کنید.
7. در خطا، اولین خط `[FAILED]` و سپس `[STOPPED]` را بخوانید؛ JSON نهایی نیز `failed_stage` و `last_completed_stage` دارد.
8. فقط `S12 FINISHED` به معنی commit شدن تغییرات DB است.

هیچ commit/push توسط این بسته انجام نمی‌شود و Stage23 Import/Preview/Commit اجرا نمی‌شود.

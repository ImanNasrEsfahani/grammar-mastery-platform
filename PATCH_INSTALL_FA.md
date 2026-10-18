# Grammar Mastery — راهنمای نصب بسته همگام‌سازی وضعیت و بررسی ایستا

**نسخه بسته:** 2026-10-17  
**مخزن هدف:** https://github.com/ImanNasrEsfahani/grammar-mastery-platform  
**مبنای بررسی GitHub:** `9fda187ce939be1d0722a94640e2a7a4630740b4`

## این بسته چه مشکلی را حل می‌کند؟

- `STATUS.md`: معرفی محصول به‌عنوان سامانه فعال با مشتریان واقعی؛ جداسازی وضعیت واقعی محصول از گزارش‌های تاریخی و شمارش بانک منبع ۱۰٬۶۳۶ سؤال.
- `README_FRESH_DATABASE_WITH_PUBLISHED_QUESTIONS.md`: جایگزین‌کردن راهنمای قدیمی و خطرناکِ Drop/Recreate با دستورالعمل ایمن که دیتابیس فعلی مشتریان را حفظ می‌کند.
- `docs/verification/`: مستندات اثبات‌پذیر درباره مرز شمارش بانک سؤال، خطای Stage 23، چک‌لیست عملیات و فرم رسمی تأیید انتشار.
- `tools/audit_project_static.py`: کنترل **فقط‌خواندنی** Schema، تعداد سؤال‌ها، تکراری‌نبودن شناسه‌ها و سازگاری وضعیت خطا.
- `tools/report_production_counts.sh`: نمایش فقط شمارش‌های تجمیعی دیتابیس روی سرور مجاز، بدون تغییر اطلاعات.
- `.github/workflows/source-inventory-audit.yml` و `tests/test_current_source_audit.py`: بررسی خودکار برای Pull Request و امکان اجرای دستی از Actions.

**عمداً تغییری روی کد اصلی آموزش، سؤال‌ها، مهاجرت‌های SQL، فایل‌های داده، secrets یا README فعلی اعمال نمی‌شود.** README فعلی پروژه درست است و در GitHub منتشر شده. Stage 23 با این بسته رفع نمی‌شود؛ فقط وضعیت و فرایند عیب‌یابی آن شفاف می‌گردد.

## روش امن نصب

**نکته:** GitHub فایل ZIP را خودکار استخراج یا با Repository ادغام نمی‌کند. ابتدا ZIP را روی دستگاهت استخراج کن و فایل‌ها را با **همان مسیرهای داخلی** جایگزین/اضافه کن.

### با Git روی کامپیوتر

```bash
# 1) در یک مخزن محلی به‌روز و بدون تغییرات ناخواسته:
git status --short
git switch main
git pull --ff-only origin main
git switch -c chore/gmp-status-and-static-audit

# 2) ZIP را استخراج و فایل‌های آن را (با ساختار پوشه‌ها) در ریشه مخزن کپی کن.
#   README.md فعلی را تغییر نده. ZIP شامل آن نیست.

# 3) کنترل بعد از کپی، پیش از Commit:
python -m unittest discover -s tests -p 'test_current_source_audit.py' -v
python tools/audit_project_static.py --root .
git diff --check
git status --short

# 4) مرور تغییرات، Commit و ساخت Pull Request:
git diff -- STATUS.md README_FRESH_DATABASE_WITH_PUBLISHED_QUESTIONS.md
git add STATUS.md README_FRESH_DATABASE_WITH_PUBLISHED_QUESTIONS.md \
  PATCH_INSTALL_FA.md docs/verification/ tools/audit_project_static.py \
  tools/report_production_counts.sh tests/test_current_source_audit.py \
  .github/workflows/source-inventory-audit.yml
git commit -m "docs: reconcile live status and add read-only verification gates"
git push -u origin chore/gmp-status-and-static-audit
```

سپس در GitHub یک Pull Request باز کن و پس از کنترل، Merge کن. اگر بعد از ثبت SHA مبنا فایل‌های موجود تغییر کرده‌اند، پیش از جایگزینی دستی `git diff` بگیر و تغییرات جدید را حفظ کن؛ فایل‌ها را کورکورانه Overwrite نکن.

### فقط با رابط وب GitHub

فایل‌های ZIP را استخراج کن، سپس هر فایل را در مسیر دقیق مشخص‌شده در GitHub بارگذاری/ویرایش کن. برای `STATUS.md` و `README_FRESH_DATABASE_WITH_PUBLISHED_QUESTIONS.md` متن قبلی جایگزین می‌شود؛ بقیه مسیرها معمولاً فایل‌های جدید هستند. یک Commit/PR مستقل برای این بسته بساز.

## آزمون‌ها و معنای نتیجه آنها

- چهار تست ابزار audit روی Fixtureهای مصنوعی در زمان ساخت بسته PASS شدند.
- در GitHub Actions بعد از اعمال بسته، `source-inventory-audit` می‌تواند ۵۲ CSV واقعی و کاتالوگ را بررسی کند؛ **تا آن زمان این آزمون روی همه فایل‌های واقعی در این محیط اجرا نشده است**.
- اگر خروجی `PASS_STATIC_WITH_OPEN_GATES` است: فایل‌های منبع با هم سازگارند، اما Stage 23 هنوز علامت خطای باز دارد و Production تأیید نشده است.
- اگر خروجی `FAIL_STATIC` است: قبل از Merge خطا را بررسی کن؛ هرگز برای سبزکردن تست فایل‌های اعتبارسنجی یا Markerها را دست‌کاری نکن.
- اسکریپت شمارش Production را **فقط روی سرور مجاز** و پس از اطمینان از اتصال درست اجرا کن و نتایج را در `docs/verification/RELEASE_ACCEPTANCE_RECORD.md` (بدون اطلاعات خصوصی) ثبت کن.

## مواردی که این بسته نمی‌تواند ۱۰۰٪ تأیید کند

1. یکپارچگی و صحت داده‌های واقعی دیتابیس کاربران.
2. حل قطعی خطای Stage 23 و تمام Migrationهای محیط جاری.
3. تست End-to-End تمام مسیرهای کاربر با Backend و دیتابیس زنده.
4. Backup/restore عملیاتی، Privacy/Security، Uptime و Performance واقعی.
5. تأیید انسانی نهایی مالک محصول.

بنابراین این ZIP یک **بسته اصلاح و سنجش ایمن** است، نه گواهینامه تکمیل صددرصد. پس از تکمیل چک‌لیست‌های Production و رفع ایرادهای واقعی با تست، می‌توان درباره Release نهایی تصمیم گرفت.

## منابع داخلی

- [STATUS.md](STATUS.md)
- [برنامه بررسی Production](docs/verification/PRODUCTION_VERIFICATION.md)
- [وضعیت Stage 23](docs/verification/QUESTION_BANK_IMPORT_STATUS.md)
- [سند پذیرش](docs/verification/RELEASE_ACCEPTANCE_RECORD.md)

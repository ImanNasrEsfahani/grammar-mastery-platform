# گزارش نهایی تکمیل Stage 6 تا Stage 9

## نتیجه

| Stage | Controller | نتیجه |
|---|---|---|
| 6 | Question Type Catalogue Controller | COMPLETE |
| 7 | Distractor / Misconception Controller | COMPLETE |
| 8 | Difficulty Model Controller | COMPLETE |
| 9 | Difficulty Distribution Controller | COMPLETE؛ Inventory Conformance = DRIFT_DETECTED |

## Stage 6
بانک نهایی 10,636 سؤال دارد و هر 15 نوع سؤال فعلی در آن مشاهده شده‌اند. قرارداد تکمیلی برای هدف آموزشی، ساختار stem، distractor، ambiguity، compatibility، UI و media برای هر 15 type در فایل کنترلر ثبت شده است.

## Stage 7
dependency عملیاتی `config/stage7_distractor_rules.json` که در orchestration انتظار می‌رود، در بسته اضافه شده است. قراردادهای G01 تا G12، حفظ IDهای تاریخی misconception، اتصال distractor به misconception و traceability کامل شده‌اند. README قدیمی Stage 7 نیز با وضعیت واقعی فعلی جایگزین شده است.

## Stage 8
مدل اولیه و مدل observed/calibrated به‌صورت صریح از هم جدا شده‌اند. difficulty اولیه متعلق به revision سؤال است و داده واقعی کاربران حق overwrite کردن آن را ندارد. ambiguity نیز به Very Hard تبدیل نمی‌شود و باید BLOCKED_NOT_SCORABLE شود.

## Stage 9
Target کل = 10,636 و Actual کل = 10,636.

Target difficulty = EASY 2,180, MEDIUM 4,116, HARD 3,203, VERY_HARD 1,137.

Actual difficulty = EASY 2,181, MEDIUM 4,116, HARD 3,203, VERY_HARD 1,136.

51/52 درس دقیقاً منطبق هستند. تنها اختلاف L51/B230 است: Target = 36/71/95/36 و Actual = 37/71/95/35. این اختلاف عمداً پنهان یا با تغییر خودکار difficulty یک سؤال اصلاح نشده است، چون چنین کاری تاریخچه و مدل Stage 8 را مخدوش می‌کند.

## سیاست اعمال فایل‌ها
این overlay برای جلوگیری از Manifest Hash Drift، فایل‌های canonical سالم و hash-sensitive Stage 6، Stage 8 و Stage 9 را بازنویسی نمی‌کند. فقط فایل‌های کنترلر/گزارش جدید را اضافه می‌کند و README قدیمی Stage 7 را جایگزین می‌کند.

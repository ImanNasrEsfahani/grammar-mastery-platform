# Stage 17 Review Report — Spaced Repetition State Machine

- Package: `stage17-v0.9-review`
- Scheduler: `spaced-review-v0.9.0`
- State machine: `spaced-review-state-machine-v0.9.0`
- Reference validation: **32/32 PASS**
- SQLite integration after Stage15 + Stage16: **PASS** (`integrity_check=ok`, FK violations = 0)
- Governance: **Iman = Stage Owner + Content Owner + Technical Owner + Product Owner + Final Reviewer**
- Formal Ready: **pending Iman acceptance after review of this Stage17 package**

## 1) هدف و انطباق با نقشه راه

مرحله ۱۷ دقیقاً state machine صریح راهنما را operationalize می‌کند: `NEW`، `LEARNING`، `REVIEW`، `LAPSED` و `SUSPENDED`. نکتهٔ ضد حفظ‌کردن جمله نیز اجرا شده است: scheduler خود `SUBTOPIC` را due می‌کند و سؤال واقعی هنگام serving از pool امن همان مفهوم انتخاب می‌شود.

## 2) تفکیک دو نوع state

مرحله ۱۲ از قبل در `review_queue.status` وضعیت‌های عملیاتی `SCHEDULED/DUE/COMPLETED/SUSPENDED` را دارد. اینها با وضعیت آموزشی مرحله ۱۷ یکی نیستند. بنابراین Stage17 به‌صورت افزایشی `learning_state` را اضافه می‌کند و schema قدیمی را بازتعریف یا حذف نمی‌کند. این تصمیم ambiguity میان «آیا موعد رسیده؟» و «کاربر در چه وضعیت یادگیری است؟» را از بین می‌برد.

## 3) قواعد transition و interval

پارامترهای v0.9 configuration هستند، نه hard-code غیرقابل تغییر:

- `LEARNING`: مرور ۱ روزه و سپس ۳ روزه برای موفقیت ناپایدار.
- ورود به `REVIEW`: ۷ روز پس از موفقیت پایدار.
- `REVIEW` پایدار: interval دو برابر می‌شود، حداکثر ۱۸۰ روز.
- خطا بعد از mastery/`REVIEW`: ورود به `LAPSED` و `clamp(old × 0.25, 1, 3)`؛ history پاک نمی‌شود.
- recovery از `LAPSED` با نتیجه STRONG: interval سه‌روزه و بازگشت به `REVIEW`.

این مقادیر `INITIAL_VERSIONED_CONFIGURATION` هستند و calibration تجربی آنها در Stage27 انجام می‌شود.

## 4) تعریف «موفقیت پایدار»

Stage17 threshold مستقل و پنهان نمی‌سازد. موفقیت پایدار همان `mastery_band=STRONG` مرحله ۱۵ است که confidence را از قبل داخل منطق خودش لحاظ می‌کند. ورودی باید از `mastery-provider-contract-v0.9.0` بیاید؛ mismatch نسخه fail-closed است.

## 5) Lapsed بدون حذف تاریخچه

فقط خطای کاربر در حالت `REVIEW` یک lapse جدید می‌سازد. `lapse_count` هنگام ورود به `LAPSED` یک واحد زیاد می‌شود؛ خطاهای متوالی در همان episode شمارنده را مصنوعی زیاد نمی‌کنند. `user_answers` دست‌نخورده می‌ماند و `spaced_review_events` append-only است.

## 6) Suspended و محتوای مشکل‌دار

retired/disabled/confirmed-content-issue شدن یک سؤال به‌تنهایی مفهوم را suspend نمی‌کند. آن سؤال از pool حذف می‌شود و scheduler می‌تواند سؤال سالم دیگری از همان subtopic بدهد. فقط اگر هیچ سؤال امنی باقی نماند، concept به `SUSPENDED` می‌رود؛ `state_before_suspend` و due تاریخی حفظ می‌شوند. پس از بازگشت pool امن، state قبلی restore و اگر موعد گذشته باشد مفهوم بلافاصله due می‌شود.

## 7) اتصال به Stage16

retryهای Error Review در v0.9 «resolution evidence» هستند و طبق قرارداد Stage16 نه test score و نه mastery evidence؛ بنابراین مستقیماً SRS را جلو نمی‌برند. `marked_for_review` فقط می‌تواند tie-break صف due باشد و تاریخ due را جلو نمی‌کشد. ابطال یک سؤال به‌عنوان content issue نیز lapse کاربر تولید نمی‌کند.

## 8) جلوگیری از حفظ‌کردن سؤال ثابت

Stage17 سه `question_uid` اخیر همان subtopic را به‌صورت soft exclusion به selector می‌دهد. اگر pool امن سؤال دیگری داشته باشد، سؤال تکراری انتخاب نمی‌شود. اگر soft exclusion همهٔ pool امن را خالی کند، فقط همین محدودیت تنوع relax می‌شود و `DIVERSITY_FALLBACK` audit می‌گردد؛ safety هرگز relax نمی‌شود.

## 9) Storage integration

Patch افزایشی Stage17 روی جدول موجود `review_queue` شش فیلد اضافه می‌کند و یک جدول audit جدید `spaced_review_events` و view به نام `v_spaced_review_due` می‌سازد. یک partial unique index نیز تضمین می‌کند هر user/subtopic فقط یک current Stage17 schedule داشته باشد. هیچ جدول Stage12/15/16 حذف یا بازنویسی نمی‌شود.

## 10) Validation

- ۳۲ تست Python: **PASS**.
- `py_compile`: **PASS**.
- JSON syntax: **PASS**.
- runtime config validation: **PASS**.
- Stage15 SQLite patch → Stage16 patch → Stage17 patch روی کپی واقعی Stage12: **PASS**.
- `PRAGMA integrity_check`: **ok**.
- `PRAGMA foreign_key_check`: **0**.
- executor استاندارد JSON Schema در runtime نصب نبود؛ schema فایل تولید شده و invariants اصلی با `validate_config` + tests اجرا شده‌اند.
- PostgreSQL target در این محیط موجود نبود؛ patch PostgreSQL تحویل شده اما اجرای live آن به مرحله deployment/runtime موکول است.

## 11) نمونهٔ عملی

نمونه با UUID واقعی subtopic `L32-S04 — Relatif « dont »` ساخته شد. مسیر مصنوعی اما deterministic آن `NEW → LEARNING → REVIEW → LAPSED → REVIEW → SUSPENDED → REVIEW` است و کاهش interval از ۱۴ روز به ۳ روز بعد از lapse را نشان می‌دهد. هیچ سؤال production ساختگی به‌عنوان inventory واقعی معرفی نشده است.

## 12) ریسک‌ها و کنترل‌ها

1. تکرار جمله ثابت: concept-level due + soft exclusion سه `question_uid` اخیر.
2. تمرین بیش از حد: فاصله ۱/۳ روز در Learning و رشد کنترل‌شده در Review.
3. حذف تاریخ پس از خطا: append-only event history + `lapse_count`.
4. نسبت دادن content issue به کاربر: Stage16 exclusion + عدم ساخت lapse از invalidation.
5. دو مدل موازی mastery: Stage17 از STRONG مرحله ۱۵ استفاده می‌کند و threshold دوم ندارد.

## 13) نقش‌ها و governance

مطابق تصمیم جدید پروژه، تمام نقش‌های اجرایی/تصمیم‌گیر این مرحله روی `Iman` ثبت شده‌اند. requirement مستقل Stage11 برای review واقعی سؤال‌های production همچنان یک کنترل انتشار محتواست و توسط Stage17 تغییر داده نمی‌شود.

## 14) نیازها / blockerها

برای تکمیل طراحی و reference implementation مرحله ۱۷ **هیچ ورودی یا تصمیم جدیدی از Iman لازم نیست**. فقط این موارد بیرونی/بعدی باقی می‌مانند:

- پذیرش رسمی همین package توسط Iman پس از مشاهده خروجی‌ها.
- live validation پس از وجود سؤال‌های `PUBLISHED` و تاریخچهٔ واقعی کاربر.
- اجرای PostgreSQL patch روی target واقعی deployment.
- calibration intervalها با داده واقعی در Stage27.

## 15) Definition of Done

- [x] State machine کامل پنج‌حالته
- [x] interval policy نسخه‌دار
- [x] Lapsed بدون حذف history
- [x] concept-level due + تنوع سؤال
- [x] Suspended/Resume امن
- [x] Stage12/15/16 integration
- [x] PostgreSQL + SQLite additive patches
- [x] worked example
- [x] 32 automated tests PASS
- [x] SQLite integration PASS
- [x] risk/failure contracts
- [ ] Final acceptance by Iman
- [ ] Live production validation

**نتیجه:** Stage17 از نظر طراحی، state machine، reference code، migration و validation **substantively complete / PASS** است و نقص طراحی مسدودکننده ندارد.

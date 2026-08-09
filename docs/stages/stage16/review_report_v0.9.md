# Stage 16 Review Report — Error Review

- Package: `stage16-v0.9-review`
- Model: `error-review-v0.9.0`
- Storage patch: `error-review-storage-patch-v0.9.0`
- Reference validation: **26/26 PASS**
- SQLite integration: **PASS** (`integrity_check=ok`, FK violations = 0)
- Upstream governance: **Iman = Content Owner + Technical Owner; authoritative source edition resolved**
- Live runtime validation: **EXPECTED BLOCK — no Published question inventory / no live answer history**
- Formal Ready: **pending final Iman acceptance of this Stage16 package**

## 1) هدف و انطباق با نقشه راه
مرحله ۱۶ پاسخ‌های غلط را به یک تجربهٔ مرور قابل جست‌وجو، فیلتر، گروه‌بندی و تکرار تبدیل می‌کند. پنج خروجی صریح راهنما همگی operationalized شده‌اند: `Review filters`، `mistake grouping`، `resolution status`، `review events` و `UX flow`.

## 2) ورودی و eligibility
منبع authoritative خطا همان `user_answers` مرحله ۱۲ است، با همان قاعدهٔ مرحله ۱۵: فقط آخرین `answer_sequence` برای هر `(attempt_id,test_question_id)` بررسی می‌شود. `is_correct=NULL` قابل امتیازدهی نیست و وارد Error Review نمی‌شود. هر review item به revision دقیق سؤال و snapshot آزمون مرحله ۱۳ متصل می‌ماند.

## 3) Review filters
قرارداد فیلتر شامل تاریخ، `lesson_id`، `subtopic_id`، `misconception_id`، `difficulty_code`، حداقل `repeat_count`، `resolution_status` و `marked_only` است. همهٔ شناسه‌ها stable UUID هستند؛ شماره درس فقط نمایش است.

## 4) Mistake grouping
کلید اصلی گروه `MISCONCEPTION:<uuid>` است. اگر distractor هنوز misconception معتبر نداشته باشد، به‌جای تشخیص ساختگی از `SUBTOPIC:<uuid>:UNMAPPED` استفاده می‌شود و این حالت به‌عنوان data-quality metric جدا می‌ماند. `repeat_count` تعداد خطاهای اصلی eligible است؛ retryهای ناموفق review این شمارنده را مصنوعی زیاد نمی‌کنند.

Default priority بدون weight حدسی و بدون دخالت در Stage17 است: marked → unresolved → repeat count بیشتر → آخرین خطای جدیدتر → stable key. بنابراین لیست بی‌اولویت ساخته نمی‌شود و scheduling همچنان مالکیت Stage17 می‌ماند.

## 5) Resolution status و review events
سه وضعیت پایدار داریم:
- `UNRESOLVED`: خطا هنوز با retrieval موفق اصلاح نشده است.
- `CORRECTED`: آخرین retry صحیح بوده است.
- `EXCLUDED_CONTENT_ISSUE`: خطا به مشکل محتوا/ambiguity مربوط است و نباید ضعف کاربر تلقی شود.

Eventها append-only هستند: `ITEM_OPENED`, `RETRY_SUBMITTED`, `ANSWER_REVEALED`, `MARKED_FOR_REVIEW`, `UNMARKED_FOR_REVIEW`, `CONTENT_EXCLUDED`, `CONTENT_REINSTATED`.

## 6) UX و retrieval practice
برای رفع تعارض ظاهری میان «نمایش پاسخ صحیح و توضیحات» و «نشان ندادن فوری جواب»، flow دو فاز دارد. ابتدا سؤال و گزینه‌های frozen نمایش داده می‌شوند ولی answer key پنهان است. پس از retry یا انتخاب صریح Reveal، پاسخ قبلی کاربر، پاسخ retry، جواب صحیح، توضیح همه گزینه‌ها و diagnostic misconception نمایش داده می‌شود. Reveal بدون retry ثبت می‌شود اما item را corrected نمی‌کند.

## 7) Retired و content issue
سؤال retired/disabled از تاریخچه حذف نمی‌شود؛ review item آن `HISTORY_ONLY` می‌شود و retry روی revision ناامن پذیرفته نمی‌شود. اگر سؤال بعداً ambiguous/invalid تأیید شود، raw answer پاک یا بازنویسی نمی‌شود؛ یک `learning_evidence_exclusion_event` append می‌شود تا replay بعدی Mastery آن answer را به ضعف کاربر نسبت ندهد. این تصمیم دقیقاً requirement ضد ambiguity راهنما را اجرایی می‌کند.

## 8) مرز با Mastery و SRS
Review retry در v0.9 وضعیت یادگیری/حل خطا است، نه test score و نه evidence جدید Mastery؛ بنابراین Stage16 هیچ تغییر مخفی در فرمول Stage15 ایجاد نمی‌کند. تنها integration اجباری با Stage15، حذف evidenceِ محتوای معیوب از replay است. Stage17 می‌تواند outcome/markها را مصرف کند، اما interval/due-date/strength در Stage16 محاسبه نمی‌شوند.

## 9) Storage integration
Patch افزایشی سه جدول و دو view اضافه می‌کند:
- `error_review_items`: current materialized state برای فیلتر سریع.
- `error_review_events`: audit append-only.
- `learning_evidence_exclusion_events`: audit append-only برای ambiguity/invalid content.
- `v_error_review_groups`: summary گروه‌های misconception.
- `v_learning_evidence_exclusion_state`: آخرین وضعیت eligibility هر answer.

هیچ جدول Stage12/15 حذف یا بازنویسی نمی‌شود.

## 10) مثال واقعی‌نما با شناسه‌های واقعی upstream
Fixture از Lesson 32 `LES RELATIFS` و subtopic واقعی `L32-S04 Relatif « dont »` با UUID `cc58425c-1b50-4810-99a1-446683b31f5f` استفاده می‌کند. خانواده `NEAR_FORM_CONFUSION` در policy مرحله 7 تأیید می‌شود؛ UUID misconception یعنی `dac62b22-7d9b-540f-b765-e4ad0c1fd476` از fixture بسته مبدأ حفظ شده ولی در artifactهای canonical فعلی Stage 1–15 مستقلاً وجود ندارد. خود سؤال‌ها/کاربر/پاسخ‌ها مصنوعی‌اند چون production inventory هنوز صفر است.

## 11) Validation
- 26 تست Python: **PASS**.
- Stage16 SQLite patch پس از Stage15 patch روی کپی واقعی Stage12: **PASS**.
- `PRAGMA integrity_check`: **ok**.
- `PRAGMA foreign_key_check`: **0**.
- valid و invalid fixture هر دو ثبت شده‌اند.
- JSONها syntax-valid هستند؛ library `jsonschema` در runtime نصب نبود، اما invariants اصلی schema در `validate_config` و automated tests اجرا شده‌اند.

## 12) ریسک‌ها و کنترل
1. انباشت بی‌پایان: grouping + priority + filters؛ detection با queue/group size.
2. مرور منفعل: feedback gate؛ detection با `reveal_without_retry_rate`.
3. نسبت دادن خطای سؤال به کاربر: evidence exclusion؛ detection با mismatch میان confirmed ambiguity و mastery eligibility.
4. تکرار بیش از حد: Stage16 scheduler نمی‌سازد؛ شمارش review و handoff به Stage17 قابل audit است.
5. misconception بدون mapping: fallback صریح و metric جدا، بدون diagnosis ساختگی.

## 13) Definition of Done
- [x] Review filters
- [x] Mistake grouping
- [x] Resolution status
- [x] Review events
- [x] Retrieval-safe UX flow
- [x] Valid + invalid examples
- [x] 26 automated tests PASS
- [x] PostgreSQL + SQLite additive patches
- [x] Retired-history preservation
- [x] Ambiguity/content-error evidence exclusion
- [x] Stage17/18/21/25/27 dependency contracts
- [ ] Final Content/Technical acceptance by Iman
- [ ] Live production validation — cannot run until Published questions and real user answers exist

**نتیجه:** Stage16 از نظر طراحی، قرارداد داده، reference code، DB integration و validation **substantively complete / PASS** است. هیچ تصمیم طراحی جدیدی از کاربر لازم نیست. پس از پذیرش Iman، وضعیت می‌تواند `Ready for Next Stage` شود و Stage17 طراحی گردد.

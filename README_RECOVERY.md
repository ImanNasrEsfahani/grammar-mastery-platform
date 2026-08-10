# Grammar Mastery Platform — Question Authoring Recovery v1.0

این بسته برای تکمیل جزئیات Stage 6 و Stage 7 که در baseline فعلی GitHub فقط به‌صورت policy خلاصه نگهداری شده‌اند ساخته شده است.

## وضعیت
- Validation: **PASS**
- 52 lesson / 304 subtopic / 15 question type
- Stage 6: 4,560 subtopic×type compatibility + 780 lesson×type compatibility + 780 allocation rows
- Stage 7: 945 misconception candidates = 3 مورد پایه برای هر subtopic + 33 exception-specific
- Stage 7 distractor rules: 12 global + 15 type-specific
- Bank allocation totals: Full=10,636 / Expanded=5,331 / MVP=2,666

## چرا نام فایل‌ها `recovered_v1.0` است؟
نسخه‌های تاریخی Stage 6/7 در File Library پیدا شدند و schema، counts، controlled IDs، مثال‌ها و قراردادهای آنها به‌عنوان مرجع استفاده شد؛ اما runtime فعلی امکان export خام/byte-for-byte آن فایل‌های Library را ندارد. بنابراین این بسته **بازسازی عملیاتی و contract-compatible** است و نباید به‌عنوان کپی بایت‌به‌بایت export قبلی معرفی شود.

شناسه‌های ثابت Question Type همان UUIDهای تاریخی هستند. برای Misconceptionهایی که ID تاریخی مستقیماً از artifactهای قبلی قابل بازیابی بود همان ID حفظ شده است (از جمله `L32-S04 / Relatif « dont » / NEAR_FORM_CONFUSION = dac62b22-7d9b-540f-b765-e4ad0c1fd476` که Stage 16 به آن ارجاع می‌دهد). سایر IDها با UUID5 deterministic مخصوص recovery ساخته شده‌اند و provenance آنها در `stage7_recovery_id_provenance_v1.0.csv` ثبت شده است.

## مسیر پیشنهادی در repository
فایل‌ها را بدون جایگزین کردن policyهای موجود، در همین مسیرها اضافه کنید:

- `data/question_authoring/stage6/`
  - `stage6_question_type_catalogue_reference_v1.0.csv`
  - `stage6_subtopic_type_compatibility_recovered_v1.0.csv`
  - `stage6_lesson_type_compatibility_recovered_v1.0.csv`
  - `stage6_question_type_targets_recovered_v1.0.csv`
- `data/question_authoring/stage7/`
  - `stage7_misconception_catalogue_recovered_v1.0.csv`
  - `stage7_recovery_id_provenance_v1.0.csv`
  - `stage7_distractor_rules_recovered_v1.0.csv`

فایل‌های موجود `config/stage6_question_type_policy.json` و `config/stage7_distractor_policy.json` را حذف یا overwrite نکنید؛ این CSVها جزئیات داده‌ای مکمل همان policyها هستند.

## منطق Stage 6
- Cognitive mix: Recall 20% / Application 40% / Discrimination 40%.
- Base shares و compatibility factors تاریخی حفظ شده‌اند: PREFERRED=1.0، ALLOWED=0.55، CONDITIONAL=0.25، NOT_SUITABLE=0.
- compatibility در سطح atomic subtopic از متن Stage1 + taxonomy Stage2 تعیین شده و rationale هر ردیف ثبت شده است.
- lesson compatibility از بهترین سطح واقعاً پشتیبانی‌شده میان subtopicهای همان lesson ساخته شده و count همه وضعیت‌ها نگهداری می‌شود.
- allocation در هر cognitive band با base share × compatibility factor و largest-remainder انجام می‌شود؛ NOT_SUITABLE همیشه صفر و CONDITIONAL نیازمند guardrail است.

## منطق Stage 7
- سه family پایه برای همه subtopicها: OVERGENERALIZATION، NEAR_FORM_CONFUSION، CONTEXT_ROLE_MISMATCH.
- برای 33 subtopic دارای `notes_exceptions_register` یک EXCEPTION_NEGLECT اضافه شده است.
- هیچ ادعای آماری درباره «رایج بودن» misconception قبل از داده واقعی وجود ندارد؛ calibration در Stage 27 انجام می‌شود.
- distractor باید plausible ولی قطعاً غلط، متوازن، فاقد ambiguity و در صورت امکان متصل به misconception_id باشد.

## کنترل‌های مهم قبل از تولید انبوه سؤال
1. `NOT_SUITABLE` را هرگز تولید نکنید.
2. `CONDITIONAL` فقط پس از عبور guardrail همان row مجاز است.
3. سؤال باید دقیقاً یک پاسخ صحیح داشته باشد.
4. گزینه غلط به misconception_id معتبر متصل شود؛ correct option misconception ندارد.
5. difficulty را از Stage 8/9 بگیرید؛ Stage 6/7 آن را تعیین نمی‌کنند.
6. سؤال نهایی باید با schema 46 ستونی Stage 10/23 و workflow مستقل Stage 11 سازگار باشد.

## Validation
جزئیات کامل در `validation/recovery_validation_v1.0.json` است.

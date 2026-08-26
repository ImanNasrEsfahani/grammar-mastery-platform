"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {DashboardEnvelope, ReviewCollectionEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import styles from "./WeaknessDetailClient.module.css";

type QueryParams = Record<string, string | string[] | undefined>;
type ReviewSummary = ReviewCollectionEnvelope["data"][number];
type MasteryRow = DashboardEnvelope["data"]["mastery"][number];

type TimelineItem = {
  when: string;
  source: string;
  detail: string;
  tone: "danger" | "warning";
};

type RelatedQuestion = {id: string; label: string};

type DetailModel = {
  title: string;
  severity: "high" | "medium" | "low";
  repeatCount: number | null;
  lastOccurrence: string | null;
  lessonNo: string | null;
  lessonId: string | null;
  lessonTitle: string | null;
  category: string | null;
  pattern: string;
  mastery: number | null;
  confidence: number | null;
  coverage: number | null;
  why: string | null;
  rule: string | null;
  correctExample: string | null;
  incorrectExample: string | null;
  timeline: TimelineItem[];
  relatedQuestions: RelatedQuestion[];
  reviewId: string | null;
  scopeId: string | null;
  educationalContentAvailable: boolean;
};

const DEMO_TIMELINE_FA: TimelineItem[] = [
  {when: "امروز", source: "Practice • Q17", detail: "dont به‌جای que", tone: "danger"},
  {when: "۳ روز پیش", source: "Review • Q06", detail: "حذف de در ساخت نسبی", tone: "warning"},
  {when: "۷ روز پیش", source: "Practice • Q12", detail: "que ↔ dont", tone: "danger"},
];

const DEMO_TIMELINE_EN: TimelineItem[] = [
  {when: "Today", source: "Practice • Q17", detail: "dont instead of que", tone: "danger"},
  {when: "3 days ago", source: "Review • Q06", detail: "Dropped de in a relative structure", tone: "warning"},
  {when: "7 days ago", source: "Practice • Q12", detail: "que ↔ dont", tone: "danger"},
];

const DEMO_QUESTIONS: RelatedQuestion[] = [
  {id: "Q-032145", label: "Relatif dont"},
  {id: "Q-032188", label: "que / dont"},
];

function numberParam(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeConfidence(value: number | null): number | null {
  if (value === null) return null;
  return clampPercent(value <= 1 ? value * 100 : value);
}

function normalizeCoverage(value: number | null): number | null {
  if (value === null) return null;
  return clampPercent(value <= 1 ? value * 100 : value);
}

function compact(value: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function safeDecode(value: string) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function normalizeKey(value: string) {
  return safeDecode(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleLooksQueDont(value: string) {
  const lower = value.toLocaleLowerCase();
  return lower.includes("que") && lower.includes("dont");
}

function findReview(items: ReviewSummary[], weaknessKey: string, requestedReviewId: string | null, requestedTitle: string | null) {
  if (requestedReviewId) {
    const direct = items.find((item) => item.id === requestedReviewId);
    if (direct) return direct;
  }

  const decodedKey = safeDecode(weaknessKey);
  const byIdentity = items.find((item) => item.id === decodedKey || item.group_key === decodedKey);
  if (byIdentity) return byIdentity;

  const needle = normalizeKey(requestedTitle ?? decodedKey);
  if (!needle) return null;
  return items.find((item) => normalizeKey(item.title).includes(needle) || needle.includes(normalizeKey(item.title))) ?? null;
}

function findMastery(rows: MasteryRow[], scopeId: string | null, title: string | null) {
  if (scopeId) {
    const exact = rows.find((row) => row.scope_id === scopeId);
    if (exact) return exact;
  }
  if (title) {
    const needle = normalizeKey(title);
    const exactTitle = rows.find((row) => normalizeKey(row.scope_title || "") === needle);
    if (exactTitle) return exactTitle;
  }
  return null;
}

function formatOccurrence(dateValue: string | null, locale: Locale) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleDateString(locale === "fa" ? "fa-IR" : "en-CA", {year: "numeric", month: "short", day: "numeric"});
}

function demoModel(isFa: boolean): DetailModel {
  return {
    title: "que ↔ dont",
    severity: "high",
    repeatCount: 3,
    lastOccurrence: isFa ? "امروز" : "Today",
    lessonNo: "32",
    lessonId: null,
    lessonTitle: "Les pronoms relatifs",
    category: "Pronoms et référence",
    pattern: isFa
      ? "الگوی خطا: استفاده از que در ساخت‌هایی که رابطه با de دارند."
      : "Error pattern: using que where the structure requires a relation with de.",
    mastery: 42,
    confidence: 52,
    coverage: 71,
    why: isFa
      ? "وقتی فعل، اسم یا صفت با «de» به مرجع خود متصل می‌شود، ضمیر نسبی «dont» جایگزین «de + antécédent» می‌شود. استفاده از «que» در این موقعیت رابطهٔ دستوری را ناقص می‌کند."
      : "When a verb, noun, or adjective connects to its reference with de, the relative pronoun dont replaces de + antécédent. Using que here leaves the grammatical relation incomplete.",
    rule: "dont = de + nom / de + personne / de + chose",
    correctExample: "Le livre dont je parle est utile.",
    incorrectExample: "Le livre que je parle est utile.",
    timeline: isFa ? DEMO_TIMELINE_FA : DEMO_TIMELINE_EN,
    relatedQuestions: DEMO_QUESTIONS,
    reviewId: null,
    scopeId: null,
    educationalContentAvailable: true,
  };
}

export function WeaknessDetailClient({locale, weaknessKey, query}: {locale: Locale; weaknessKey: string; query: QueryParams}) {
  const isFa = locale === "fa";
  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
      else if (value !== undefined) params.set(key, value);
    }
    return params;
  }, [query]);
  const demo = searchParams.get("demo") === "1";
  const [reviews, setReviews] = useState<ReviewCollectionEnvelope | null>(null);
  const [dashboard, setDashboard] = useState<DashboardEnvelope | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!demo);

  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    setError(null);
    const [reviewResult, dashboardResult] = await Promise.allSettled([
      apiRequest<ReviewCollectionEnvelope>("/api/backend/reviews?page[size]=100&filter[kind]=MISTAKE"),
      apiRequest<DashboardEnvelope>("/api/backend/dashboard"),
    ]);

    if (reviewResult.status === "fulfilled") setReviews(reviewResult.value);
    if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value);

    if (reviewResult.status === "rejected" && dashboardResult.status === "rejected") {
      const caught = reviewResult.reason;
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Weakness detail failed to load."}));
    }
    setLoading(false);
  }, [demo]);

  useEffect(() => { void load(); }, [load]);

  const model = useMemo<DetailModel>(() => {
    if (demo) return demoModel(isFa);

    const requestedTitle = compact(searchParams.get("title"));
    const requestedReviewId = compact(searchParams.get("reviewId"));
    const scopeId = compact(searchParams.get("scopeId"));
    const review = findReview(reviews?.data ?? [], weaknessKey, requestedReviewId, requestedTitle);
    const mastery = findMastery(dashboard?.data.mastery ?? [], scopeId, requestedTitle ?? review?.title ?? null);
    const title = requestedTitle ?? review?.title ?? safeDecode(weaknessKey).replaceAll("-", " ");
    const repeatCount = numberParam(searchParams.get("repeatCount")) ?? review?.repeat_count ?? null;
    const lessonNo = compact(searchParams.get("lessonNo"));
    const lessonId = compact(searchParams.get("lessonId"));
    const lessonTitle = compact(searchParams.get("lessonTitle"));
    const category = compact(searchParams.get("category"));
    const lastWrongAt = compact(searchParams.get("lastWrongAt"));
    const knownQueDont = titleLooksQueDont(title);

    const masteryPct = clampPercent(numberParam(searchParams.get("mastery")) ?? mastery?.mastery_score_pct ?? null);
    const confidencePct = normalizeConfidence(numberParam(searchParams.get("confidence")) ?? mastery?.confidence ?? null);
    const coveragePct = normalizeCoverage(numberParam(searchParams.get("coverage")) ?? mastery?.coverage_ratio ?? null);

    const educationalContentAvailable = searchParams.get("revealed") === "1" || searchParams.get("source") === "attempt-result";

    return {
      title,
      severity: repeatCount !== null && repeatCount >= 3 ? "high" : repeatCount !== null && repeatCount >= 2 ? "medium" : "low",
      repeatCount,
      lastOccurrence: formatOccurrence(lastWrongAt, locale),
      lessonNo,
      lessonId,
      lessonTitle,
      category,
      pattern: compact(searchParams.get("pattern")) ?? (isFa
        ? "این الگو از پاسخ‌های تکراری شما شناسایی شده است. جزئیات آموزشی فقط از شواهدی نمایش داده می‌شود که API یا صفحهٔ نتیجه در اختیار قرار داده باشد."
        : "This pattern was detected from repeated responses. Educational detail is shown only when supplied by the API or a completed result."),
      mastery: masteryPct,
      confidence: confidencePct,
      coverage: coveragePct,
      why: educationalContentAvailable && knownQueDont
        ? (isFa
          ? "وقتی فعل، اسم یا صفت با «de» به مرجع خود متصل می‌شود، «dont» جایگزین «de + antécédent» می‌شود. استفاده از «que» در این موقعیت رابطهٔ دستوری را ناقص می‌کند."
          : "When a verb, noun, or adjective connects to its reference with de, dont replaces de + antécédent. Using que here leaves the grammatical relation incomplete.")
        : compact(searchParams.get("why")),
      rule: educationalContentAvailable && knownQueDont ? "dont = de + nom / de + personne / de + chose" : compact(searchParams.get("rule")),
      correctExample: educationalContentAvailable && knownQueDont ? "Le livre dont je parle est utile." : compact(searchParams.get("correct")),
      incorrectExample: educationalContentAvailable && knownQueDont ? "Le livre que je parle est utile." : compact(searchParams.get("incorrect")),
      timeline: [],
      relatedQuestions: [],
      reviewId: review?.id ?? requestedReviewId,
      scopeId: mastery?.scope_id ?? scopeId,
      educationalContentAvailable,
    };
  }, [dashboard, demo, isFa, locale, reviews, searchParams, weaknessKey]);

  const otherLocale = locale === "fa" ? "en" : "fa";
  const preservedQuery = searchParams.toString();
  const localeHref = `/${otherLocale}/weakness/${encodeURIComponent(weaknessKey)}${preservedQuery ? `?${preservedQuery}` : ""}`;
  const practiceHref = `/${locale}/tests/new?mode=adaptive&focus=${encodeURIComponent(model.scopeId ?? weaknessKey)}`;
  const reviewHref = model.reviewId ? `/${locale}/review/${model.reviewId}` : `/${locale}/review`;
  const lessonHref = model.lessonId ? `/${locale}/lessons/${model.lessonId}` : `/${locale}/lessons`;

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <PageHeader locale={locale} localeHref={localeHref} />

        <main className={styles.content} aria-labelledby="weakness-title">
          <div className={styles.pageTitle}>
            <h1 id="weakness-title">{isFa ? "جزئیات نقطه ضعف" : "Weakness detail"}</h1>
            <p>{isFa ? "تحلیل الگوی خطای تکراری و مسیر پیشنهادی برای اصلاح آن" : "Analyze a repeated error pattern and choose the next corrective action."}</p>
          </div>

          {error ? (
            <div className={styles.notice} role="status">
              <strong>{isFa ? "دادهٔ زنده در دسترس نیست." : "Live data is unavailable."}</strong>
              <span>{isFa ? "صفحه بدون ساختن دادهٔ آموزشیِ جعلی نمایش داده می‌شود." : "The page remains usable without fabricating educational evidence."}</span>
              <button type="button" onClick={() => void load()}>{isFa ? "تلاش دوباره" : "Retry"}</button>
            </div>
          ) : null}

          <section className={styles.topGrid} aria-label={isFa ? "خلاصه نقطه ضعف" : "Weakness summary"}>
            <article className={styles.summaryCard}>
              <div className={styles.summaryIdentity}>
                <SeverityBadge severity={model.severity} isFa={isFa} />
                <div>
                  <h2 dir="ltr">{model.title}</h2>
                  <p className={styles.meta}>
                    {[model.lessonTitle, model.lessonNo ? (isFa ? `درس ${model.lessonNo}` : `Lesson ${model.lessonNo}`) : null, model.category].filter(Boolean).join(" • ") || (isFa ? "الگوی خطای شناسایی‌شده" : "Detected misconception pattern")}
                  </p>
                  <p className={styles.pattern}>{model.pattern}</p>
                </div>
              </div>
              <div className={styles.stats}>
                <MiniStat label={isFa ? "تکرار" : "Repeats"} value={model.repeatCount === null ? "—" : isFa ? `${model.repeatCount} بار` : `${model.repeatCount}×`} tone="danger" />
                <MiniStat label={isFa ? "آخرین رخداد" : "Last seen"} value={model.lastOccurrence ?? "—"} tone="warning" />
                <MiniStat label="Mastery" value={model.mastery === null ? "—" : `${model.mastery}%`} tone="danger" />
                <MiniStat label="Confidence" value={model.confidence === null ? "—" : `${model.confidence}%`} tone="warning" />
              </div>
            </article>

            <aside className={styles.actionCard}>
              <h2>{isFa ? "اقدام پیشنهادی" : "Recommended action"}</h2>
              <p>{isFa ? "یک تمرین هدفمند ۱۰ سوالی روی همین الگوی ضعف انجام بده." : "Run a focused 10-question practice on this weakness pattern."}</p>
              <Link className={styles.primaryButton} href={practiceHref}>{isFa ? "شروع تمرین هدفمند" : "Start targeted practice"}</Link>
            </aside>
          </section>

          <div className={styles.detailGrid}>
            <section className={styles.educationCard} aria-labelledby="why-title">
              <h2 id="why-title">{isFa ? "چرا این اشتباه رخ می‌دهد؟" : "Why does this mistake happen?"}</h2>

              {model.why ? (
                <p className={styles.explanation}>{model.why}</p>
              ) : (
                <LockedEducation isFa={isFa} reviewHref={reviewHref} />
              )}

              {model.rule ? (
                <div className={styles.ruleBox}>
                  <span>{isFa ? "قاعده صحیح" : "Correct rule"}</span>
                  <strong dir="ltr">{model.rule}</strong>
                </div>
              ) : null}

              <h3>{isFa ? "مقایسه" : "Comparison"}</h3>
              {model.correctExample && model.incorrectExample ? (
                <div className={styles.comparisonGrid}>
                  <ExampleCard tone="correct" label={isFa ? "درست ✓" : "Correct ✓"} text={model.correctExample} />
                  <ExampleCard tone="incorrect" label={isFa ? "خطا ×" : "Incorrect ×"} text={model.incorrectExample} />
                </div>
              ) : (
                <div className={styles.missingData}>{isFa ? "نمونهٔ صحیح/غلط هنوز از منبع آموزشی یا نتیجهٔ آشکارشده دریافت نشده است." : "Correct/incorrect examples are not available from a revealed learning source yet."}</div>
              )}

              <div className={styles.educationActions}>
                <Link href={lessonHref}>{isFa ? "باز کردن درس" : "Open lesson"}</Link>
                <Link href={reviewHref}>{isFa ? "مرور سؤال‌ها" : "Review questions"}</Link>
                <Link className={styles.primaryButton} href={practiceHref}>{isFa ? "تمرین دوباره" : "Practice again"}</Link>
              </div>
            </section>

            <aside className={styles.impactCard} aria-labelledby="impact-title">
              <h2 id="impact-title">{isFa ? "تأثیر بر تسلط" : "Mastery impact"}</h2>
              <MetricBar label="Mastery" value={model.mastery} tone="danger" />
              <MetricBar label="Confidence" value={model.confidence} tone="warning" />
              <MetricBar label="Coverage" value={model.coverage} tone="primary" />

              <div className={styles.divider} />
              <h3>{isFa ? "Timeline خطاها" : "Error timeline"}</h3>
              {model.timeline.length ? (
                <ol className={styles.timeline}>
                  {model.timeline.map((item, index) => (
                    <li key={`${item.source}-${index}`} className={item.tone === "warning" ? styles.timelineWarning : styles.timelineDanger}>
                      <span className={styles.timelineDot} />
                      <div className={styles.timelineTop}><strong>{item.when}</strong><small dir="ltr">{item.source}</small></div>
                      <p>{item.detail}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={styles.missingData}>{isFa ? "API فعلی timeline رخدادهای misconception را ارائه نمی‌کند." : "The current API does not expose misconception occurrence history."}</div>
              )}

              <div className={styles.divider} />
              <h3>{isFa ? "سؤال‌های مرتبط" : "Related questions"}</h3>
              {model.relatedQuestions.length ? (
                <div className={styles.relatedList}>
                  {model.relatedQuestions.map((question) => (
                    <div key={question.id}><code>{question.id}</code><strong dir="ltr">{question.label}</strong></div>
                  ))}
                </div>
              ) : (
                <div className={styles.missingData}>{isFa ? "شناسهٔ سؤال‌های مرتبط در قرارداد فعلی این صفحه موجود نیست." : "Related question IDs are not exposed by the current contract."}</div>
              )}
            </aside>
          </div>

          {loading ? <div className={styles.loadingLine} role="status">{isFa ? "در حال همگام‌سازی داده‌های واقعی…" : "Syncing persisted learning evidence…"}</div> : null}
        </main>
      </div>
    </div>
  );
}

function PageHeader({locale, localeHref}: {locale: Locale; localeHref: string}) {
  const isFa = locale === "fa";
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href={`/${locale}/dashboard`} aria-label="Grammar Mastery">
        <span className={styles.brandIcon} aria-hidden="true"><BookMark /></span>
        <span><strong>GRAMMAR</strong><small>MASTERY</small></span>
      </Link>
      <nav aria-label={isFa ? "ناوبری اصلی" : "Primary navigation"}>
        <Link href={`/${locale}/dashboard`}>{isFa ? "داشبورد" : "Dashboard"}</Link>
        <Link href={`/${locale}/tests/new`}>{isFa ? "تمرین" : "Practice"}</Link>
        <Link href={`/${locale}/review`}>{isFa ? "بازبینی" : "Review"}</Link>
        <Link href={`/${locale}/lessons`}>{isFa ? "درس‌ها" : "Lessons"}</Link>
        <Link href={`/${locale}/progress`}>{isFa ? "پیشرفت" : "Progress"}</Link>
      </nav>
      <Link className={styles.localeSwitch} href={localeHref} hrefLang={locale === "fa" ? "en" : "fa"}>
        {locale.toUpperCase()} <span aria-hidden="true">▾</span>
      </Link>
    </header>
  );
}

function SeverityBadge({severity, isFa}: {severity: DetailModel["severity"]; isFa: boolean}) {
  const label = severity === "high" ? (isFa ? "اولویت بالا" : "High priority") : severity === "medium" ? (isFa ? "اولویت متوسط" : "Medium priority") : (isFa ? "اولویت عادی" : "Normal priority");
  return <span className={`${styles.severity} ${severity === "high" ? styles.severityHigh : severity === "medium" ? styles.severityMedium : styles.severityLow}`}>{label}</span>;
}

function MiniStat({label, value, tone}: {label: string; value: string; tone: "danger" | "warning"}) {
  return <div className={styles.miniStat}><span>{label}</span><strong className={tone === "danger" ? styles.dangerText : styles.warningText}>{value}</strong></div>;
}

function MetricBar({label, value, tone}: {label: string; value: number | null; tone: "danger" | "warning" | "primary"}) {
  const pct = value ?? 0;
  return (
    <div className={styles.metricRow}>
      <strong>{label}</strong>
      <div className={styles.metricTrack}><span className={tone === "danger" ? styles.metricDanger : tone === "warning" ? styles.metricWarning : styles.metricPrimary} style={{inlineSize: `${pct}%`}} /></div>
      <b className={tone === "danger" ? styles.dangerText : tone === "warning" ? styles.warningText : styles.primaryText}>{value === null ? "—" : `${value}%`}</b>
    </div>
  );
}

function ExampleCard({tone, label, text}: {tone: "correct" | "incorrect"; label: string; text: string}) {
  return <div className={`${styles.exampleCard} ${tone === "correct" ? styles.correctCard : styles.incorrectCard}`}><span>{label}</span><strong dir="ltr">{text}</strong></div>;
}

function LockedEducation({isFa, reviewHref}: {isFa: boolean; reviewHref: string}) {
  return (
    <div className={styles.locked}>
      <div><strong>{isFa ? "توضیح آموزشی هنوز آشکار نشده است" : "Educational feedback is still hidden"}</strong><p>{isFa ? "برای حفظ retrieval practice، این صفحه پاسخ صحیح را خودکار reveal نمی‌کند. ابتدا مرور را انجام بده یا از نتیجهٔ تکمیل‌شده وارد شو." : "To preserve retrieval practice, this page never reveals the answer automatically. Retry the review first or enter from a completed result."}</p></div>
      <Link href={reviewHref}>{isFa ? "رفتن به مرور" : "Open review"}</Link>
    </div>
  );
}

function BookMark() {
  return <svg viewBox="0 0 28 28" fill="none"><path d="M4 4.5h8.2c1.2 0 2.2.5 2.8 1.3.6-.8 1.6-1.3 2.8-1.3H24v17.2h-5.8c-1.6 0-2.6.5-3.2 1.4-.6-.9-1.6-1.4-3.2-1.4H4V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M15 5.8v17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

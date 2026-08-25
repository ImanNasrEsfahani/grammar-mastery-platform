"use client";

import Link from "next/link";
import type {CSSProperties} from "react";
import {useCallback, useEffect, useState} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {paths} from "@/lib/api/generated";
import type {Locale} from "@/lib/i18n";
import {
  getGrammarBook,
  grammarLessonUrl,
  type GrammarBookSlug,
} from "@/lib/grammar-content/books";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./LessonContentClient.module.css";

type LessonDetailEnvelope =
  paths["/lessons/{lessonId}"]["get"]["responses"][200]["content"]["application/json"];
type BaseLessonDetail = LessonDetailEnvelope["data"];
type MasteryBand = "NO_EVIDENCE" | "UNCERTAIN" | "WEAK" | "DEVELOPING" | "STRONG";

type LessonMasterySnapshot = {
  mastery_score_pct: number;
  confidence: number;
  coverage_ratio: number;
  evidence_count: number;
  mastery_band: MasteryBand;
  model_version: string;
  source: "PERSISTED_LESSON" | "AGGREGATED_SUBTOPICS" | "PERSISTED_SUBTOPIC" | "NO_EVIDENCE";
};

type LessonLearningSubtopic = {
  id: string;
  question_count: number;
  mistake_count: number;
  mastery: LessonMasterySnapshot;
};

type LessonMisconceptionInsight = {
  id: string;
  family: string;
  name_fa?: string | null;
  statement_fa: string;
  diagnostic_interpretation_fa?: string | null;
  subtopic_id: string;
  subtopic_title_fr: string;
  subtopic_title_fa?: string | null;
  repeat_count: number;
  last_wrong_at?: string | null;
};

type LessonRecentActivity = {
  attempt_id: string;
  test_id: string;
  mode: string;
  question_count: number;
  answered_count: number;
  correct_count: number;
  accuracy_pct?: number | null;
  duration_seconds?: number | null;
  completed_at: string;
};

type LessonDetail = BaseLessonDetail & {
  book_reference: {
    book_pages?: string | null;
    pdf_pages?: string | null;
  };
  learning: {
    overview: LessonMasterySnapshot;
    subtopics: LessonLearningSubtopic[];
    unresolved_mistake_count: number;
    review_item_id?: string | null;
    misconceptions: LessonMisconceptionInsight[];
    recent_activity: LessonRecentActivity[];
  };
};

type ViewState =
  | {kind: "loading"}
  | {kind: "ready"; lesson: LessonDetail; contentUrl: string}
  | {kind: "missing"; lesson: LessonDetail; contentUrl: string}
  | {
      kind: "error";
      message: string;
      code: string;
      requestId?: string;
    };

type MetricProps = {
  label: string;
  value: number | null;
  kind: "mastery" | "confidence" | "coverage";
};

const BAND_COPY: Record<MasteryBand, {icon: string; fa: string; en: string}> = {
  STRONG: {icon: "✓", fa: "قوی", en: "Strong"},
  DEVELOPING: {icon: "↗", fa: "در حال رشد", en: "Developing"},
  WEAK: {icon: "!", fa: "ضعیف", en: "Weak"},
  UNCERTAIN: {icon: "?", fa: "شواهد ناکافی", en: "Uncertain"},
  NO_EVIDENCE: {icon: "·", fa: "بدون شواهد", en: "No evidence"},
};

async function probeStaticHtml(url: string): Promise<Response> {
  const headResponse = await fetch(url, {method: "HEAD", cache: "no-store"});
  if (headResponse.status !== 405) return headResponse;
  return fetch(url, {method: "GET", cache: "no-store"});
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function MetricRing({label, value, kind}: MetricProps) {
  const safeValue = value == null ? 0 : clampPercent(value);
  const style = {"--metric-value": safeValue} as CSSProperties;
  return (
    <div className={`${styles.metric} ${styles[`metric${kind[0]!.toUpperCase()}${kind.slice(1)}`]}`}>
      <div
        className={styles.metricRing}
        style={style}
        role="img"
        aria-label={`${label}: ${value == null ? "—" : `${Math.round(safeValue)}%`}`}
      >
        <span>{value == null ? "—" : `${Math.round(safeValue)}%`}</span>
      </div>
      <small>{label}</small>
    </div>
  );
}

function formatDuration(seconds: number | null | undefined, isFa: boolean): string {
  if (seconds == null) return "—";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return isFa ? `${minutes} دقیقه` : `${minutes} min`;
}

function formatActivityDate(value: string, locale: Locale, isFa: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  if (sameDay) return isFa ? "امروز" : "Today";
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-CA", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function localizedCategory(
  lesson: LessonDetail,
  isFa: boolean,
): {category: string; subcategory: string} {
  return {
    category: (isFa ? lesson.category_title_fa : lesson.category_title_fr)
      || lesson.category_title_fr
      || "—",
    subcategory: (isFa ? lesson.subcategory_title_fa : lesson.subcategory_title_fr)
      || lesson.subcategory_title_fr
      || "—",
  };
}

export function LessonContentClient({
  locale,
  lessonId,
  bookSlug,
}: {
  locale: Locale;
  lessonId: string;
  bookSlug: GrammarBookSlug;
}) {
  const isFa = locale === "fa";
  const book = getGrammarBook(bookSlug);
  const [state, setState] = useState<ViewState>({kind: "loading"});

  const load = useCallback(async () => {
    setState({kind: "loading"});
    try {
      const envelope = await apiRequest<LessonDetailEnvelope>(
        `/api/backend/lessons/${lessonId}`,
      );
      if (!envelope) {
        throw new ApiError({
          status: 502,
          code: "EMPTY_LESSON_RESPONSE",
          message: "The lesson service returned an empty response.",
        });
      }

      const lesson = envelope.data as LessonDetail;
      if (!lesson.learning || !lesson.book_reference) {
        throw new ApiError({
          status: 502,
          code: "LESSON_INSIGHTS_UNAVAILABLE",
          message: isFa
            ? "خلاصهٔ یادگیری این درس در پاسخ سرور موجود نیست."
            : "The lesson learning summary is missing from the server response.",
        });
      }
      const contentUrl = grammarLessonUrl(bookSlug, lesson.lesson_no);
      const contentResponse = await probeStaticHtml(contentUrl);

      if (contentResponse.status === 404) {
        setState({kind: "missing", lesson, contentUrl});
        return;
      }
      if (!contentResponse.ok) {
        throw new ApiError({
          status: contentResponse.status,
          code: "LESSON_CONTENT_UNAVAILABLE",
          message: `Lesson HTML returned HTTP ${contentResponse.status}.`,
        });
      }

      setState({kind: "ready", lesson, contentUrl});
    } catch (caught) {
      if (caught instanceof ApiError) {
        setState({
          kind: "error",
          message: caught.message,
          code: caught.code,
          requestId: caught.requestId,
        });
        return;
      }
      setState({
        kind: "error",
        message: isFa
          ? "نگاشت یا بارگذاری محتوای این درس ناموفق بود."
          : "The lesson content mapping or load failed.",
        code: "LESSON_CONTENT_MAPPING_ERROR",
      });
    }
  }, [bookSlug, isFa, lessonId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return <LoadingCard label={isFa ? "بارگذاری جزئیات درس" : "Loading lesson details"} />;
  }

  if (state.kind === "error") {
    return (
      <StatusPanel
        title={state.message}
        tone="danger"
        requestId={state.requestId}
        action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
      >
        <p>{state.code}</p>
      </StatusPanel>
    );
  }

  const {lesson, contentUrl} = state;
  const {learning} = lesson;
  const categories = localizedCategory(lesson, isFa);
  const latestActivity = learning.recent_activity[0] ?? null;
  const topMisconception = learning.misconceptions[0] ?? null;
  const learningBySubtopic = new Map(learning.subtopics.map((item) => [item.id, item]));
  const subtopicRows = lesson.subtopics.map((subtopic, index) => ({
    index: index + 1,
    content: subtopic,
    learning: learningBySubtopic.get(subtopic.id) ?? null,
  }));

  const focusSubtopic = [...subtopicRows]
    .filter((item) => item.learning?.mastery.mastery_band === "WEAK"
      || item.learning?.mastery.mastery_band === "DEVELOPING")
    .sort((a, b) =>
      (a.learning?.mastery.mastery_score_pct ?? 100)
      - (b.learning?.mastery.mastery_score_pct ?? 100),
    )[0] ?? null;

  const overviewHasEvidence = learning.overview.evidence_count > 0;
  const masteryValue = overviewHasEvidence ? learning.overview.mastery_score_pct : null;
  const confidenceValue = learning.overview.confidence * 100;
  const coverageValue = learning.overview.coverage_ratio * 100;
  const practiceHref = `/${locale}/tests/new?lesson=${lesson.id}`;
  const reviewHref = learning.review_item_id
    ? `/${locale}/review/${learning.review_item_id}`
    : `/${locale}/review`;
  const bookPages = lesson.book_reference.book_pages || lesson.book_reference.pdf_pages;
  const fileName = contentUrl.split("/").at(-1) ?? "lesson.html";

  return (
    <section className={styles.shell}>
      <nav className={styles.breadcrumb} aria-label={isFa ? "مسیر صفحه" : "Breadcrumb"}>
        <Link href={`/${locale}/lessons`}>{isFa ? "درس‌ها" : "Lessons"}</Link>
        <span aria-hidden="true">/</span>
        <span>{isFa ? `درس ${lesson.lesson_no}` : `Lesson ${lesson.lesson_no}`}</span>
      </nav>

      <header className={styles.hero}>
        <div className={styles.identity}>
          <span className={styles.bookIcon} aria-hidden="true">▯</span>
          <div>
            <p className={styles.lessonNumber}>
              {isFa ? `درس ${lesson.lesson_no}` : `Lesson ${lesson.lesson_no}`}
            </p>
            <h1 lang="fr" dir="ltr">{lesson.title_fr}</h1>
            {lesson.short_title && lesson.short_title !== lesson.title_fr ? (
              <p className={styles.shortTitle}>{lesson.short_title}</p>
            ) : null}
            <p className={styles.taxonomy}>
              <span>{categories.category}</span>
              <span aria-hidden="true">→</span>
              <span>{categories.subcategory}</span>
            </p>
            <p className={styles.bookReference}>
              {isFa ? "مرجع کتاب" : "Book reference"}: {isFa ? book.titleFa : book.titleFr}
              {bookPages ? ` · ${isFa ? "صفحات" : "pages"} ${bookPages}` : ""}
            </p>
          </div>
        </div>

        <div className={styles.metrics} aria-label={isFa ? "شاخص‌های یادگیری درس" : "Lesson learning metrics"}>
          <MetricRing label={isFa ? "تسلط" : "Mastery"} value={masteryValue} kind="mastery" />
          <MetricRing label={isFa ? "اعتماد به سنجش" : "Confidence"} value={confidenceValue} kind="confidence" />
          <MetricRing label={isFa ? "پوشش" : "Coverage"} value={coverageValue} kind="coverage" />
        </div>

        <div className={styles.heroActions}>
          <Link className={`${styles.action} ${styles.primaryAction}`} href={practiceHref}>
            {isFa ? "شروع تمرین درس" : "Practice this lesson"}
          </Link>
          <Link className={`${styles.action} ${styles.secondaryAction}`} href={reviewHref}>
            {isFa ? "مرور اشتباهات" : "Review mistakes"}
            {learning.unresolved_mistake_count > 0 ? (
              <strong>{learning.unresolved_mistake_count}</strong>
            ) : null}
          </Link>
          <p className={styles.lastPractice}>
            {latestActivity ? (
              <>
                {isFa ? "آخرین تمرین" : "Last practice"}: {formatActivityDate(latestActivity.completed_at, locale, isFa)}
                {` · ${latestActivity.question_count} ${isFa ? "سؤال" : "questions"}`}
              </>
            ) : (
              isFa ? "هنوز تمرینی برای این درس ثبت نشده است." : "No practice has been recorded for this lesson yet."
            )}
          </p>
        </div>
      </header>

      <div className={styles.analyticsGrid}>
        <section className={styles.subtopicsPanel} aria-labelledby="lesson-subtopics-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="lesson-subtopics-title">{isFa ? "زیرموضوع‌های درس" : "Lesson subtopics"}</h2>
              <p>{isFa ? "عملکرد هر مفهوم به‌صورت مستقل سنجیده می‌شود." : "Each concept is measured independently."}</p>
            </div>
            <span className={styles.questionTotal}>
              {lesson.question_count} {isFa ? "سؤال منتشرشده" : "published questions"}
            </span>
          </div>

          <div className={styles.tableHeader} aria-hidden="true">
            <span>{isFa ? "زیرموضوع" : "Subtopic"}</span>
            <span>{isFa ? "سؤال" : "Questions"}</span>
            <span>{isFa ? "خطای باز" : "Open mistakes"}</span>
            <span>{isFa ? "تسلط" : "Mastery"}</span>
          </div>

          <ol className={styles.subtopicList}>
            {subtopicRows.map(({index, content, learning: subtopicLearning}) => {
              const mastery = subtopicLearning?.mastery;
              const band = mastery?.mastery_band ?? "NO_EVIDENCE";
              const bandCopy = BAND_COPY[band];
              const hasEvidence = Boolean(mastery && mastery.evidence_count > 0);
              const score = hasEvidence ? mastery!.mastery_score_pct : 0;
              return (
                <li className={styles.subtopicRow} key={content.id}>
                  <span className={styles.rowNumber}>{index}</span>
                  <div className={styles.subtopicCopy}>
                    <strong lang="fr" dir="ltr">{content.title_fr}</strong>
                    <small>{isFa ? (content.title_fa || content.short_definition_fa || "توضیح فارسی ثبت نشده است.") : content.code}</small>
                  </div>
                  <span className={styles.stat}>{subtopicLearning?.question_count ?? 0}</span>
                  <span className={`${styles.stat} ${styles.mistakeStat}`}>{subtopicLearning?.mistake_count ?? 0}</span>
                  <div className={`${styles.masteryCell} ${styles[`band${band}`]}`}>
                    <div className={styles.masteryLabel}>
                      <span>{hasEvidence ? `${Math.round(score)}%` : "—"}</span>
                      <small><b aria-hidden="true">{bandCopy.icon}</b> {isFa ? bandCopy.fa : bandCopy.en}</small>
                    </div>
                    <progress
                      max={100}
                      value={hasEvidence ? clampPercent(score) : 0}
                      aria-label={`${content.title_fr}: ${hasEvidence ? `${Math.round(score)}%` : (isFa ? "بدون شواهد" : "No evidence")}`}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className={styles.insightsPanel} aria-labelledby="lesson-insights-title">
          <h2 id="lesson-insights-title">{isFa ? "نقاط مهم برای شما" : "What matters for you"}</h2>

          {topMisconception ? (
            <article className={`${styles.insightCard} ${styles.misconceptionCard}`}>
              <p className={styles.cardEyebrow}>{isFa ? "خطای احتمالی شما" : "Likely misconception"}</p>
              <h3>{isFa ? (topMisconception.name_fa || topMisconception.statement_fa) : topMisconception.family}</h3>
              <p>{isFa ? topMisconception.statement_fa : topMisconception.subtopic_title_fr}</p>
              <small>
                {isFa
                  ? `${topMisconception.repeat_count} خطای حل‌نشده در این الگو ثبت شده است.`
                  : `${topMisconception.repeat_count} unresolved mistake(s) are recorded for this pattern.`}
              </small>
              {learning.review_item_id ? (
                <Link href={reviewHref}>{isFa ? "مرور همین خطا ←" : "Review this mistake →"}</Link>
              ) : null}
            </article>
          ) : (
            <article className={styles.insightCard}>
              <p className={styles.cardEyebrow}>{isFa ? "خطاهای مفهومی" : "Misconceptions"}</p>
              <h3>{isFa ? "الگوی تکرارشونده‌ای ثبت نشده است" : "No repeated pattern is recorded"}</h3>
              <p>{isFa ? "با پاسخ‌دادن به سؤال‌های بیشتر، این بخش دقیق‌تر می‌شود." : "This area becomes more precise as you answer more questions."}</p>
            </article>
          )}

          <article className={styles.insightCard}>
            <p className={styles.cardEyebrow}>{isFa ? "فعالیت اخیر" : "Recent activity"}</p>
            {latestActivity ? (
              <>
                <h3>{formatActivityDate(latestActivity.completed_at, locale, isFa)}</h3>
                <p>
                  {latestActivity.question_count} {isFa ? "سؤال" : "questions"}
                  {latestActivity.accuracy_pct != null ? ` · ${Math.round(latestActivity.accuracy_pct)}% ${isFa ? "دقت" : "accuracy"}` : ""}
                  {` · ${formatDuration(latestActivity.duration_seconds, isFa)}`}
                </p>
                {latestActivity.accuracy_pct != null ? (
                  <progress max={100} value={clampPercent(latestActivity.accuracy_pct)} aria-label={isFa ? "دقت آخرین تمرین" : "Latest practice accuracy"} />
                ) : null}
                <Link href={`/${locale}/attempts/${latestActivity.attempt_id}/result`}>
                  {isFa ? "مشاهده نتیجه ←" : "View result →"}
                </Link>
              </>
            ) : (
              <p>{isFa ? "بعد از اولین تمرین، نتیجهٔ اخیر اینجا نمایش داده می‌شود." : "Your latest lesson result will appear here after the first practice."}</p>
            )}
          </article>

          <article className={`${styles.insightCard} ${styles.suggestionCard}`}>
            <p className={styles.cardEyebrow}>{isFa ? "پیشنهاد تمرین" : "Practice suggestion"}</p>
            {focusSubtopic ? (
              <>
                <h3 lang="fr" dir="ltr">{focusSubtopic.content.title_fr}</h3>
                <p>
                  {isFa
                    ? "این زیرموضوع پایین‌ترین تسلطِ دارای شواهد قابل استفاده را در این درس دارد. تمرین تطبیقی درس را از اینجا ادامه دهید."
                    : "This subtopic has the lowest evidence-backed mastery in this lesson. Continue with adaptive lesson practice."}
                </p>
              </>
            ) : (
              <>
                <h3>{isFa ? "ساخت شواهد یادگیری" : "Build learning evidence"}</h3>
                <p>
                  {isFa
                    ? "هنوز ضعف قابل اتکایی برای این درس برچسب‌گذاری نشده است. یک تمرین انجام دهید تا سنجش دقیق‌تر شود."
                    : "No reliable weakness label is available for this lesson yet. Complete a practice to improve the evidence."}
                </p>
              </>
            )}
          </article>

          <Link className={`${styles.action} ${styles.primaryAction} ${styles.focusAction}`} href={practiceHref}>
            {isFa ? "تمرین نقاط ضعف" : "Practice weak points"}
          </Link>
          <Link className={styles.backLink} href={`/${locale}/lessons`}>
            {isFa ? "← بازگشت به همه درس‌ها" : "← Back to all lessons"}
          </Link>
        </aside>
      </div>

      <section className={styles.contentSection} aria-labelledby="lesson-content-title">
        <div className={styles.contentHeading}>
          <div>
            <p className={styles.cardEyebrow}>{book.edition}</p>
            <h2 id="lesson-content-title">{isFa ? "محتوای آموزشی درس" : "Lesson learning content"}</h2>
            <p>{isFa ? "نسخهٔ HTML کتاب برای مطالعه و مراجعه در همان صفحه حفظ شده است." : "The book HTML remains available on the same page for study and reference."}</p>
          </div>
          <span className={styles.fileChip}>{fileName}</span>
        </div>

        {state.kind === "missing" ? (
          <StatusPanel
            title={isFa ? "فایل HTML این درس هنوز اضافه نشده است" : "This lesson HTML has not been added yet"}
          >
            <p>
              {isFa
                ? "فایل را با نام استاندارد زیر در مخزن قرار دهید و Frontend را دوباره build/deploy کنید."
                : "Add the file at the standard repository path below and rebuild/redeploy the frontend."}
            </p>
            <code className={styles.path}>{`frontend/public${contentUrl}`}</code>
          </StatusPanel>
        ) : (
          <div className={styles.frameWrap}>
            <iframe
              key={contentUrl}
              className={styles.frame}
              src={contentUrl}
              title={`${book.titleFr} — ${lesson.title_fr}`}
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
      </section>
    </section>
  );
}

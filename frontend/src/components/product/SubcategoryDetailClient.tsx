"use client";

import Link from "next/link";
import type {CSSProperties, ReactNode} from "react";
import {useCallback, useEffect, useMemo, useState} from "react";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {components} from "@/lib/api/generated";
import type {LessonCollectionEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import {DEFAULT_GRAMMAR_BOOK_SLUG} from "@/lib/grammar-content/books";
import styles from "./SubcategoryDetailClient.module.css";

type Lesson = LessonCollectionEnvelope["data"][number];
type LessonDetailEnvelope = components["schemas"]["LessonDetailEnvelope"];
type LessonDetail = components["schemas"]["LessonDetail"];
type Subtopic = components["schemas"]["Subtopic"];
type MasteryItem = components["schemas"]["MasteryItem"];
type MasteryEnvelope = components["schemas"]["MasteryCollectionEnvelope"];
type ProgressEnvelope = components["schemas"]["ProgressEnvelope"];
type ProgressPoint = components["schemas"]["ProgressPoint"];
type MasteryBand = MasteryItem["mastery_band"];

type RuntimeMastery = {
  mastery_score_pct: number;
  confidence: number;
  coverage_ratio: number;
  evidence_count: number;
  mastery_band: MasteryBand;
};

type RuntimeMisconception = {
  id: string;
  family: string;
  name_fa: string | null;
  statement_fa: string;
  subtopic_id: string;
  subtopic_title_fr: string;
  subtopic_title_fa: string | null;
  repeat_count: number;
  last_wrong_at: string | null;
};

type RuntimeMapLesson = {
  id: string;
  lesson_no: number;
  title_fr: string;
  subcategory_id: string;
  mastery: RuntimeMastery;
  top_misconception: RuntimeMisconception | null;
  unresolved_review_count: number;
};

type RuntimeMapSubcategory = {
  id: string;
  code: string;
  slug: string;
  category_id: string;
  title_fr: string;
  title_fa: string | null;
  display_order: number;
  display_title: string;
  mastery: RuntimeMastery;
  lessons: RuntimeMapLesson[];
};

type RuntimeMapCategory = {
  id: string;
  code: string;
  slug: string;
  title_fr: string;
  title_fa: string | null;
  display_title: string;
  subcategories: RuntimeMapSubcategory[];
};

type MasteryMapEnvelope = {
  data: {categories: RuntimeMapCategory[]};
  meta: {request_id: string; api_version: string; runtime_version?: string};
};

type LoadData = {
  lessons: Lesson[];
  lessonDetails: LessonDetail[];
  lessonMastery: MasteryItem[];
  subtopicMastery: MasteryItem[];
  progress: ProgressPoint[];
  mapSubcategory: RuntimeMapSubcategory | null;
  mapCategory: RuntimeMapCategory | null;
  degraded: string[];
};

type AggregateMastery = {
  score: number | null;
  confidence: number | null;
  coverage: number | null;
  evidence: number;
  band: MasteryBand;
};

type ConceptRow = {
  id: string;
  code: string;
  lessonId: string;
  lessonNo: number;
  lessonTitle: string;
  titleFr: string;
  titleFa: string | null;
  definitionFa: string | null;
  mastery: AggregateMastery;
  recurringErrorCount: number | null;
  misconception: RuntimeMisconception | null;
};

type TrendPoint = {
  date: string;
  score: number;
};

const faNumber = new Intl.NumberFormat("fa-IR");
const enNumber = new Intl.NumberFormat("en-CA");

function toApiError(caught: unknown, message: string) {
  return caught instanceof ApiError
    ? caught
    : new ApiError({status: 0, code: "NETWORK_ERROR", message});
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function ratioToPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(clamp(value <= 1 ? value * 100 : value));
}

function hasEvidence(item: MasteryItem | null | undefined) {
  return Boolean(item && (item.evidence_count ?? 0) > 0 && item.mastery_band !== "NO_EVIDENCE");
}

function scoreToBand(score: number | null, confidence: number | null): MasteryBand {
  if (score === null) return "NO_EVIDENCE";
  if ((confidence ?? 0) < 45) return "UNCERTAIN";
  if (score >= 75) return "STRONG";
  if (score >= 55) return "DEVELOPING";
  return "WEAK";
}

function fromMasteryItem(item: MasteryItem | null | undefined): AggregateMastery {
  if (!hasEvidence(item)) return {score: null, confidence: null, coverage: null, evidence: 0, band: item?.mastery_band ?? "NO_EVIDENCE"};
  return {
    score: Math.round(clamp(item!.mastery_score_pct)),
    confidence: ratioToPct(item!.confidence),
    coverage: ratioToPct(item!.coverage_ratio),
    evidence: item!.evidence_count ?? 0,
    band: item!.mastery_band,
  };
}

function fromRuntimeMastery(item: RuntimeMastery | null | undefined): AggregateMastery | null {
  if (!item) return null;
  const hasRuntimeEvidence = item.evidence_count > 0 && item.mastery_band !== "NO_EVIDENCE";
  if (!hasRuntimeEvidence) return {score: null, confidence: null, coverage: null, evidence: 0, band: item.mastery_band};
  return {
    score: Math.round(clamp(item.mastery_score_pct)),
    confidence: ratioToPct(item.confidence),
    coverage: ratioToPct(item.coverage_ratio),
    evidence: item.evidence_count,
    band: item.mastery_band,
  };
}

function aggregateMastery(items: Array<MasteryItem | undefined>): AggregateMastery {
  const evidenceItems = items.filter((item): item is MasteryItem => hasEvidence(item));
  if (!evidenceItems.length) return {score: null, confidence: null, coverage: null, evidence: 0, band: "NO_EVIDENCE"};

  const weights = evidenceItems.map((item) => Math.max(1, item.evidence_count ?? 1));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const weighted = (selector: (item: MasteryItem) => number) =>
    evidenceItems.reduce((sum, item, index) => sum + selector(item) * (weights[index] ?? 1), 0) / weightTotal;

  const score = Math.round(clamp(weighted((item) => item.mastery_score_pct)));
  const confidence = ratioToPct(weighted((item) => item.confidence));
  const coverage = ratioToPct(weighted((item) => item.coverage_ratio));
  const evidence = evidenceItems.reduce((sum, item) => sum + (item.evidence_count ?? 0), 0);
  return {score, confidence, coverage, evidence, band: scoreToBand(score, confidence)};
}

function bandCopy(band: MasteryBand, isFa: boolean) {
  const labels: Record<MasteryBand, {fa: string; en: string; icon: string; className: string}> = {
    STRONG: {fa: "مسلط", en: "Strong", icon: "✓", className: styles.strong ?? ""},
    DEVELOPING: {fa: "در حال رشد", en: "Developing", icon: "↗", className: styles.developing ?? ""},
    WEAK: {fa: "نیازمند توجه", en: "Needs attention", icon: "!", className: styles.weak ?? ""},
    UNCERTAIN: {fa: "شواهد ناکافی", en: "Uncertain", icon: "?", className: styles.uncertain ?? ""},
    NO_EVIDENCE: {fa: "بدون شواهد", en: "No evidence", icon: "○", className: styles.noEvidence ?? ""},
  };
  const meta = labels[band];
  return {...meta, label: isFa ? meta.fa : meta.en};
}

function findMapSubcategory(envelope: MasteryMapEnvelope | null, subcategoryId: string) {
  if (!envelope) return {subcategory: null, category: null};
  for (const category of envelope.data.categories) {
    const subcategory = category.subcategories.find((item) => item.id === subcategoryId);
    if (subcategory) return {subcategory, category};
  }
  return {subcategory: null, category: null};
}

function practiceHref(locale: Locale, subcategoryId: string) {
  return `/${locale}/tests/new?mode=adaptive&scope=related&group=${encodeURIComponent(subcategoryId)}`;
}

function buildTrend(points: ProgressPoint[]) {
  const groups = new Map<string, ProgressPoint[]>();
  for (const point of points) {
    if (point.scope_type !== "LESSON" || point.evidence_count <= 0) continue;
    const date = point.captured_at.slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), point]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]): TrendPoint => {
      const weights = rows.map((row) => Math.max(1, row.evidence_count));
      const total = weights.reduce((sum, value) => sum + value, 0);
      const score = rows.reduce((sum, row, index) => sum + clamp(row.mastery_score_pct) * (weights[index] ?? 1), 0) / total;
      return {date, score: Math.round(score)};
    })
    .slice(-8);
}

function CircleIcon({tone, children}: {tone: "amber" | "blue" | "green" | "violet"; children: ReactNode}) {
  return <span className={`${styles.metricIcon} ${styles[tone]}`} aria-hidden="true">{children}</span>;
}

export function SubcategoryDetailClient({locale, subcategoryId}: {locale: Locale; subcategoryId: string}) {
  const isFa = locale === "fa";
  const number = isFa ? faNumber : enNumber;
  const [data, setData] = useState<LoadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const copy = isFa
    ? {
        breadcrumbCategoryFallback: "دسته گرامری",
        pageLabel: "زیرگروه",
        mastery: "Mastery",
        confidence: "Confidence",
        coverage: "Coverage",
        evidence: "پاسخ‌های ثبت‌شده",
        evidenceHint: "شواهد مؤثر در Mastery",
        inventory: "سؤال موجود",
        recommendation: "اقدام پیشنهادی",
        practice: "تمرین زیرگروه",
        concepts: "زیرموضوع‌ها",
        conceptsHint: "وضعیت Mastery برای هر مفهوم اتمی",
        lesson: "درس",
        lessons: "درس",
        concept: "زیرموضوع کلیدی",
        recurringError: "خطای تکرارشونده",
        unresolvedInLesson: "خطای حل‌نشده در درس",
        analysis: "تحلیل زیرگروه",
        trend: "روند Mastery",
        trendHint: "تجمیع نمایشی از snapshot درس‌های عضو",
        relatedLessons: "درس‌های مرتبط",
        openLesson: "باز کردن درس",
        needsAttention: "نیاز به توجه",
        noAttention: "هنوز داده کافی برای اولویت‌بندی مفهوم‌ها وجود ندارد.",
        noTrend: "برای رسم روند حداقل دو snapshot زمانی لازم است.",
        degradedTitle: "بخشی از تحلیل فعلاً در دسترس نیست",
        degradedHint: "ساختار واقعی زیرگروه و درس‌ها حفظ شده است و برای داده‌های ناموجود مقدار ساختگی نمایش داده نمی‌شود.",
        retry: "تلاش دوباره",
        notFound: "این Subcategory در محتوای فعال پیدا نشد",
        notFoundHint: "شناسه را بررسی کنید یا از Mastery Map دوباره وارد این بخش شوید.",
        backMap: "بازگشت به Mastery Map",
        noConcepts: "برای این زیرگروه هنوز زیرموضوع فعالی از API برنگشته است.",
        topError: "الگوی خطای برجسته",
        noError: "برای این مفهوم خطای برجسته‌ای در snapshot فعلی ثبت نشده است.",
      }
    : {
        breadcrumbCategoryFallback: "Grammar category",
        pageLabel: "Subcategory",
        mastery: "Mastery",
        confidence: "Confidence",
        coverage: "Coverage",
        evidence: "Recorded answers",
        evidenceHint: "Evidence contributing to mastery",
        inventory: "questions available",
        recommendation: "Recommended action",
        practice: "Practice subcategory",
        concepts: "Subtopics",
        conceptsHint: "Mastery state for each atomic concept",
        lesson: "lesson",
        lessons: "lessons",
        concept: "key subtopic",
        recurringError: "recurring error",
        unresolvedInLesson: "unresolved lesson error",
        analysis: "Subcategory analysis",
        trend: "Mastery trend",
        trendHint: "Display-only aggregate of member-lesson snapshots",
        relatedLessons: "Related lessons",
        openLesson: "Open lesson",
        needsAttention: "Needs attention",
        noAttention: "There is not enough evidence to prioritize concepts yet.",
        noTrend: "At least two persisted snapshots are required to draw a trend.",
        degradedTitle: "Some analytics are temporarily unavailable",
        degradedHint: "The real subcategory structure and lessons remain visible, and missing analytics are never replaced with fabricated values.",
        retry: "Retry",
        notFound: "This subcategory was not found in active content",
        notFoundHint: "Check the identifier or re-open this section from the Mastery Map.",
        backMap: "Back to Mastery Map",
        noConcepts: "No active subtopics were returned for this subcategory yet.",
        topError: "Highlighted error pattern",
        noError: "No highlighted error pattern is recorded for this concept in the current snapshot.",
      };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lessonsResponse = await apiRequest<LessonCollectionEnvelope>("/api/backend/lessons?page[size]=100&sort=lesson_no");
      if (!lessonsResponse) throw new ApiError({status: 502, code: "EMPTY_LESSON_RESPONSE", message: "Lesson data was empty."});
      const lessons = lessonsResponse.data.filter((lesson) => lesson.subcategory_id === subcategoryId);

      if (!lessons.length) {
        setData({lessons: [], lessonDetails: [], lessonMastery: [], subtopicMastery: [], progress: [], mapSubcategory: null, mapCategory: null, degraded: []});
        return;
      }

      const from = new Date();
      from.setDate(from.getDate() - 90);
      const [lessonMasteryResult, subtopicMasteryResult, detailsResult, mapResult, progressResult] = await Promise.allSettled([
        apiRequest<MasteryEnvelope>("/api/backend/mastery?filter[scope_type]=LESSON"),
        apiRequest<MasteryEnvelope>("/api/backend/mastery?filter[scope_type]=SUBTOPIC"),
        Promise.allSettled(lessons.map((lesson) => apiRequest<LessonDetailEnvelope>(`/api/backend/lessons/${encodeURIComponent(lesson.id)}`))),
        apiRequest<MasteryMapEnvelope>(`/api/backend/mastery-map?locale=${locale}`),
        Promise.allSettled(lessons.map((lesson) => apiRequest<ProgressEnvelope>(`/api/backend/progress?filter[scope_type]=LESSON&filter[scope_id]=${encodeURIComponent(lesson.id)}&filter[from]=${encodeURIComponent(from.toISOString())}`))),
      ]);

      const degraded: string[] = [];
      const lessonMastery = lessonMasteryResult.status === "fulfilled" && lessonMasteryResult.value
        ? lessonMasteryResult.value.data.filter((item) => item.scope_type === "LESSON")
        : (degraded.push("lesson_mastery"), []);
      const subtopicMastery = subtopicMasteryResult.status === "fulfilled" && subtopicMasteryResult.value
        ? subtopicMasteryResult.value.data.filter((item) => item.scope_type === "SUBTOPIC")
        : (degraded.push("subtopic_mastery"), []);

      let lessonDetails: LessonDetail[] = [];
      if (detailsResult.status === "fulfilled") {
        lessonDetails = detailsResult.value.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value.data] : []);
        if (lessonDetails.length !== lessons.length) degraded.push("lesson_details");
      } else {
        degraded.push("lesson_details");
      }

      const mapEnvelope = mapResult.status === "fulfilled" ? mapResult.value : null;
      const mapMatch = findMapSubcategory(mapEnvelope, subcategoryId);
      if (!mapMatch.subcategory) degraded.push("mastery_map_insights");

      let progress: ProgressPoint[] = [];
      if (progressResult.status === "fulfilled") {
        progress = progressResult.value.flatMap((result) => result.status === "fulfilled" && result.value ? result.value.data.points : []);
        if (progressResult.value.some((result) => result.status === "rejected" || !result.value)) degraded.push("progress");
      } else {
        degraded.push("progress");
      }

      setData({
        lessons,
        lessonDetails,
        lessonMastery,
        subtopicMastery,
        progress,
        mapSubcategory: mapMatch.subcategory,
        mapCategory: mapMatch.category,
        degraded: [...new Set(degraded)],
      });
    } catch (caught) {
      setData(null);
      setError(toApiError(caught, "Subcategory detail failed to load."));
    } finally {
      setLoading(false);
    }
  }, [locale, subcategoryId]);

  useEffect(() => { void load(); }, [load]);

  const derived = useMemo(() => {
    if (!data || !data.lessons.length) return null;
    const first = data.lessons[0]!;
    const lessonMasteryById = new Map(data.lessonMastery.filter((item) => item.scope_id).map((item) => [item.scope_id as string, item]));
    const subtopicMasteryById = new Map(data.subtopicMastery.filter((item) => item.scope_id).map((item) => [item.scope_id as string, item]));
    const detailsByLesson = new Map(data.lessonDetails.map((detail) => [detail.id, detail]));
    const mapLessonById = new Map((data.mapSubcategory?.lessons ?? []).map((lesson) => [lesson.id, lesson]));
    const misconceptionBySubtopic = new Map<string, RuntimeMisconception>();
    for (const lesson of data.mapSubcategory?.lessons ?? []) {
      const misconception = lesson.top_misconception;
      if (misconception?.subtopic_id) misconceptionBySubtopic.set(misconception.subtopic_id, misconception);
    }

    const concepts: ConceptRow[] = data.lessons.flatMap((lesson) => {
      const detail = detailsByLesson.get(lesson.id);
      return (detail?.subtopics ?? []).map((subtopic: Subtopic) => {
        const mastery = fromMasteryItem(subtopicMasteryById.get(subtopic.id));
        const misconception = misconceptionBySubtopic.get(subtopic.id) ?? null;
        return {
          id: subtopic.id,
          code: subtopic.code,
          lessonId: lesson.id,
          lessonNo: lesson.lesson_no,
          lessonTitle: lesson.title_fr,
          titleFr: subtopic.title_fr,
          titleFa: subtopic.title_fa ?? null,
          definitionFa: subtopic.short_definition_fa ?? null,
          mastery,
          recurringErrorCount: misconception?.repeat_count ?? null,
          misconception,
        };
      });
    }).sort((a, b) => a.lessonNo - b.lessonNo || a.code.localeCompare(b.code));

    const runtimeMastery = fromRuntimeMastery(data.mapSubcategory?.mastery);
    const fallbackMastery = aggregateMastery(data.lessons.map((lesson) => lessonMasteryById.get(lesson.id)));
    const mastery = runtimeMastery ?? fallbackMastery;
    const inventory = data.lessons.reduce((sum, lesson) => sum + lesson.question_count, 0);
    const unresolvedReviewCount = data.lessons.reduce((sum, lesson) => sum + (mapLessonById.get(lesson.id)?.unresolved_review_count ?? 0), 0);

    const prioritized = [...concepts].sort((a, b) => {
      const aScore = a.mastery.score;
      const bScore = b.mastery.score;
      if (aScore === null && bScore !== null) return -1;
      if (bScore === null && aScore !== null) return 1;
      if (aScore !== bScore) return (aScore ?? 101) - (bScore ?? 101);
      return (b.recurringErrorCount ?? 0) - (a.recurringErrorCount ?? 0);
    });
    const recommended = prioritized[0] ?? null;
    const attention = prioritized.filter((item) => item.mastery.score !== null || (item.recurringErrorCount ?? 0) > 0).slice(0, 3);

    const relatedLessons = data.lessons.map((lesson) => ({
      lesson,
      mastery: fromMasteryItem(lessonMasteryById.get(lesson.id)),
      unresolvedReviewCount: mapLessonById.get(lesson.id)?.unresolved_review_count ?? 0,
    }));

    return {
      titleFr: data.mapSubcategory?.title_fr ?? first.subcategory_title_fr ?? first.short_title,
      titleFa: data.mapSubcategory?.title_fa ?? first.subcategory_title_fa ?? null,
      categoryId: data.mapCategory?.id ?? first.category_id,
      categoryTitleFr: data.mapCategory?.title_fr ?? first.category_title_fr ?? "Category",
      categoryTitleFa: data.mapCategory?.title_fa ?? first.category_title_fa ?? null,
      mastery,
      inventory,
      unresolvedReviewCount,
      concepts,
      relatedLessons,
      recommended,
      attention,
      trend: buildTrend(data.progress),
    };
  }, [data]);

  if (loading && !data) return <LoadingCard label={isFa ? "بارگذاری جزئیات زیرگروه" : "Loading subcategory detail"} />;

  if (!data) {
    return (
      <StatusPanel
        title={error?.status === 401 ? (isFa ? "ابتدا وارد شوید" : "Please log in") : (error?.message ?? copy.notFound)}
        tone="danger"
        requestId={error?.requestId}
        action={error?.status === 401
          ? {label: isFa ? "ورود" : "Log in", href: `/${locale}/login`}
          : {label: copy.retry, onClick: load}}
      >
        <p>{error?.code}</p>
      </StatusPanel>
    );
  }

  if (!data.lessons.length || !derived) {
    return (
      <StatusPanel title={copy.notFound} tone="warning" action={{label: copy.backMap, href: `/${locale}/mastery-map`}}>
        <p>{copy.notFoundHint}</p>
      </StatusPanel>
    );
  }

  const practice = practiceHref(locale, subcategoryId);
  const lessonLabel = data.lessons.length === 1 ? copy.lesson : copy.lessons;
  const categoryLabel = isFa ? (derived.categoryTitleFa || derived.categoryTitleFr) : derived.categoryTitleFr;

  return (
    <div className={styles.page} dir={isFa ? "rtl" : "ltr"}>
      <nav className={styles.breadcrumb} aria-label={isFa ? "مسیر صفحه" : "Breadcrumb"}>
        <Link href={`/${locale}/categories/${derived.categoryId}`}>{categoryLabel || copy.breadcrumbCategoryFallback}</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{copy.pageLabel}</span>
      </nav>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>{copy.pageLabel}</p>
        <h1 lang="fr" dir="ltr">{derived.titleFr}</h1>
        <p className={styles.metaLine}>
          {isFa && derived.titleFa ? <><span>{derived.titleFa}</span><i aria-hidden="true">•</i></> : null}
          <span>{number.format(data.lessons.length)} {lessonLabel}</span>
          <i aria-hidden="true">•</i>
          <span>{number.format(derived.concepts.length)} {copy.concept}</span>
        </p>
      </header>

      {data.degraded.length ? (
        <StatusPanel title={copy.degradedTitle} tone="warning" action={{label: copy.retry, onClick: load}}>
          <p>{copy.degradedHint}</p>
        </StatusPanel>
      ) : null}

      <section className={styles.statGrid} aria-label={isFa ? "خلاصه زیرگروه" : "Subcategory summary"}>
        <MetricCard icon={<CircleIcon tone="amber">◎</CircleIcon>} label={copy.mastery} value={derived.mastery.score} number={number} />
        <MetricCard icon={<CircleIcon tone="blue">◉</CircleIcon>} label={copy.confidence} value={derived.mastery.confidence} number={number} />
        <MetricCard icon={<CircleIcon tone="green">◔</CircleIcon>} label={copy.coverage} value={derived.mastery.coverage} number={number} />
        <article className={styles.metricCard}>
          <CircleIcon tone="violet">✓</CircleIcon>
          <div>
            <span>{copy.evidence}</span>
            <strong>{number.format(derived.mastery.evidence)}</strong>
            <small>{copy.evidenceHint} · {number.format(derived.inventory)} {copy.inventory}</small>
          </div>
        </article>
        <article className={styles.recommendationCard}>
          <div>
            <span>{copy.recommendation}</span>
            <strong lang="fr" dir="ltr">{derived.recommended?.titleFr ?? derived.titleFr}</strong>
          </div>
          <Link href={practice}>{copy.practice}</Link>
        </article>
      </section>

      <div className={styles.workspace}>
        <main className={styles.primaryPanel} aria-labelledby="subcategory-concepts-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="subcategory-concepts-title">{copy.concepts}</h2>
              <p>{copy.conceptsHint}</p>
            </div>
            <span className={styles.countBadge}>{number.format(derived.concepts.length)}</span>
          </div>

          {derived.concepts.length ? (
            <div className={styles.conceptGrid}>
              {derived.concepts.map((concept) => (
                <ConceptCard key={concept.id} concept={concept} locale={locale} number={number} copy={copy} />
              ))}
            </div>
          ) : <p className={styles.emptyText}>{copy.noConcepts}</p>}
        </main>

        <aside className={styles.analysisPanel} aria-labelledby="subcategory-analysis-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="subcategory-analysis-title">{copy.analysis}</h2>
              <p>{copy.trend} — {copy.trendHint}</p>
            </div>
          </div>

          <TrendChart points={derived.trend} isFa={isFa} number={number} emptyLabel={copy.noTrend} />

          <section className={styles.relatedLessons}>
            <h3>{copy.relatedLessons}</h3>
            <div className={styles.lessonList}>
              {derived.relatedLessons.map(({lesson, mastery, unresolvedReviewCount}) => (
                <article className={styles.lessonCard} key={lesson.id}>
                  <div className={styles.lessonTopline}>
                    <span>Lesson {number.format(lesson.lesson_no)}</span>
                    <Link href={`/${locale}/lessons/${lesson.id}?book=${DEFAULT_GRAMMAR_BOOK_SLUG}`}>{copy.openLesson}<span aria-hidden="true">‹</span></Link>
                  </div>
                  <strong lang="fr" dir="ltr">{lesson.title_fr}</strong>
                  <div className={styles.lessonMetrics}>
                    <span>Mastery</span>
                    <b>{mastery.score === null ? "—" : `${number.format(mastery.score)}%`}</b>
                    {unresolvedReviewCount > 0 ? <small>{number.format(unresolvedReviewCount)} {copy.unresolvedInLesson}</small> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.attentionSection}>
            <h3>{copy.needsAttention}</h3>
            {derived.attention.length ? (
              <div className={styles.attentionList}>
                {derived.attention.map((item) => (
                  <Link key={item.id} href={`/${locale}/lessons/${item.lessonId}?book=${DEFAULT_GRAMMAR_BOOK_SLUG}`}>
                    <span lang="fr" dir="ltr">{item.titleFr}</span>
                    <strong>{item.mastery.score === null ? "—" : `${number.format(item.mastery.score)}%`}</strong>
                  </Link>
                ))}
              </div>
            ) : <p className={styles.emptyText}>{copy.noAttention}</p>}
          </section>

          <div className={styles.analysisFooter}>
            {derived.unresolvedReviewCount > 0 ? <span>{number.format(derived.unresolvedReviewCount)} {copy.unresolvedInLesson}</span> : <span>{copy.noError}</span>}
            <Link className={styles.primaryButton} href={practice}>{copy.practice}</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetricCard({icon, label, value, number}: {icon: ReactNode; label: string; value: number | null; number: Intl.NumberFormat}) {
  return (
    <article className={styles.metricCard}>
      {icon}
      <div><span>{label}</span><strong>{value === null ? "—" : `${number.format(value)}%`}</strong></div>
    </article>
  );
}

function ConceptCard({
  concept,
  locale,
  number,
  copy,
}: {
  concept: ConceptRow;
  locale: Locale;
  number: Intl.NumberFormat;
  copy: Record<string, string>;
}) {
  const isFa = locale === "fa";
  const band = bandCopy(concept.mastery.band, isFa);
  const score = concept.mastery.score;
  return (
    <article className={styles.conceptCard}>
      <div className={styles.conceptTopline}>
        <div>
          <h3 lang="fr" dir="ltr">{concept.titleFr}</h3>
          {isFa && (concept.definitionFa || concept.titleFa) ? <p>{concept.definitionFa || concept.titleFa}</p> : null}
        </div>
        <span className={`${styles.bandLabel} ${band.className}`}><i aria-hidden="true">{band.icon}</i>{band.label}</span>
      </div>

      <div className={styles.conceptMeta}>
        <Link href={`/${locale}/lessons/${concept.lessonId}?book=${DEFAULT_GRAMMAR_BOOK_SLUG}`}>L{String(concept.lessonNo).padStart(2, "0")}</Link>
        {concept.recurringErrorCount !== null ? (
          <span className={styles.errorMeta}>! {number.format(concept.recurringErrorCount)} {copy.recurringError}</span>
        ) : <span>{concept.code}</span>}
      </div>

      <div className={styles.masteryRow}>
        <div className={styles.progressTrack} role="progressbar" aria-label={`${copy.mastery}: ${band.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? undefined}>
          <span className={band.className} style={{inlineSize: `${score ?? 0}%`}} />
        </div>
        <strong>{score === null ? "—" : `${number.format(score)}%`}</strong>
      </div>

      {concept.misconception ? (
        <details className={styles.misconceptionDetails}>
          <summary>{copy.topError}</summary>
          <p>{isFa ? concept.misconception.statement_fa : `${concept.misconception.family} · ${concept.misconception.repeat_count} recorded occurrence(s)`}</p>
        </details>
      ) : null}
    </article>
  );
}

function TrendChart({points, isFa, number, emptyLabel}: {points: TrendPoint[]; isFa: boolean; number: Intl.NumberFormat; emptyLabel: string}) {
  if (points.length < 2) return <p className={styles.chartEmpty}>{emptyLabel}</p>;

  const width = 520;
  const height = 180;
  const padX = 18;
  const padTop = 22;
  const padBottom = 28;
  const plotHeight = height - padTop - padBottom;
  const scores = points.map((point) => clamp(point.score));
  const low = Math.max(0, Math.floor(Math.min(...scores) / 10) * 10 - 10);
  const high = Math.min(100, Math.max(low + 20, Math.ceil(Math.max(...scores) / 10) * 10 + 10));
  const range = Math.max(1, high - low);
  const step = (width - padX * 2) / Math.max(1, points.length - 1);
  const coordinates = points.map((point, index) => ({
    x: padX + index * step,
    y: padTop + (high - clamp(point.score, low, high)) / range * plotHeight,
    value: point.score,
    date: point.date,
  }));
  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const last = coordinates[coordinates.length - 1]!;
  const style = {"--trend-value": `${last.value}%`} as CSSProperties;

  return (
    <div className={styles.chartWrap} style={style}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${isFa ? "روند Mastery" : "Mastery trend"}: ${last.value}%`}>
        <line x1={padX} x2={width - padX} y1={padTop + plotHeight} y2={padTop + plotHeight} className={styles.axis} />
        <line x1={padX} x2={padX} y1={padTop} y2={padTop + plotHeight} className={styles.axis} />
        <path d={path} className={styles.trendLine} />
        {coordinates.map((point) => <circle key={`${point.date}-${point.value}`} cx={point.x} cy={point.y} r="4" className={styles.trendDot} />)}
        <text x={Math.max(padX + 24, last.x - 34)} y={Math.max(16, last.y - 12)} className={styles.chartValue}>{number.format(last.value)}%</text>
      </svg>
      <div className={styles.chartDates}>
        <span>{formatDate(points[0]!.date, isFa)}</span>
        <span>{formatDate(points[points.length - 1]!.date, isFa)}</span>
      </div>
    </div>
  );
}

function formatDate(value: string, isFa: boolean) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(isFa ? "fa-IR" : "en-CA", {month: "short", day: "numeric"}).format(date);
}

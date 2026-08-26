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
import styles from "./CategoryDetailClient.module.css";

type Lesson = LessonCollectionEnvelope["data"][number];
type LessonDetailEnvelope = components["schemas"]["LessonDetailEnvelope"];
type LessonDetail = components["schemas"]["LessonDetail"];
type MasteryItem = components["schemas"]["MasteryItem"];
type MasteryEnvelope = components["schemas"]["MasteryCollectionEnvelope"];
type ProgressEnvelope = components["schemas"]["ProgressEnvelope"];
type ProgressPoint = components["schemas"]["ProgressPoint"];
type MasteryBand = MasteryItem["mastery_band"];
type Subtopic = components["schemas"]["Subtopic"];

type CategoryData = {
  lessons: Lesson[];
  lessonDetails: LessonDetail[];
  categoryMastery: MasteryItem | null;
  lessonMastery: MasteryItem[];
  subtopicMastery: MasteryItem[];
  progress: ProgressPoint[];
  degraded: string[];
};

type SubcategoryGroup = {
  id: string;
  titleFr: string;
  titleFa: string | null;
  lessons: Lesson[];
  mastery: AggregateMastery;
};

type AggregateMastery = {
  score: number | null;
  confidence: number | null;
  coverage: number | null;
  evidence: number;
  band: MasteryBand;
};

type InsightItem = {
  id: string;
  titleFr: string;
  titleFa: string | null;
  score: number | null;
  band: MasteryBand;
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

function scoreToBand(score: number | null, confidence: number | null): MasteryBand {
  if (score === null) return "NO_EVIDENCE";
  if ((confidence ?? 0) < 45) return "UNCERTAIN";
  if (score >= 75) return "STRONG";
  if (score >= 55) return "DEVELOPING";
  return "WEAK";
}

function hasEvidence(item: MasteryItem | undefined | null) {
  return Boolean(item && (item.evidence_count ?? 0) > 0 && item.mastery_band !== "NO_EVIDENCE");
}

function aggregateMastery(items: Array<MasteryItem | undefined>): AggregateMastery {
  const evidenceItems = items.filter((item): item is MasteryItem => hasEvidence(item));
  if (!evidenceItems.length) {
    return {score: null, confidence: null, coverage: null, evidence: 0, band: "NO_EVIDENCE"};
  }

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

function compactDate(value: string, isFa: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(isFa ? "fa-IR" : "en-CA", {month: "short", day: "numeric"}).format(date);
}

function categoryPracticeHref(locale: Locale, lessons: Lesson[]) {
  const ids = lessons.map((lesson) => lesson.id).join(",");
  return `/${locale}/tests/new?mode=adaptive&scope=lessons&lessons=${encodeURIComponent(ids)}`;
}

function groupPracticeHref(locale: Locale, subcategoryId: string) {
  return `/${locale}/tests/new?mode=adaptive&scope=related&group=${encodeURIComponent(subcategoryId)}`;
}

function CircleIcon({tone, children}: {tone: "amber" | "blue" | "green" | "violet"; children: ReactNode}) {
  return <span className={`${styles.metricIcon} ${styles[tone]}`} aria-hidden="true">{children}</span>;
}

export function CategoryDetailClient({locale, categoryId}: {locale: Locale; categoryId: string}) {
  const isFa = locale === "fa";
  const number = isFa ? faNumber : enNumber;
  const [data, setData] = useState<CategoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const copy = isFa
    ? {
        breadcrumbProgress: "پیشرفت",
        breadcrumbCategories: "دسته‌های گرامری",
        mastery: "Mastery",
        confidence: "Confidence",
        coverage: "Coverage",
        answered: "سؤال‌های پاسخ‌داده",
        available: "سؤال موجود",
        next: "پیشنهاد بعدی",
        practiceCategory: "تمرین این دسته",
        subcategories: "زیرگروه‌های این دسته",
        officialTaxonomy: "زیرگروه بر اساس taxonomy رسمی پروژه",
        lesson: "درس",
        lessons: "درس",
        derived: "Mastery تجمیعی از درس‌های عضو",
        practiceSubcategory: "تمرین زیرگروه",
        relatedLessons: "درس‌های مرتبط",
        categoryAnalysis: "تحلیل دسته",
        trend: "روند Mastery",
        recent: "snapshot اخیر",
        strengths: "نقاط قوت",
        attention: "نیاز به توجه",
        map: "مشاهده Mastery Map",
        degradedTitle: "بخشی از تحلیل فعلاً در دسترس نیست",
        degradedHint: "ساختار واقعی Category و درس‌ها نمایش داده می‌شود؛ هیچ مقدار تحلیلی ساختگی جایگزین داده ناموجود نشده است.",
        noTrend: "برای رسم روند، حداقل دو snapshot ثبت‌شده لازم است.",
        noInsights: "هنوز شواهد کافی برای رتبه‌بندی وجود ندارد.",
        inventory: "موجودی تمرین",
        retry: "تلاش دوباره",
        notFound: "این Category در داده‌های فعال پیدا نشد",
        notFoundHint: "ممکن است شناسه تغییر کرده یا این دسته در نسخه فعلی active نباشد.",
        backLessons: "بازگشت به درس‌ها",
        categoryLabel: "دسته گرامری",
      }
    : {
        breadcrumbProgress: "Progress",
        breadcrumbCategories: "Grammar categories",
        mastery: "Mastery",
        confidence: "Confidence",
        coverage: "Coverage",
        answered: "Questions answered",
        available: "questions available",
        next: "Next recommendation",
        practiceCategory: "Practice this category",
        subcategories: "Subcategories in this category",
        officialTaxonomy: "Subcategories from the project taxonomy",
        lesson: "lesson",
        lessons: "lessons",
        derived: "Aggregate mastery from member lessons",
        practiceSubcategory: "Practice subcategory",
        relatedLessons: "Related lessons",
        categoryAnalysis: "Category analysis",
        trend: "Mastery trend",
        recent: "recent snapshots",
        strengths: "Strengths",
        attention: "Needs attention",
        map: "View Mastery Map",
        degradedTitle: "Some analytics are temporarily unavailable",
        degradedHint: "The real category structure and lessons remain visible; missing analytics are never replaced with fabricated values.",
        noTrend: "At least two persisted snapshots are required to draw a trend.",
        noInsights: "There is not enough evidence to rank concepts yet.",
        inventory: "Practice inventory",
        retry: "Retry",
        notFound: "This category was not found in active content",
        notFoundHint: "The identifier may have changed or the category may not be active in the current version.",
        backLessons: "Back to lessons",
        categoryLabel: "Grammar category",
      };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lessonsResponse = await apiRequest<LessonCollectionEnvelope>(
        `/api/backend/lessons?page[size]=100&sort=lesson_no&filter[category_id]=${encodeURIComponent(categoryId)}`,
      );
      if (!lessonsResponse) {
        throw new ApiError({status: 502, code: "EMPTY_CATEGORY_LESSONS", message: "Category lesson data was empty."});
      }

      const lessons = lessonsResponse.data;
      if (!lessons.length) {
        setData({lessons: [], lessonDetails: [], categoryMastery: null, lessonMastery: [], subtopicMastery: [], progress: [], degraded: []});
        return;
      }

      const from = new Date();
      from.setDate(from.getDate() - 90);
      const categoryMasteryPromise = apiRequest<MasteryEnvelope>(`/api/backend/mastery?filter[scope_type]=CATEGORY&filter[scope_id]=${encodeURIComponent(categoryId)}`);
      const lessonMasteryPromise = apiRequest<MasteryEnvelope>("/api/backend/mastery?filter[scope_type]=LESSON");
      const subtopicMasteryPromise = apiRequest<MasteryEnvelope>("/api/backend/mastery?filter[scope_type]=SUBTOPIC");
      const progressPromise = apiRequest<ProgressEnvelope>(`/api/backend/progress?filter[scope_type]=CATEGORY&filter[scope_id]=${encodeURIComponent(categoryId)}&filter[from]=${encodeURIComponent(from.toISOString())}`);
      const detailPromise = Promise.allSettled(
        lessons.map((lesson) => apiRequest<LessonDetailEnvelope>(`/api/backend/lessons/${encodeURIComponent(lesson.id)}`)),
      );

      const [categoryMasteryResult, lessonMasteryResult, subtopicMasteryResult, progressResult, detailsResult] = await Promise.allSettled([
        categoryMasteryPromise,
        lessonMasteryPromise,
        subtopicMasteryPromise,
        progressPromise,
        detailPromise,
      ]);

      const degraded: string[] = [];
      const categoryMastery = categoryMasteryResult.status === "fulfilled" && categoryMasteryResult.value
        ? categoryMasteryResult.value.data.find((item) => item.scope_type === "CATEGORY" && item.scope_id === categoryId) ?? null
        : (degraded.push("category_mastery"), null);
      const lessonMastery = lessonMasteryResult.status === "fulfilled" && lessonMasteryResult.value
        ? lessonMasteryResult.value.data.filter((item) => item.scope_type === "LESSON")
        : (degraded.push("lesson_mastery"), []);
      const subtopicMastery = subtopicMasteryResult.status === "fulfilled" && subtopicMasteryResult.value
        ? subtopicMasteryResult.value.data.filter((item) => item.scope_type === "SUBTOPIC")
        : (degraded.push("subtopic_mastery"), []);
      const progress = progressResult.status === "fulfilled" && progressResult.value
        ? progressResult.value.data.points
            .filter((point) => point.scope_type === "CATEGORY" && point.scope_id === categoryId)
            .sort((a, b) => new Date(a.captured_at).valueOf() - new Date(b.captured_at).valueOf())
        : (degraded.push("progress"), []);

      let lessonDetails: LessonDetail[] = [];
      if (detailsResult.status === "fulfilled") {
        lessonDetails = detailsResult.value.flatMap((result) =>
          result.status === "fulfilled" && result.value ? [result.value.data] : [],
        );
        if (lessonDetails.length !== lessons.length) degraded.push("lesson_details");
      } else {
        degraded.push("lesson_details");
      }

      setData({lessons, lessonDetails, categoryMastery, lessonMastery, subtopicMastery, progress, degraded});
    } catch (caught) {
      setData(null);
      setError(toApiError(caught, "Category detail failed to load."));
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => { void load(); }, [load]);

  const derived = useMemo(() => {
    if (!data || !data.lessons.length) return null;
    const first = data.lessons[0]!;
    const lessonMasteryById = new Map(
      data.lessonMastery
        .filter((item) => item.scope_id)
        .map((item) => [item.scope_id as string, item]),
    );
    const subtopicMasteryById = new Map(
      data.subtopicMastery
        .filter((item) => item.scope_id)
        .map((item) => [item.scope_id as string, item]),
    );

    const groupMap = new Map<string, SubcategoryGroup>();
    for (const lesson of data.lessons) {
      const titleFr = lesson.subcategory_title_fr ?? lesson.short_title;
      const titleFa = lesson.subcategory_title_fa ?? null;
      const existing = groupMap.get(lesson.subcategory_id);
      if (existing) existing.lessons.push(lesson);
      else {
        groupMap.set(lesson.subcategory_id, {
          id: lesson.subcategory_id,
          titleFr,
          titleFa,
          lessons: [lesson],
          mastery: {score: null, confidence: null, coverage: null, evidence: 0, band: "NO_EVIDENCE"},
        });
      }
    }

    const groups = [...groupMap.values()]
      .map((group) => ({
        ...group,
        mastery: aggregateMastery(group.lessons.map((lesson) => lessonMasteryById.get(lesson.id))),
      }))
      .sort((a, b) => Math.min(...a.lessons.map((lesson) => lesson.lesson_no)) - Math.min(...b.lessons.map((lesson) => lesson.lesson_no)));

    const detailsByLesson = new Map(data.lessonDetails.map((detail) => [detail.id, detail]));
    const subtopics = data.lessons.flatMap((lesson) => detailsByLesson.get(lesson.id)?.subtopics ?? []);
    const insights: InsightItem[] = subtopics.map((subtopic: Subtopic) => {
      const mastery = subtopicMasteryById.get(subtopic.id);
      return {
        id: subtopic.id,
        titleFr: subtopic.title_fr,
        titleFa: subtopic.title_fa ?? null,
        score: hasEvidence(mastery) ? Math.round(clamp(mastery!.mastery_score_pct)) : null,
        band: mastery?.mastery_band ?? "NO_EVIDENCE",
      };
    });

    const evidencedInsights = insights.filter((item): item is InsightItem & {score: number} => item.score !== null);
    const strengths = [...evidencedInsights].sort((a, b) => b.score - a.score).slice(0, 2);
    const attention = [...evidencedInsights].sort((a, b) => a.score - b.score).slice(0, 1);

    const categoryMastery = data.categoryMastery;
    const fallbackAggregate = aggregateMastery(data.lessons.map((lesson) => lessonMasteryById.get(lesson.id)));
    const score = hasEvidence(categoryMastery) ? Math.round(clamp(categoryMastery!.mastery_score_pct)) : fallbackAggregate.score;
    const confidence = hasEvidence(categoryMastery) ? ratioToPct(categoryMastery!.confidence) : fallbackAggregate.confidence;
    const coverage = hasEvidence(categoryMastery) ? ratioToPct(categoryMastery!.coverage_ratio) : fallbackAggregate.coverage;
    const answeredEvidence = hasEvidence(categoryMastery) ? (categoryMastery!.evidence_count ?? 0) : fallbackAggregate.evidence;
    const inventory = data.lessons.reduce((sum, lesson) => sum + lesson.question_count, 0);

    const recommended = [...groups].sort((a, b) => {
      const aScore = a.mastery.score ?? -1;
      const bScore = b.mastery.score ?? -1;
      if (aScore === -1 && bScore !== -1) return -1;
      if (bScore === -1 && aScore !== -1) return 1;
      return aScore - bScore;
    })[0] ?? groups[0];

    const trend = data.progress.slice(-8);

    return {
      titleFr: first.category_title_fr ?? data.categoryMastery?.scope_title ?? first.title_fr,
      titleFa: first.category_title_fa ?? null,
      score,
      confidence,
      coverage,
      answeredEvidence,
      inventory,
      groups,
      trend,
      strengths,
      attention,
      recommended,
    };
  }, [data]);

  if (loading && !data) {
    return <LoadingCard label={isFa ? "بارگذاری جزئیات دسته" : "Loading category detail"} />;
  }

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
      <StatusPanel
        title={copy.notFound}
        tone="warning"
        action={{label: copy.backLessons, href: `/${locale}/lessons`}}
      >
        <p>{copy.notFoundHint}</p>
      </StatusPanel>
    );
  }

  const practiceHref = categoryPracticeHref(locale, data.lessons);
  const lessonLabel = data.lessons.length === 1 ? copy.lesson : copy.lessons;
  const subcategoryCount = derived.groups.length;

  return (
    <div className={styles.page} dir={isFa ? "rtl" : "ltr"}>
      <nav className={styles.breadcrumb} aria-label={isFa ? "مسیر صفحه" : "Breadcrumb"}>
        <Link href={`/${locale}/progress`}>{copy.breadcrumbProgress}</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/${locale}/mastery-map`}>{copy.breadcrumbCategories}</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" lang="fr" dir="ltr">{derived.titleFr}</span>
      </nav>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>{copy.categoryLabel}</p>
        <h1 lang="fr" dir="ltr">{derived.titleFr}</h1>
        <p className={styles.metaLine}>
          {isFa && derived.titleFa ? <><span>{derived.titleFa}</span><i aria-hidden="true">•</i></> : null}
          <span>{number.format(data.lessons.length)} {lessonLabel}</span>
          <i aria-hidden="true">•</i>
          <span>{number.format(subcategoryCount)} {isFa ? "زیرگروه" : "subcategories"}</span>
        </p>
      </header>

      {data.degraded.length ? (
        <StatusPanel title={copy.degradedTitle} tone="warning" action={{label: copy.retry, onClick: load}}>
          <p>{copy.degradedHint}</p>
        </StatusPanel>
      ) : null}

      <section className={styles.statGrid} aria-label={isFa ? "خلاصه دسته" : "Category summary"}>
        <MetricCard icon={<CircleIcon tone="amber">◎</CircleIcon>} label={copy.mastery} value={derived.score} number={number} />
        <MetricCard icon={<CircleIcon tone="blue">◉</CircleIcon>} label={copy.confidence} value={derived.confidence} number={number} />
        <MetricCard icon={<CircleIcon tone="green">◔</CircleIcon>} label={copy.coverage} value={derived.coverage} number={number} />
        <article className={styles.metricCard}>
          <CircleIcon tone="violet">✓</CircleIcon>
          <div>
            <span>{copy.answered}</span>
            <strong>{number.format(derived.answeredEvidence)}</strong>
            <small>{number.format(derived.inventory)} {copy.available}</small>
          </div>
        </article>
        <article className={styles.recommendationCard}>
          <div>
            <span>{copy.next}</span>
            <strong lang="fr" dir="ltr">{derived.recommended?.titleFr ?? derived.titleFr}</strong>
          </div>
          <Link href={practiceHref}>{copy.practiceCategory}</Link>
        </article>
      </section>

      <div className={styles.workspace}>
        <section className={styles.primaryPanel} aria-labelledby="category-subcategories-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="category-subcategories-title">{copy.subcategories}</h2>
              <p>{number.format(subcategoryCount)} {copy.officialTaxonomy}</p>
            </div>
          </div>

          <div className={styles.subcategoryList}>
            {derived.groups.map((group, index) => {
              const band = bandCopy(group.mastery.band, isFa);
              const score = group.mastery.score;
              return (
                <article className={styles.subcategoryCard} key={group.id}>
                  <div className={`${styles.subcategoryMark} ${band.className}`} aria-hidden="true">
                    <span>{index + 1}</span>
                  </div>
                  <div className={styles.subcategoryCopy}>
                    <h3 lang="fr" dir="ltr">{group.titleFr}</h3>
                    {isFa && group.titleFa ? <p>{group.titleFa}</p> : null}
                    <small>{number.format(group.lessons.length)} {group.lessons.length === 1 ? copy.lesson : copy.lessons}</small>
                  </div>
                  <div className={styles.subcategoryMastery}>
                    <span className={`${styles.bandLabel} ${band.className}`}><i aria-hidden="true">{band.icon}</i>{band.label}</span>
                    <div className={styles.progressTrack} role="progressbar" aria-label={`${copy.mastery}: ${band.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? undefined}>
                      <span className={band.className} style={{inlineSize: `${score ?? 0}%`}} />
                    </div>
                    <strong>{score === null ? "—" : `${number.format(score)}%`}</strong>
                    <small>{copy.derived}</small>
                    <Link href={groupPracticeHref(locale, group.id)}>{copy.practiceSubcategory}<span aria-hidden="true">‹</span></Link>
                  </div>
                </article>
              );
            })}
          </div>

          <div className={styles.relatedLessons}>
            <h2>{copy.relatedLessons}</h2>
            <div className={styles.lessonChips}>
              {data.lessons.map((lesson) => (
                <Link
                  key={lesson.id}
                  href={`/${locale}/lessons/${lesson.id}?book=${DEFAULT_GRAMMAR_BOOK_SLUG}`}
                  title={lesson.title_fr}
                >
                  <span>L{String(lesson.lesson_no).padStart(2, "0")}</span>
                  <strong lang="fr" dir="ltr">{lesson.title_fr}</strong>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <aside className={styles.analysisPanel} aria-labelledby="category-analysis-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="category-analysis-title">{copy.categoryAnalysis}</h2>
              <p>{copy.trend} — {copy.recent}</p>
            </div>
          </div>

          <TrendChart points={derived.trend} isFa={isFa} number={number} emptyLabel={copy.noTrend} />

          <section className={styles.insightSection}>
            <h3>{copy.strengths}</h3>
            {derived.strengths.length ? (
              <div className={styles.insightList}>
                {derived.strengths.map((item) => (
                  <div className={styles.insightRow} key={item.id}>
                    <span lang="fr" dir="ltr">{item.titleFr}</span>
                    <strong className={styles.positive}>{number.format(item.score)}%</strong>
                  </div>
                ))}
              </div>
            ) : <p className={styles.emptyText}>{copy.noInsights}</p>}
          </section>

          <section className={styles.insightSection}>
            <h3>{copy.attention}</h3>
            {derived.attention.length ? (
              <div className={`${styles.insightRow} ${styles.attentionRow}`}>
                <span lang="fr" dir="ltr">{derived.attention[0]!.titleFr}</span>
                <strong>{number.format(derived.attention[0]!.score)}%</strong>
              </div>
            ) : <p className={styles.emptyText}>{copy.noInsights}</p>}
          </section>

          <div className={styles.analysisActions}>
            <Link className={styles.secondaryButton} href={`/${locale}/mastery-map`}>{copy.map}</Link>
            <Link className={styles.primaryButton} href={practiceHref}>{copy.practiceCategory}</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  number,
}: {
  icon: ReactNode;
  label: string;
  value: number | null;
  number: Intl.NumberFormat;
}) {
  return (
    <article className={styles.metricCard}>
      {icon}
      <div>
        <span>{label}</span>
        <strong>{value === null ? "—" : `${number.format(value)}%`}</strong>
      </div>
    </article>
  );
}

function TrendChart({
  points,
  isFa,
  number,
  emptyLabel,
}: {
  points: ProgressPoint[];
  isFa: boolean;
  number: Intl.NumberFormat;
  emptyLabel: string;
}) {
  if (points.length < 2) return <p className={styles.chartEmpty}>{emptyLabel}</p>;

  const width = 560;
  const height = 190;
  const padX = 18;
  const padTop = 20;
  const padBottom = 35;
  const plotHeight = height - padTop - padBottom;
  const safePoints = points.map((point) => clamp(point.mastery_score_pct));
  const low = Math.max(0, Math.floor(Math.min(...safePoints) / 10) * 10 - 10);
  const high = Math.min(100, Math.max(low + 20, Math.ceil(Math.max(...safePoints) / 10) * 10 + 10));
  const range = Math.max(1, high - low);
  const step = (width - padX * 2) / Math.max(1, points.length - 1);
  const coordinates = points.map((point, index) => ({
    x: padX + index * step,
    y: padTop + (high - clamp(point.mastery_score_pct, low, high)) / range * plotHeight,
    value: Math.round(clamp(point.mastery_score_pct)),
    date: point.captured_at,
  }));
  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const last = coordinates[coordinates.length - 1]!;
  const style = {"--chart-progress": `${last.value}%`} as CSSProperties;

  return (
    <div className={styles.chartWrap} style={style}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${isFa ? "روند Mastery" : "Mastery trend"}: ${last.value}%`}>
        <line x1={padX} x2={width - padX} y1={padTop + plotHeight} y2={padTop + plotHeight} className={styles.axis} />
        <line x1={padX} x2={padX} y1={padTop} y2={padTop + plotHeight} className={styles.axis} />
        <line x1={padX} x2={width - padX} y1={padTop + plotHeight * .5} y2={padTop + plotHeight * .5} className={styles.gridLine} />
        <path d={path} className={styles.trendLine} />
        {coordinates.map((point, index) => <circle key={`${point.date}:${index}`} cx={point.x} cy={point.y} r="4.5" className={styles.trendDot} />)}
        <text x={Math.max(padX, last.x - 28)} y={Math.max(16, last.y - 12)} className={styles.lastValue}>{number.format(last.value)}%</text>
        <text x={padX} y={height - 7} className={styles.dateLabel}>{compactDate(points[0]!.captured_at, isFa)}</text>
        <text x={width - padX} y={height - 7} textAnchor="end" className={styles.dateLabel}>{compactDate(points[points.length - 1]!.captured_at, isFa)}</text>
      </svg>
    </div>
  );
}

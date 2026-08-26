"use client";

import type {CSSProperties} from "react";
import {useCallback, useEffect, useMemo, useState} from "react";
import Link from "next/link";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {components} from "@/lib/api/generated";
import type {LessonCollectionEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import {DEFAULT_GRAMMAR_BOOK_SLUG} from "@/lib/grammar-content/books";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./LessonListClient.module.css";

type Lesson = LessonCollectionEnvelope["data"][number];
type MasteryItem = components["schemas"]["MasteryItem"];
type MasteryEnvelope = components["schemas"]["MasteryCollectionEnvelope"];
type MasteryBand = MasteryItem["mastery_band"];
type SortKey = "lesson_asc" | "lesson_desc" | "mastery_desc" | "mastery_asc" | "questions_desc" | "tcf_desc" | "title_asc";

const PAGE_SIZE = 12;
const ALL = "all";
const MASTERY_BANDS: MasteryBand[] = ["STRONG", "DEVELOPING", "WEAK", "UNCERTAIN", "NO_EVIDENCE"];

const faDigits = new Intl.NumberFormat("fa-IR");
const enDigits = new Intl.NumberFormat("en-US");

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function toApiError(caught: unknown) {
  return caught instanceof ApiError
    ? caught
    : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Lessons failed to load."});
}

function statusMeta(band: MasteryBand, isFa: boolean) {
  const labels: Record<MasteryBand, {fa: string; en: string; icon: string; className: string}> = {
    STRONG: {fa: "مسلط", en: "Strong", icon: "✓", className: styles.statusStrong ?? ""},
    DEVELOPING: {fa: "در حال یادگیری", en: "Developing", icon: "↗", className: styles.statusDeveloping ?? ""},
    WEAK: {fa: "نیازمند تمرین", en: "Needs practice", icon: "!", className: styles.statusWeak ?? ""},
    UNCERTAIN: {fa: "شواهد ناکافی", en: "Uncertain", icon: "?", className: styles.statusUncertain ?? ""},
    NO_EVIDENCE: {fa: "شروع‌نشده", en: "Not started", icon: "○", className: styles.statusNoEvidence ?? ""},
  };
  const item = labels[band];
  return {...item, label: isFa ? item.fa : item.en};
}

function getBand(item: MasteryItem | undefined): MasteryBand {
  return item?.mastery_band ?? "NO_EVIDENCE";
}

function hasEvidence(item: MasteryItem | undefined) {
  return Boolean(item && item.mastery_band !== "NO_EVIDENCE" && (item.evidence_count ?? 0) > 0);
}

function boundedScore(item: MasteryItem | undefined) {
  if (!hasEvidence(item)) return null;
  return Math.max(0, Math.min(100, Math.round(item?.mastery_score_pct ?? 0)));
}

function ParisArtwork() {
  return (
    <svg className={styles.heroArtwork} viewBox="0 0 360 210" aria-hidden="true" focusable="false">
      <path d="M198 35h16l-5 22 16 27h-13l10 77h-34l10-77h-13l17-27-4-22Z" fill="currentColor" opacity=".82" />
      <path d="M187 161h36M192 132h26M195 101h20M194 78h22" stroke="var(--canvas)" strokeWidth="4" strokeLinecap="round" opacity=".78" />
      <path d="M80 162c13-42 42-63 75-63 10 0 20 2 29 6-8 15-13 34-15 57H80Z" fill="currentColor" opacity=".12" />
      <path d="M261 164v-52h39v52M268 112v-21h25v21M280 90V70" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" opacity=".2" />
      <circle cx="70" cy="52" r="4" fill="currentColor" opacity=".25" />
      <circle cx="101" cy="78" r="2.5" fill="currentColor" opacity=".25" />
      <circle cx="284" cy="46" r="3" fill="currentColor" opacity=".25" />
      <path d="M40 170h285" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".14" />
    </svg>
  );
}

export function LessonListClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const copy = isFa
    ? {
        eyebrow: "۵۲ درس • نقشه گرامر",
        title: "درس‌ها",
        intro: "تمام گرامرهای کتاب را بر اساس دسته، وضعیت تسلط و داده واقعی تمرین مرور کنید و سریع به درس یا تمرین بعدی بروید.",
        totalLessons: "کل درس‌ها",
        mastered: "درس‌های مسلط",
        learning: "در حال یادگیری",
        availableQuestions: "سؤال موجود",
        searchLabel: "جستجو در درس‌ها",
        searchPlaceholder: "نام درس، دسته یا زیر‌دسته را جستجو کنید…",
        category: "دسته‌بندی",
        allCategories: "همه دسته‌ها",
        status: "وضعیت تسلط",
        allStatuses: "همه وضعیت‌ها",
        sort: "مرتب‌سازی",
        sortLessonAsc: "شماره درس: صعودی",
        sortLessonDesc: "شماره درس: نزولی",
        sortMasteryDesc: "Mastery: بیشترین",
        sortMasteryAsc: "Mastery: کمترین",
        sortQuestions: "سؤال موجود: بیشترین",
        sortTcf: "اهمیت TCF: بیشترین",
        sortTitle: "عنوان فرانسوی: A تا Z",
        categories: "دسته‌های گرامری",
        all: "همه درس‌ها",
        results: "درس",
        showing: "نمایش",
        of: "از",
        tcfWeight: "وزن TCF",
        mastery: "تسلط",
        evidence: "شواهد یادگیری",
        details: "جزئیات درس",
        practice: "ساخت تمرین",
        summary: "خلاصه یادگیری",
        averageMastery: "میانگین Mastery",
        averageHint: "فقط درس‌های دارای شواهد",
        developing: "در حال رشد",
        weak: "نیازمند تمرین",
        noEvidence: "بدون شواهد",
        filters: "فیلترهای فعال",
        noFilters: "فیلتر فعالی ندارید.",
        clear: "پاک کردن همه",
        smartPractice: "تمرین هوشمند",
        smartPracticeHint: "برای تمرکز روی ضعف‌ها و درس‌های کم‌تسلط، تمرین جدید بسازید.",
        buildPractice: "ساخت تمرین جدید",
        masteryUnavailable: "داده Mastery فعلاً در دسترس نیست",
        masteryUnavailableHint: "فهرست درس‌ها و تعداد سؤال واقعی نمایش داده می‌شود؛ وضعیت تسلط تا بازیابی سرویس پنهان می‌ماند.",
        empty: "درسی با این فیلترها پیدا نشد",
        emptyHint: "جستجو یا فیلترها را تغییر دهید.",
        previous: "قبلی",
        next: "بعدی",
        page: "صفحه",
      }
    : {
        eyebrow: "52 lessons • Grammar map",
        title: "Lessons",
        intro: "Explore the complete grammar map by category, mastery state, and real practice data, then jump directly to the next lesson or practice.",
        totalLessons: "Total lessons",
        mastered: "Strong lessons",
        learning: "In progress",
        availableQuestions: "Questions available",
        searchLabel: "Search lessons",
        searchPlaceholder: "Search lesson, category, or subcategory…",
        category: "Category",
        allCategories: "All categories",
        status: "Mastery status",
        allStatuses: "All statuses",
        sort: "Sort",
        sortLessonAsc: "Lesson number: ascending",
        sortLessonDesc: "Lesson number: descending",
        sortMasteryDesc: "Mastery: highest",
        sortMasteryAsc: "Mastery: lowest",
        sortQuestions: "Questions: most available",
        sortTcf: "TCF weight: highest",
        sortTitle: "French title: A to Z",
        categories: "Grammar categories",
        all: "All lessons",
        results: "lessons",
        showing: "Showing",
        of: "of",
        tcfWeight: "TCF weight",
        mastery: "Mastery",
        evidence: "Learning evidence",
        details: "Lesson details",
        practice: "Build practice",
        summary: "Learning summary",
        averageMastery: "Average mastery",
        averageHint: "Lessons with evidence only",
        developing: "Developing",
        weak: "Needs practice",
        noEvidence: "No evidence",
        filters: "Active filters",
        noFilters: "No active filters.",
        clear: "Clear all",
        smartPractice: "Smart practice",
        smartPracticeHint: "Create a new practice to focus on weaker and lower-mastery lessons.",
        buildPractice: "Create practice",
        masteryUnavailable: "Mastery data is temporarily unavailable",
        masteryUnavailableHint: "Real lesson and question counts remain visible; mastery states are hidden until the service recovers.",
        empty: "No lessons match these filters",
        emptyHint: "Change the search term or filters.",
        previous: "Previous",
        next: "Next",
        page: "Page",
      };

  const numberFormatter = isFa ? faDigits : enDigits;
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [masteryItems, setMasteryItems] = useState<MasteryItem[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [masteryUnavailable, setMasteryUnavailable] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState(ALL);
  const [bandFilter, setBandFilter] = useState<typeof ALL | MasteryBand>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("lesson_asc");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setError(null);
    setMasteryUnavailable(false);
    const [lessonResult, masteryResult] = await Promise.allSettled([
      apiRequest<LessonCollectionEnvelope>("/api/backend/lessons?page[size]=100&sort=lesson_no"),
      apiRequest<MasteryEnvelope>("/api/backend/mastery?filter[scope_type]=LESSON"),
    ]);

    if (lessonResult.status === "rejected") {
      setLessons(null);
      setError(toApiError(lessonResult.reason));
      return;
    }
    if (lessonResult.value === null) {
      setLessons(null);
      setError(new ApiError({
        status: 502,
        code: "EMPTY_LESSON_RESPONSE",
        message: "The lessons endpoint returned an empty response.",
      }));
      return;
    }

    setLessons(lessonResult.value.data);
    if (masteryResult.status === "fulfilled" && masteryResult.value !== null) {
      setMasteryItems(masteryResult.value.data.filter((item) => item.scope_type === "LESSON"));
    } else {
      setMasteryItems([]);
      setMasteryUnavailable(true);
    }
  }, []);

  // Initial fetch synchronizes this route with the canonical lesson and mastery APIs.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const masteryByLesson = useMemo(() => {
    const map = new Map<string, MasteryItem>();
    for (const item of masteryItems) {
      if (item.scope_type === "LESSON" && item.scope_id) map.set(item.scope_id, item);
    }
    return map;
  }, [masteryItems]);

  const categories = useMemo(() => {
    if (!lessons) return [];
    const map = new Map<string, {id: string; label: string; count: number}>();
    for (const lesson of lessons) {
      const label = (isFa ? lesson.category_title_fa : lesson.category_title_fr)
        ?? lesson.category_title_fr
        ?? lesson.category_title_fa
        ?? (isFa ? "بدون دسته" : "Uncategorized");
      const existing = map.get(lesson.category_id);
      if (existing) existing.count += 1;
      else map.set(lesson.category_id, {id: lesson.category_id, label, count: 1});
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, isFa ? "fa" : "fr"));
  }, [isFa, lessons]);

  const filteredLessons = useMemo(() => {
    if (!lessons) return [];
    const needle = normalizeText(query);
    const rows = lessons.filter((lesson) => {
      const mastery = masteryByLesson.get(lesson.id);
      const searchable = [
        lesson.title_fr,
        lesson.short_title,
        lesson.category_title_fr,
        lesson.category_title_fa,
        lesson.subcategory_title_fr,
        lesson.subcategory_title_fa,
      ].map(normalizeText).join(" ");
      return (!needle || searchable.includes(needle))
        && (categoryId === ALL || lesson.category_id === categoryId)
        && (bandFilter === ALL || getBand(mastery) === bandFilter);
    });

    return rows.sort((a, b) => {
      const aMastery = boundedScore(masteryByLesson.get(a.id)) ?? -1;
      const bMastery = boundedScore(masteryByLesson.get(b.id)) ?? -1;
      switch (sortKey) {
        case "lesson_desc": return b.lesson_no - a.lesson_no;
        case "mastery_desc": return bMastery - aMastery || a.lesson_no - b.lesson_no;
        case "mastery_asc": return aMastery - bMastery || a.lesson_no - b.lesson_no;
        case "questions_desc": return b.question_count - a.question_count || a.lesson_no - b.lesson_no;
        case "tcf_desc": return (b.tcf_weight ?? 0) - (a.tcf_weight ?? 0) || a.lesson_no - b.lesson_no;
        case "title_asc": return a.title_fr.localeCompare(b.title_fr, "fr");
        default: return a.lesson_no - b.lesson_no;
      }
    });
  }, [bandFilter, categoryId, lessons, masteryByLesson, query, sortKey]);

  const summary = useMemo(() => {
    const rows = lessons ?? [];
    let strong = 0;
    let developing = 0;
    let weak = 0;
    let uncertain = 0;
    let noEvidence = 0;
    let scoreTotal = 0;
    let scoreCount = 0;
    for (const lesson of rows) {
      const mastery = masteryByLesson.get(lesson.id);
      const band = getBand(mastery);
      if (band === "STRONG") strong += 1;
      else if (band === "DEVELOPING") developing += 1;
      else if (band === "WEAK") weak += 1;
      else if (band === "UNCERTAIN") uncertain += 1;
      else noEvidence += 1;
      const score = boundedScore(mastery);
      if (score !== null) {
        scoreTotal += score;
        scoreCount += 1;
      }
    }
    return {
      total: rows.length,
      strong,
      developing,
      weak,
      uncertain,
      noEvidence,
      inProgress: developing + weak + uncertain,
      totalQuestions: rows.reduce((sum, lesson) => sum + lesson.question_count, 0),
      averageMastery: scoreCount ? Math.round(scoreTotal / scoreCount) : null,
    };
  }, [lessons, masteryByLesson]);

  if (!lessons && !error) return <LoadingCard label={isFa ? "بارگذاری نقشه درس‌ها" : "Loading lesson map"} />;
  if (!lessons) {
    return (
      <StatusPanel
        title={error?.message ?? (isFa ? "درس‌ها در دسترس نیستند" : "Lessons unavailable")}
        tone="danger"
        requestId={error?.requestId}
        action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
      >
        <p>{error?.code}</p>
      </StatusPanel>
    );
  }
  if (!lessons.length) {
    return (
      <StatusPanel title={isFa ? "درسی یافت نشد" : "No lessons found"}>
        <p>{isFa ? "پس از انتشار محتوای فعال، درس‌ها اینجا نمایش داده می‌شوند." : "Active content will appear here after publication."}</p>
      </StatusPanel>
    );
  }

  const pageCount = Math.max(1, Math.ceil(filteredLessons.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleLessons = filteredLessons.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const from = filteredLessons.length ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(safePage * PAGE_SIZE, filteredLessons.length);
  const activeCategory = categories.find((category) => category.id === categoryId);
  const activeFilterLabels = [
    query.trim() ? `“${query.trim()}”` : null,
    activeCategory?.label ?? null,
    bandFilter !== ALL ? statusMeta(bandFilter, isFa).label : null,
  ].filter((value): value is string => Boolean(value));
  const average = summary.averageMastery ?? 0;
  const ringStyle = {"--mastery-angle": `${average * 3.6}deg`} as CSSProperties;

  function resetFilters() {
    setQuery("");
    setCategoryId(ALL);
    setBandFilter(ALL);
    setPage(1);
  }

  return (
    <div className={styles.lessonsPage}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
        <ParisArtwork />
      </header>

      <section className={styles.heroStats} aria-label={isFa ? "خلاصه درس‌ها" : "Lesson summary"}>
        <div className={styles.statCard}><span className={styles.statIcon} aria-hidden="true">▦</span><span><strong>{numberFormatter.format(summary.total)}</strong><small>{copy.totalLessons}</small></span></div>
        <div className={styles.statCard}><span className={`${styles.statIcon} ${styles.statSuccess}`} aria-hidden="true">✓</span><span><strong>{numberFormatter.format(summary.strong)}</strong><small>{copy.mastered}</small></span></div>
        <div className={styles.statCard}><span className={`${styles.statIcon} ${styles.statPrimary}`} aria-hidden="true">↗</span><span><strong>{numberFormatter.format(summary.inProgress)}</strong><small>{copy.learning}</small></span></div>
        <div className={styles.statCard}><span className={`${styles.statIcon} ${styles.statGold}`} aria-hidden="true">?</span><span><strong>{numberFormatter.format(summary.totalQuestions)}</strong><small>{copy.availableQuestions}</small></span></div>
      </section>

      {masteryUnavailable ? (
        <StatusPanel title={copy.masteryUnavailable} tone="warning">
          <p>{copy.masteryUnavailableHint}</p>
        </StatusPanel>
      ) : null}

      <section className={styles.controls} aria-label={isFa ? "جستجو و فیلتر درس‌ها" : "Search and filter lessons"}>
        <label className={styles.searchField}>
          <span className={styles.visuallyHidden}>{copy.searchLabel}</span>
          <span aria-hidden="true" className={styles.searchIcon}>⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder={copy.searchPlaceholder}
          />
        </label>
        <label className={styles.selectField}>
          <span>{copy.category}</span>
          <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
            <option value={ALL}>{copy.allCategories}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.label} ({numberFormatter.format(category.count)})</option>)}
          </select>
        </label>
        <label className={styles.selectField}>
          <span>{copy.status}</span>
          <select value={bandFilter} onChange={(event) => { setBandFilter(event.target.value as typeof ALL | MasteryBand); setPage(1); }} disabled={masteryUnavailable}>
            <option value={ALL}>{copy.allStatuses}</option>
            {MASTERY_BANDS.map((band) => <option key={band} value={band}>{statusMeta(band, isFa).label}</option>)}
          </select>
        </label>
        <label className={styles.selectField}>
          <span>{copy.sort}</span>
          <select value={sortKey} onChange={(event) => { setSortKey(event.target.value as SortKey); setPage(1); }}>
            <option value="lesson_asc">{copy.sortLessonAsc}</option>
            <option value="lesson_desc">{copy.sortLessonDesc}</option>
            <option value="mastery_desc" disabled={masteryUnavailable}>{copy.sortMasteryDesc}</option>
            <option value="mastery_asc" disabled={masteryUnavailable}>{copy.sortMasteryAsc}</option>
            <option value="questions_desc">{copy.sortQuestions}</option>
            <option value="tcf_desc">{copy.sortTcf}</option>
            <option value="title_asc">{copy.sortTitle}</option>
          </select>
        </label>
      </section>

      <div className={styles.workspace}>
        <aside className={`${styles.panel} ${styles.categoryPanel}`} aria-labelledby="lesson-categories-title">
          <div className={styles.panelHeading}>
            <span className={styles.panelIcon} aria-hidden="true">◇</span>
            <h2 id="lesson-categories-title">{copy.categories}</h2>
          </div>
          <div className={styles.categoryList}>
            <button type="button" className={categoryId === ALL ? styles.categoryActive : undefined} onClick={() => { setCategoryId(ALL); setPage(1); }} aria-pressed={categoryId === ALL}>
              <span>{copy.all}</span><strong>{numberFormatter.format(summary.total)}</strong>
            </button>
            {categories.map((category) => (
              <button key={category.id} type="button" className={categoryId === category.id ? styles.categoryActive : undefined} onClick={() => { setCategoryId(category.id); setPage(1); }} aria-pressed={categoryId === category.id}>
                <span>{category.label}</span><strong>{numberFormatter.format(category.count)}</strong>
              </button>
            ))}
          </div>
        </aside>

        <main className={styles.mainColumn}>
          <div className={styles.resultsHeading}>
            <div>
              <h2>{copy.title}</h2>
              <p aria-live="polite">{copy.showing} {numberFormatter.format(from)}–{numberFormatter.format(to)} {copy.of} {numberFormatter.format(filteredLessons.length)} {copy.results}</p>
            </div>
            {activeFilterLabels.length ? <button className={styles.clearButton} type="button" onClick={resetFilters}>{copy.clear}</button> : null}
          </div>

          {visibleLessons.length ? (
            <div className={styles.lessonGrid}>
              {visibleLessons.map((lesson) => {
                const mastery = masteryByLesson.get(lesson.id);
                const band = getBand(mastery);
                const status = statusMeta(band, isFa);
                const score = boundedScore(mastery);
                const categoryLabel = (isFa ? lesson.category_title_fa : lesson.category_title_fr) ?? lesson.category_title_fr ?? lesson.category_title_fa;
                const subcategoryLabel = (isFa ? lesson.subcategory_title_fa : lesson.subcategory_title_fr) ?? lesson.subcategory_title_fr ?? lesson.subcategory_title_fa;
                const lessonNo = String(lesson.lesson_no).padStart(2, "0");
                const detailHref = `/${locale}/lessons/${lesson.id}?book=${DEFAULT_GRAMMAR_BOOK_SLUG}`;
                const practiceHref = `/${locale}/tests/new?scope=lessons&lesson=${encodeURIComponent(lesson.id)}`;
                return (
                  <article className={styles.lessonCard} key={lesson.id}>
                    <div className={styles.cardTopline}>
                      <span className={styles.lessonNumber}>L{lessonNo}</span>
                      {lesson.tcf_weight !== undefined ? <span className={styles.tcfBadge}>{copy.tcfWeight} {numberFormatter.format(lesson.tcf_weight)}%</span> : null}
                    </div>
                    <div className={styles.lessonTitleBlock}>
                      <h3 lang="fr" dir="ltr">{lesson.title_fr}</h3>
                      {subcategoryLabel ? <p>{subcategoryLabel}</p> : null}
                    </div>
                    <div className={styles.taxonomyRow}>
                      {categoryLabel ? <span>{categoryLabel}</span> : null}
                      {subcategoryLabel ? <span>{subcategoryLabel}</span> : null}
                    </div>
                    <div className={styles.masteryBlock}>
                      <div className={styles.masteryLine}>
                        <span className={`${styles.statusBadge} ${status.className}`}><span aria-hidden="true">{status.icon}</span>{status.label}</span>
                        <strong>{score === null ? "—" : `${numberFormatter.format(score)}%`}</strong>
                      </div>
                      <div
                        className={styles.masteryTrack}
                        role="progressbar"
                        aria-label={`${copy.mastery}: ${status.label}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={score ?? undefined}
                      >
                        <span style={{width: `${score ?? 0}%`}} />
                      </div>
                    </div>
                    <div className={styles.cardMetrics}>
                      <div><strong>{numberFormatter.format(lesson.question_count)}</strong><span>{copy.availableQuestions}</span></div>
                      <div><strong>{numberFormatter.format(mastery?.evidence_count ?? 0)}</strong><span>{copy.evidence}</span></div>
                    </div>
                    <div className={styles.cardActions}>
                      <Link className={styles.detailButton} href={detailHref}>{copy.details}<span aria-hidden="true">←</span></Link>
                      <Link className={styles.practiceLink} href={practiceHref}>{copy.practice}</Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span aria-hidden="true">⌕</span>
              <h3>{copy.empty}</h3>
              <p>{copy.emptyHint}</p>
              <button type="button" onClick={resetFilters}>{copy.clear}</button>
            </div>
          )}

          {pageCount > 1 ? (
            <nav className={styles.pagination} aria-label={isFa ? "صفحه‌بندی درس‌ها" : "Lesson pagination"}>
              <button type="button" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}>{copy.previous}</button>
              <div className={styles.pageNumbers}>
                {Array.from({length: pageCount}, (_, index) => index + 1).map((pageNumber) => (
                  <button key={pageNumber} type="button" className={pageNumber === safePage ? styles.currentPage : undefined} aria-current={pageNumber === safePage ? "page" : undefined} aria-label={`${copy.page} ${numberFormatter.format(pageNumber)}`} onClick={() => setPage(pageNumber)}>
                    {numberFormatter.format(pageNumber)}
                  </button>
                ))}
              </div>
              <button type="button" disabled={safePage === pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))}>{copy.next}</button>
            </nav>
          ) : null}
        </main>

        <aside className={styles.rightRail}>
          <section className={styles.panel} aria-labelledby="lesson-summary-title">
            <div className={styles.panelHeading}><span className={styles.panelIcon} aria-hidden="true">◎</span><h2 id="lesson-summary-title">{copy.summary}</h2></div>
            <div className={styles.masterySummary}>
              <div className={styles.masteryRing} style={ringStyle} aria-hidden="true"><span>{summary.averageMastery === null ? "—" : `${numberFormatter.format(summary.averageMastery)}%`}</span></div>
              <div><strong>{copy.averageMastery}</strong><small>{copy.averageHint}</small></div>
            </div>
            <div className={styles.summaryRows}>
              <div><span><i className={styles.dotStrong} />{copy.mastered}</span><strong>{numberFormatter.format(summary.strong)}</strong></div>
              <div><span><i className={styles.dotDeveloping} />{copy.developing}</span><strong>{numberFormatter.format(summary.developing + summary.uncertain)}</strong></div>
              <div><span><i className={styles.dotWeak} />{copy.weak}</span><strong>{numberFormatter.format(summary.weak)}</strong></div>
              <div><span><i className={styles.dotNone} />{copy.noEvidence}</span><strong>{numberFormatter.format(summary.noEvidence)}</strong></div>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="active-filters-title">
            <div className={styles.panelHeading}><span className={styles.panelIcon} aria-hidden="true">≡</span><h2 id="active-filters-title">{copy.filters}</h2></div>
            {activeFilterLabels.length ? (
              <div className={styles.filterTags}>{activeFilterLabels.map((label) => <span key={label}>{label}</span>)}</div>
            ) : <p className={styles.mutedCopy}>{copy.noFilters}</p>}
            {activeFilterLabels.length ? <button type="button" className={styles.clearWide} onClick={resetFilters}>{copy.clear}</button> : null}
          </section>

          <section className={`${styles.panel} ${styles.practicePanel}`} aria-labelledby="smart-practice-title">
            <span className={styles.sparkIcon} aria-hidden="true">✦</span>
            <h2 id="smart-practice-title">{copy.smartPractice}</h2>
            <p>{copy.smartPracticeHint}</p>
            <Link href={`/${locale}/tests/new`}>{copy.buildPractice}<span aria-hidden="true">←</span></Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

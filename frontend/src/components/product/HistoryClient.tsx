"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import type {CSSProperties} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import styles from "./HistoryClient.module.css";

type ActivityType = "PRACTICE" | "TEST" | "REVIEW";

type HistoryLesson = {
  id: string;
  lesson_no: number;
  title_fr: string;
};

type HistoryAttempt = {
  attempt_id: string;
  test_id: string;
  activity_type: ActivityType;
  mode: string;
  title: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  question_count: number;
  answered_count: number;
  correct_count: number;
  score_raw: number | null;
  score_pct: number | null;
  accuracy_pct: number | null;
  lessons: HistoryLesson[];
};

type HistoryData = {
  items: HistoryAttempt[];
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
    has_previous: boolean;
    has_next: boolean;
  };
  summary: {
    total_sessions: number;
    average_score_pct: number | null;
    average_duration_seconds: number | null;
    best_score_pct: number | null;
    today_duration_seconds: number;
    daily_goal_minutes: number;
  };
  trend: Array<{date: string; score_pct: number}>;
  available_lessons: HistoryLesson[];
  filters: {
    mode: string;
    lesson_id: string | null;
    score: string;
    date_from: string | null;
    date_to: string | null;
  };
  as_of: string;
  runtime_version: string;
};

type HistoryEnvelope = {
  data: HistoryData;
  meta: {request_id: string; api_version: string};
};

type IconName =
  | "home" | "book" | "target" | "review" | "progress" | "history"
  | "user" | "settings" | "calendar" | "filter" | "eye" | "check"
  | "clipboard" | "clock" | "chart" | "trophy" | "questions" | "cap"
  | "sliders" | "chevronLeft" | "chevronRight" | "reset" | "empty";

function Icon({name, size = 20}: {name: IconName; size?: number}) {
  const common = {width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true as const};
  switch (name) {
    case "home": return <svg {...common}><path d="m3 11 9-7 9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>;
    case "book": return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>;
    case "target": return <svg {...common}><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7"/><path d="m12 12 6-6M16 6h2v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "review": return <svg {...common}><path d="M20 11a8 8 0 1 0-2.3 5.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M20 5v6h-6M9.5 10.2h5M9.5 13.8h3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "progress": return <svg {...common}><path d="M4 18V9m5 9V5m5 13v-7m5 7V3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="m4 12 5-4 5 2 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "history": return <svg {...common}><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M4 4v4.6h4.6M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "user": return <svg {...common}><circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7"/><path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="m19 13.5 1.2 1-.9 2-1.6-.2a7 7 0 0 1-1.4 1.4l.2 1.6-2 .9-1-1.2a7 7 0 0 1-2 0l-1 1.2-2-.9.2-1.6a7 7 0 0 1-1.4-1.4l-1.6.2-.9-2 1.2-1a7 7 0 0 1 0-2l-1.2-1 .9-2 1.6.2a7 7 0 0 1 1.4-1.4l-.2-1.6 2-.9 1 1.2a7 7 0 0 1 2 0l1-1.2 2 .9-.2 1.6a7 7 0 0 1 1.4 1.4l1.6-.2.9 2-1.2 1a7 7 0 0 1 0 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>;
    case "calendar": return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M7 3v4M17 3v4M3 10h18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
    case "filter": return <svg {...common}><path d="M4 5h16l-6.2 7.1v5.2l-3.6 1.7v-6.9L4 5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>;
    case "eye": return <svg {...common}><path d="M2.7 12s3.2-5.5 9.3-5.5 9.3 5.5 9.3 5.5-3.2 5.5-9.3 5.5S2.7 12 2.7 12Z" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7"/></svg>;
    case "check": return <svg {...common}><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="m8.2 12.1 2.3 2.3 5.2-5.2" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "clipboard": return <svg {...common}><rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M9 4.5V3h6v1.5M9 9h6M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
    case "clock": return <svg {...common}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7"/><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
    case "chart": return <svg {...common}><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "trophy": return <svg {...common}><path d="M8 4h8v4c0 3-1.8 5-4 5s-4-2-4-5V4Z" stroke="currentColor" strokeWidth="1.7"/><path d="M8 6H4v2c0 2 1.5 3 4 3M16 6h4v2c0 2-1.5 3-4 3M12 13v4M8.5 20h7M10 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
    case "questions": return <svg {...common}><path d="M6 4h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 2v-4a2 2 0 0 1-1-1V7a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M9.5 9a2.6 2.6 0 1 1 4 2.2c-1 .7-1.5 1.1-1.5 2M12 16h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
    case "cap": return <svg {...common}><path d="m2.5 9 9.5-5 9.5 5-9.5 5-9.5-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M6 11.2v4.5c3.8 2.5 8.2 2.5 12 0v-4.5M21.5 9v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
    case "sliders": return <svg {...common}><path d="M4 7h8M16 7h4M4 17h4M12 17h8M12 4v6M8 14v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
    case "chevronLeft": return <svg {...common}><path d="m14.5 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "chevronRight": return <svg {...common}><path d="m9.5 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "reset": return <svg {...common}><path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "empty": return <svg {...common}><path d="M5 5h14v14H5z" stroke="currentColor" strokeWidth="1.5"/><path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
  }
}

const copy = {
  fa: {
    title: "تاریخچه فعالیت‌ها",
    subtitle: "سوابق کامل تمرین‌ها، آزمون‌ها و بازبینی‌های شما",
    nav: ["نمای کلی", "درس‌ها", "تمرین", "بازبینی", "پیشرفت", "تاریخچه", "پروفایل", "تنظیمات"],
    dailyGoal: "هدف روزانه",
    minute: "دقیقه",
    of: "از",
    allModes: "همه حالت‌ها",
    adaptive: "تمرین هوشمند",
    tcf: "شبیه‌سازی TCF",
    custom: "تمرین سفارشی",
    singleLesson: "یک درس",
    multiLesson: "چند درس",
    categoryMode: "دسته‌بندی",
    mistakesMode: "مرور اشتباهات",
    reviewMode: "مرور",
    allLessons: "همه درس‌ها",
    allResults: "همه نتایج",
    strong: "۸۰٪ و بالاتر",
    developing: "۶۰٪ تا ۷۹٪",
    needsWork: "کمتر از ۶۰٪",
    clear: "پاک کردن فیلترها",
    activityType: "نوع فعالیت",
    mode: "حالت",
    lesson: "درس / موضوع",
    questions: "تعداد سؤال",
    result: "نتیجه",
    score: "امتیاز",
    accuracy: "دقت",
    duration: "مدت زمان",
    date: "تاریخ",
    actions: "عملیات",
    practice: "تمرین",
    test: "آزمون",
    review: "بازبینی",
    completed: "پایان‌یافته",
    view: "مشاهده",
    mixedLessons: "چند درس",
    performance: "خلاصه عملکرد",
    sessions: "کل جلسات",
    avgScore: "میانگین امتیاز",
    avgDuration: "میانگین مدت زمان",
    bestScore: "بهترین امتیاز",
    trend: "نمودار روند امتیاز",
    fullReport: "مشاهده گزارش کامل",
    show: "نمایش",
    perPage: "در هر صفحه",
    previous: "قبلی",
    next: "بعدی",
    emptyTitle: "هنوز سابقه‌ای برای این فیلترها وجود ندارد",
    emptyText: "فیلترها را پاک کنید یا یک تمرین جدید انجام دهید.",
    startPractice: "شروع تمرین",
    loadError: "تاریخچه فعالیت‌ها بارگذاری نشد.",
    retry: "تلاش دوباره",
    loading: "در حال بارگذاری تاریخچه…",
    dateFrom: "از تاریخ",
    dateTo: "تا تاریخ",
  },
  en: {
    title: "Activity history",
    subtitle: "Your complete practice, test, and review history",
    nav: ["Overview", "Lessons", "Practice", "Review", "Progress", "History", "Profile", "Settings"],
    dailyGoal: "Daily goal",
    minute: "min",
    of: "of",
    allModes: "All modes",
    adaptive: "Adaptive practice",
    tcf: "TCF simulation",
    custom: "Custom practice",
    singleLesson: "Single lesson",
    multiLesson: "Multiple lessons",
    categoryMode: "Category",
    mistakesMode: "Mistakes",
    reviewMode: "Review",
    allLessons: "All lessons",
    allResults: "All results",
    strong: "80% and above",
    developing: "60% to 79%",
    needsWork: "Below 60%",
    clear: "Clear filters",
    activityType: "Activity",
    mode: "Mode",
    lesson: "Lesson / topic",
    questions: "Questions",
    result: "Result",
    score: "Score",
    accuracy: "Accuracy",
    duration: "Duration",
    date: "Date",
    actions: "Actions",
    practice: "Practice",
    test: "Test",
    review: "Review",
    completed: "Completed",
    view: "View",
    mixedLessons: "Multiple lessons",
    performance: "Performance summary",
    sessions: "Total sessions",
    avgScore: "Average score",
    avgDuration: "Average duration",
    bestScore: "Best score",
    trend: "Score trend",
    fullReport: "View full report",
    show: "Show",
    perPage: "per page",
    previous: "Previous",
    next: "Next",
    emptyTitle: "No activity matches these filters yet",
    emptyText: "Clear the filters or complete a new practice session.",
    startPractice: "Start practice",
    loadError: "Activity history could not be loaded.",
    retry: "Try again",
    loading: "Loading history…",
    dateFrom: "From",
    dateTo: "To",
  },
} as const;

const sideRoutes = ["dashboard", "lessons", "tests/new", "review", "progress", "history", "profile", "settings"] as const;
const sideIcons: IconName[] = ["home", "book", "target", "review", "progress", "history", "user", "settings"];

function modeLabel(mode: string, locale: Locale) {
  const c = copy[locale];
  switch (mode.toUpperCase()) {
    case "TCF": return c.tcf;
    case "CUSTOM": return c.custom;
    case "SINGLE_LESSON": return c.singleLesson;
    case "MULTI_LESSON": return c.multiLesson;
    case "CATEGORY": return c.categoryMode;
    case "MISTAKES": return c.mistakesMode;
    case "REVIEW": case "SPACED": return c.reviewMode;
    case "ADAPTIVE": return c.adaptive;
    default: return mode.replaceAll("_", " ");
  }
}

function formatPct(value: number | null, locale: Locale) {
  if (value === null || Number.isNaN(value)) return "—";
  const rounded = Math.round(value);
  return `${new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(rounded)}%`;
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(value);
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.max(0, seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDateTime(value: string | null, locale: Locale) {
  if (!value) return {date: "—", time: ""};
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return {date: "—", time: ""};
  const dateFormatter = locale === "fa"
    ? new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {year: "numeric", month: "2-digit", day: "2-digit"})
    : new Intl.DateTimeFormat("en-CA", {year: "numeric", month: "2-digit", day: "2-digit"});
  const timeFormatter = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-nu-latn" : "en-GB", {hour: "2-digit", minute: "2-digit", hour12: false});
  return {date: dateFormatter.format(d), time: timeFormatter.format(d)};
}

function scoreTone(score: number | null) {
  if (score === null) return "neutral";
  if (score >= 80) return "good";
  if (score >= 60) return "medium";
  return "low";
}

function lessonLabel(attempt: HistoryAttempt, locale: Locale) {
  const firstLesson = attempt.lessons[0];
  if (attempt.lessons.length === 1 && firstLesson) return firstLesson.title_fr;
  if (attempt.lessons.length > 1) return `${copy[locale].mixedLessons} (${formatNumber(attempt.lessons.length, locale)})`;
  return attempt.title || "—";
}

function scoreChartPoints(trend: HistoryData["trend"]) {
  const width = 260;
  const height = 110;
  const padX = 10;
  const padY = 12;
  if (!trend.length) return {path: "", points: [] as Array<{x: number; y: number}>, width, height};
  const step = trend.length <= 1 ? 0 : (width - padX * 2) / (trend.length - 1);
  const points = trend.map((entry, index) => ({
    x: padX + step * index,
    y: padY + (100 - Math.max(0, Math.min(100, entry.score_pct))) * (height - padY * 2) / 100,
  }));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return {path, points, width, height};
}

function pageNumbers(current: number, total: number) {
  if (total <= 7) return Array.from({length: total}, (_, index) => index + 1);
  const values: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) values.push("ellipsis");
  for (let value = start; value <= end; value += 1) values.push(value);
  if (end < total - 1) values.push("ellipsis");
  values.push(total);
  return values;
}

export function HistoryClient({locale}: {locale: Locale}) {
  const c = copy[locale];
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [mode, setMode] = useState("ALL");
  const [lessonId, setLessonId] = useState("ALL");
  const [score, setScore] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const dir = locale === "fa" ? "rtl" : "ltr";

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      mode,
      score,
    });
    if (lessonId !== "ALL") params.set("lesson_id", lessonId);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    try {
      const response = await apiRequest<HistoryEnvelope>(`/api/backend/history?${params.toString()}`);
      if (response) setData(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "UNKNOWN", message: c.loadError}));
    } finally {
      setLoading(false);
    }
  }, [c.loadError, dateFrom, dateTo, lessonId, mode, page, pageSize, score]);

  // Data fetching is intentionally initiated on mount/filter changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchHistory(); }, [fetchHistory]);

  const clearFilters = () => {
    setMode("ALL");
    setLessonId("ALL");
    setScore("ALL");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const filterActive = mode !== "ALL" || lessonId !== "ALL" || score !== "ALL" || Boolean(dateFrom) || Boolean(dateTo);
  const dailyGoalMinutes = data?.summary.daily_goal_minutes ?? 20;
  const todayMinutes = Math.min(dailyGoalMinutes, Math.floor((data?.summary.today_duration_seconds ?? 0) / 60));
  const dailyPercent = dailyGoalMinutes > 0 ? Math.min(100, Math.round(todayMinutes / dailyGoalMinutes * 100)) : 0;
  const chart = useMemo(() => scoreChartPoints(data?.trend ?? []), [data?.trend]);
  const latestTrend = data?.trend.at(-1)?.score_pct ?? data?.summary.average_score_pct ?? null;

  return (
    <div className={styles.historyPage} dir={dir}>
      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label={locale === "fa" ? "ناوبری حساب" : "Account navigation"}>
          <nav className={styles.sideNav}>
            {sideRoutes.map((route, index) => {
              const icon = sideIcons[index] ?? "home";
              return (
                <Link
                  href={`/${locale}/${route}`}
                  key={route}
                  className={`${styles.sideLink} ${route === "history" ? styles.sideLinkActive : ""}`}
                  aria-current={route === "history" ? "page" : undefined}
                >
                  <Icon name={icon} size={19} />
                  <span>{c.nav[index]}</span>
                </Link>
              );
            })}
          </nav>
          <div className={styles.goalCard}>
            <h2>{c.dailyGoal}</h2>
            <div className={styles.goalRow}>
              <div className={styles.goalRing} style={{"--goal-angle": `${dailyPercent * 3.6}deg`} as CSSProperties}>
                <strong>{formatPct(dailyPercent, locale)}</strong>
              </div>
              <p><Icon name="target" size={16}/><span>{formatNumber(todayMinutes, locale)} {c.of} {formatNumber(dailyGoalMinutes, locale)} {c.minute}</span></p>
            </div>
            <div className={styles.goalTrack}><span style={{width: `${dailyPercent}%`}} /></div>
          </div>
        </aside>

        <main className={styles.mainColumn}>
          <header className={styles.pageHeader}>
            <h1>{c.title}</h1>
            <p>{c.subtitle}</p>
          </header>

          <section className={styles.filters} aria-label={locale === "fa" ? "فیلترهای تاریخچه" : "History filters"}>
            <div className={styles.dateControl}>
              <Icon name="calendar" size={19}/>
              <label><span>{c.dateFrom}</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => {setDateFrom(event.target.value); setPage(1);}} /></label>
              <i>—</i>
              <label><span>{c.dateTo}</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => {setDateTo(event.target.value); setPage(1);}} /></label>
            </div>
            <select aria-label={c.allModes} value={mode} onChange={(event) => {setMode(event.target.value); setPage(1);}}>
              <option value="ALL">{c.allModes}</option>
              <option value="ADAPTIVE">{c.adaptive}</option>
              <option value="TCF">{c.tcf}</option>
              <option value="CUSTOM">{c.custom}</option>
              <option value="SINGLE_LESSON">{c.singleLesson}</option>
              <option value="MULTI_LESSON">{c.multiLesson}</option>
              <option value="CATEGORY">{c.categoryMode}</option>
              <option value="REVIEW">{c.reviewMode}</option>
              <option value="MISTAKES">{c.mistakesMode}</option>
            </select>
            <select aria-label={c.allLessons} value={lessonId} onChange={(event) => {setLessonId(event.target.value); setPage(1);}}>
              <option value="ALL">{c.allLessons}</option>
              {(data?.available_lessons ?? []).map((lesson) => <option key={lesson.id} value={lesson.id}>{locale === "fa" ? `درس ${lesson.lesson_no} — ${lesson.title_fr}` : `Lesson ${lesson.lesson_no} — ${lesson.title_fr}`}</option>)}
            </select>
            <select aria-label={c.allResults} value={score} onChange={(event) => {setScore(event.target.value); setPage(1);}}>
              <option value="ALL">{c.allResults}</option>
              <option value="STRONG">{c.strong}</option>
              <option value="DEVELOPING">{c.developing}</option>
              <option value="NEEDS_WORK">{c.needsWork}</option>
            </select>
            <button className={`${styles.clearButton} ${filterActive ? styles.clearActive : ""}`} type="button" onClick={clearFilters} disabled={!filterActive}>
              <Icon name="filter" size={18}/><span>{c.clear}</span>
            </button>
          </section>

          <section className={styles.tableCard} aria-busy={loading}>
            {loading && !data ? (
              <div className={styles.loadingState}><span className={styles.spinner}/><p>{c.loading}</p></div>
            ) : error ? (
              <div className={styles.errorState} role="alert">
                <Icon name="empty" size={42}/><h2>{c.loadError}</h2><p>{error.message}</p>
                <button type="button" onClick={() => void fetchHistory()}>{c.retry}</button>
                {error.requestId && <code>{error.requestId}</code>}
              </div>
            ) : data && data.items.length === 0 ? (
              <div className={styles.emptyState}>
                <Icon name="empty" size={48}/><h2>{c.emptyTitle}</h2><p>{c.emptyText}</p>
                {filterActive ? <button type="button" onClick={clearFilters}>{c.clear}</button> : <Link href={`/${locale}/tests/new`}>{c.startPractice}</Link>}
              </div>
            ) : (
              <>
                <div className={styles.tableScroller}>
                  <table>
                    <thead><tr>
                      <th>{c.activityType}</th><th>{c.mode}</th><th>{c.lesson}</th><th>{c.questions}</th><th>{c.result}</th><th>{c.score}</th><th>{c.duration}</th><th>{c.date}</th><th>{c.actions}</th>
                    </tr></thead>
                    <tbody>
                      {data?.items.map((attempt) => {
                        const timestamp = formatDateTime(attempt.completed_at ?? attempt.started_at, locale);
                        const tone = scoreTone(attempt.score_pct);
                        const firstLesson = attempt.lessons[0];
                        return <tr key={attempt.attempt_id}>
                          <td data-label={c.activityType}>
                            <span className={`${styles.activityType} ${styles[`type${attempt.activity_type}`]}`}>
                              <Icon name={attempt.activity_type === "TEST" ? "clipboard" : attempt.activity_type === "REVIEW" ? "review" : "target"} size={20}/>
                              <b>{attempt.activity_type === "TEST" ? c.test : attempt.activity_type === "REVIEW" ? c.review : c.practice}</b>
                            </span>
                          </td>
                          <td data-label={c.mode}><span className={`${styles.modeBadge} ${styles[`mode${attempt.mode.toUpperCase()}`] ?? ""}`}><Icon name={attempt.mode.toUpperCase() === "TCF" ? "cap" : attempt.mode.toUpperCase() === "CUSTOM" ? "sliders" : "target"} size={16}/>{modeLabel(attempt.mode, locale)}</span></td>
                          <td data-label={c.lesson} className={styles.lessonCell}><strong dir="ltr">{lessonLabel(attempt, locale)}</strong>{attempt.lessons.length === 1 && firstLesson ? <small>{locale === "fa" ? `درس ${formatNumber(firstLesson.lesson_no, locale)}` : `Lesson ${firstLesson.lesson_no}`}</small> : null}</td>
                          <td data-label={c.questions}><span className={styles.tabular}>{formatNumber(attempt.question_count, locale)}</span></td>
                          <td data-label={c.result}><span className={styles.completed}><Icon name="check" size={16}/>{c.completed}</span></td>
                          <td data-label={c.score}><div className={styles.scoreCell}><strong>{formatPct(attempt.score_pct, locale)}</strong><span className={styles[`score${tone}`]}>{formatNumber(attempt.correct_count, locale)}/{formatNumber(attempt.question_count, locale)}</span><small>{c.accuracy}: {formatPct(attempt.accuracy_pct, locale)}</small></div></td>
                          <td data-label={c.duration}><span className={styles.tabular}>{formatDuration(attempt.duration_seconds)}</span></td>
                          <td data-label={c.date}><div className={styles.dateCell}><span>{timestamp.date}</span><small>{timestamp.time}</small></div></td>
                          <td data-label={c.actions}><Link className={styles.viewButton} href={`/${locale}/attempts/${attempt.attempt_id}/result`}><Icon name="eye" size={16}/>{c.view}</Link></td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                <footer className={styles.paginationBar}>
                  <div className={styles.pageSize}><span>{c.show}</span><select value={pageSize} onChange={(event) => {setPageSize(Number(event.target.value)); setPage(1);}} aria-label={c.perPage}><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select><span>{c.perPage}</span></div>
                  <nav className={styles.pagination} aria-label={locale === "fa" ? "صفحه‌بندی" : "Pagination"}>
                    <button type="button" disabled={!data?.pagination.has_previous} onClick={() => setPage((value) => Math.max(1, value - 1))}><Icon name={dir === "rtl" ? "chevronRight" : "chevronLeft"} size={17}/><span>{c.previous}</span></button>
                    {pageNumbers(data?.pagination.page ?? 1, data?.pagination.total_pages ?? 1).map((value, index) => value === "ellipsis" ? <span className={styles.ellipsis} key={`e-${index}`}>…</span> : <button className={value === data?.pagination.page ? styles.pageActive : ""} type="button" key={value} onClick={() => setPage(value)} aria-current={value === data?.pagination.page ? "page" : undefined}>{formatNumber(value, locale)}</button>)}
                    <button type="button" disabled={!data?.pagination.has_next} onClick={() => setPage((value) => value + 1)}><span>{c.next}</span><Icon name={dir === "rtl" ? "chevronLeft" : "chevronRight"} size={17}/></button>
                  </nav>
                </footer>
              </>
            )}
            {loading && data && <div className={styles.refreshOverlay} aria-hidden="true"><span className={styles.spinner}/></div>}
          </section>
        </main>

        <aside className={styles.insights}>
          <section className={styles.summaryCard}>
            <h2>{c.performance}</h2>
            <div className={styles.metricGrid}>
              <div><span className={`${styles.metricIcon} ${styles.blue}`}><Icon name="questions"/></span><p><strong>{formatNumber(data?.summary.total_sessions ?? 0, locale)}</strong><small>{c.sessions}</small></p></div>
              <div><span className={`${styles.metricIcon} ${styles.green}`}><Icon name="target"/></span><p><strong>{formatPct(data?.summary.average_score_pct ?? null, locale)}</strong><small>{c.avgScore}</small></p></div>
              <div><span className={`${styles.metricIcon} ${styles.orange}`}><Icon name="clock"/></span><p><strong>{formatDuration(data?.summary.average_duration_seconds ?? null)}</strong><small>{c.avgDuration}</small></p></div>
              <div><span className={`${styles.metricIcon} ${styles.purple}`}><Icon name="trophy"/></span><p><strong>{formatPct(data?.summary.best_score_pct ?? null, locale)}</strong><small>{c.bestScore}</small></p></div>
            </div>
          </section>

          <section className={styles.trendCard}>
            <h2>{c.trend}</h2>
            <div className={styles.chartWrap}>
              <div className={styles.yLabels}><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
              <svg className={styles.chartSvg} viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={c.trend}>
                {[0, 25, 50, 75, 100].map((value) => <line key={value} x1="0" x2={chart.width} y1={12 + (100 - value) * .86} y2={12 + (100 - value) * .86} className={styles.gridLine}/>) }
                {chart.path && <path d={chart.path} className={styles.chartLine}/>} 
                {chart.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3.6" className={styles.chartPoint}/>)}
              </svg>
              {latestTrend !== null && <span className={styles.latestScore}>{formatPct(latestTrend, locale)}</span>}
            </div>
            <div className={styles.xLabels}>{(data?.trend ?? []).map((entry) => <span key={entry.date}>{entry.date.slice(5).replace("-", "/")}</span>)}</div>
            <Link className={styles.reportButton} href={`/${locale}/progress`}><Icon name="chart" size={17}/>{c.fullReport}</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

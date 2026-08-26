"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {DashboardEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import styles from "./ProgressClient.module.css";

type RangeKey = "7d" | "30d" | "90d" | "all";
type LooseRecord = Record<string, unknown>;
type SeriesPoint = {label: string; value: number; date: Date | null};
type DifficultyPoint = {label: string; value: number};
type CachedProgress = {savedAt: string; dashboard: DashboardEnvelope};

const RANGE_OPTIONS: Array<{key: RangeKey; en: string; fa: string}> = [
  {key: "7d", en: "7 days", fa: "۷ روز"},
  {key: "30d", en: "30 days", fa: "۳۰ روز"},
  {key: "90d", en: "90 days", fa: "۹۰ روز"},
  {key: "all", en: "All time", fa: "همه"},
];

export function ProgressClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [range, setRange] = useState<RangeKey>("30d");
  const [data, setData] = useState<CachedProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dashboard = await apiRequest<DashboardEnvelope>("/api/backend/dashboard");
      if (!dashboard) throw new ApiError({status: 502, code: "EMPTY_PROGRESS", message: "Progress data was empty."});
      const snapshot = {savedAt: new Date().toISOString(), dashboard};
      sessionStorage.setItem("gmp-progress-safe-snapshot", JSON.stringify(snapshot));
      setData(snapshot);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Progress loading failed."}));
      const cached = sessionStorage.getItem("gmp-progress-safe-snapshot");
      if (cached) {
        try { setData(JSON.parse(cached) as CachedProgress); }
        catch { sessionStorage.removeItem("gmp-progress-safe-snapshot"); }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const derived = useMemo(() => {
    if (!data) return null;
    const dashboard = data.dashboard.data;
    const evidence = dashboard.mastery.filter((item) => item.confidence > 0 && item.coverage_ratio > 0);
    const categories = evidence.filter((item) => item.scope_type === "CATEGORY");
    const topicMastery = (categories.length ? categories : evidence).slice(0, 6);
    const overall = evidence.length
      ? Math.round(evidence.reduce((sum, item) => sum + item.mastery_score_pct, 0) / evidence.length)
      : null;
    const coverage = evidence.length
      ? Math.round(evidence.reduce((sum, item) => sum + normalizeRatio(item.coverage_ratio), 0) / evidence.length)
      : null;

    const dashboardRecord = asRecord(dashboard);
    const activity = asRecord(dashboard.activity);
    const trend = asRecord(dashboard.trend);
    const accuracy = readPercent(trend, ["recent_accuracy", "accuracy_pct", "accuracy", "current_accuracy"])
      ?? readPercent(activity, ["accuracy_pct", "accuracy", "recent_accuracy"]);

    const studySeries = filterSeries(extractSeries(dashboard.trend, ["minutes", "minutes_practiced", "study_minutes", "time_spent_minutes", "value"]), range);
    const accuracySeries = filterSeries(extractSeries(dashboard.trend, ["accuracy_pct", "accuracy", "correct_pct", "score_pct"]), range);
    const difficulty = extractDifficulty([dashboardRecord, activity, trend]);

    const improved = evidence
      .flatMap((item) => {
        const delta = readNumber(asRecord(item), ["delta_pct", "change_pct", "improvement_pct", "mastery_delta_pct"]);
        return delta !== null && delta > 0 ? [{item, delta}] : [];
      })
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 2);

    const needsAttention = [...(categories.length ? categories : evidence)]
      .sort((a, b) => a.mastery_score_pct - b.mastery_score_pct)
      .slice(0, 2);

    const lessonsCompleted = readNumber(activity, ["lessons_completed", "completed_lessons", "lesson_completions"]);
    const exercisesCompleted = readNumber(activity, ["exercises_completed", "completed_exercises", "attempts_completed", "completed_attempts"]);
    const practicedMinutesDirect = readNumber(activity, ["minutes_practiced", "practice_minutes", "time_spent_minutes", "total_minutes"]);
    const seconds = readNumber(activity, ["total_time_spent_seconds", "time_spent_seconds"]);
    const practicedMinutes = practicedMinutesDirect ?? (seconds === null ? null : Math.round(seconds / 60));
    const targetMinutes = readNumber(activity, ["daily_study_target_minutes", "study_target_minutes", "target_minutes", "daily_minutes_goal"]);

    return {
      topicMastery,
      overall,
      coverage,
      accuracy,
      studySeries,
      accuracySeries,
      difficulty,
      improved,
      needsAttention,
      lessonsCompleted,
      exercisesCompleted,
      practicedMinutes,
      targetMinutes,
    };
  }, [data, range]);

  if (loading && !data) return <LoadingCard label={isFa ? "بارگذاری پیشرفت" : "Loading progress"} />;
  if (!data || !derived) {
    return (
      <StatusPanel
        title={error?.status === 401 ? (isFa ? "ابتدا وارد شوید" : "Please log in") : (error?.message ?? (isFa ? "پیشرفت در دسترس نیست" : "Progress unavailable"))}
        tone="danger"
        requestId={error?.requestId}
        action={error?.status === 401
          ? {label: isFa ? "ورود" : "Log in", href: `/${locale}/login`}
          : {label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
      >
        <p>{error?.code}</p>
      </StatusPanel>
    );
  }

  const deltaNote = isFa ? "بر پایه snapshot فعلی" : "From the current persisted snapshot";

  return (
    <div className={styles.page}>
      {error ? (
        <StatusPanel
          title={isFa ? "نمای ذخیره‌شده نمایش داده می‌شود" : "Showing the last safe snapshot"}
          tone="warning"
          requestId={error.requestId}
          action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
        >
          <p>{new Date(data.savedAt).toLocaleString(isFa ? "fa-IR" : "en-CA")}</p>
        </StatusPanel>
      ) : null}

      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{isFa ? "روند یادگیری" : "Learning progress"}</p>
          <h1>{isFa ? "پیشرفت" : "Progress"}</h1>
          <p>{isFa ? "رشد، تسلط و الگوی تمرین خود را بر اساس داده‌های واقعی دنبال کنید." : "Track your growth, mastery, and study pattern from persisted learning evidence."}</p>
        </div>
        <div className={styles.rangeGroup} aria-label={isFa ? "بازه زمانی" : "Time range"}>
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={range === option.key ? styles.rangeActive : ""}
              aria-pressed={range === option.key}
              onClick={() => setRange(option.key)}
            >
              {isFa ? option.fa : option.en}
            </button>
          ))}
        </div>
      </header>

      <section className={styles.kpiGrid} aria-label={isFa ? "شاخص‌های اصلی پیشرفت" : "Progress key metrics"}>
        <MetricCard icon="◎" label={isFa ? "تسلط کلی" : "Overall Mastery"} value={derived.overall} note={deltaNote} ring />
        <MetricCard icon="✓" label={isFa ? "دقت" : "Accuracy"} value={derived.accuracy} note={deltaNote} />
        <MetricCard icon="◫" label={isFa ? "پوشش دوره" : "Course Coverage"} value={derived.coverage} note={isFa ? "میانگین coverage حوزه‌های دارای شواهد" : "Average coverage of evidence-bearing scopes"} />
        <article className={`${styles.card} ${styles.levelCard}`}>
          <div className={styles.metricIcon} aria-hidden="true">↗</div>
          <div className={styles.metricBody}>
            <span>{isFa ? "پیشرفت سطح" : "Level Progress"}</span>
            <strong dir="ltr">B1 <b>→</b> B2</strong>
            <div className={styles.levelProgress}>
              <span style={{inlineSize: `${derived.overall ?? 0}%`}} />
            </div>
            <small>{derived.overall === null ? "—" : `${derived.overall}%`}</small>
          </div>
        </article>
      </section>

      <div className={styles.primaryGrid}>
        <section id="mastery-by-topic" className={`${styles.card} ${styles.topicCard}`} aria-labelledby="mastery-topic-title">
          <SectionHeading title={isFa ? "تسلط بر اساس موضوع" : "Mastery by Topic"} subtitle={isFa ? "حوزه‌های دارای شواهد واقعی" : "Evidence-backed grammar scopes"} />
          {derived.topicMastery.length ? (
            <div className={styles.masteryList}>
              {derived.topicMastery.map((item) => (
                <div className={styles.masteryRow} key={`${item.scope_type}:${item.scope_id}`}>
                  <div><span>{item.scope_title || item.scope_id}</span><strong>{Math.round(item.mastery_score_pct)}%</strong></div>
                  <progress max={100} value={Math.round(item.mastery_score_pct)} aria-label={`${item.scope_title || item.scope_id}: ${Math.round(item.mastery_score_pct)}%`} />
                </div>
              ))}
            </div>
          ) : <EmptyState>{isFa ? "هنوز داده کافی برای نقشه تسلط وجود ندارد." : "No mastery evidence is available yet."}</EmptyState>}
          <a className={styles.textButton} href="#mastery-by-topic">{isFa ? "مشاهده نقشه تسلط" : "View mastery map"}</a>
        </section>

        <section className={styles.card} aria-labelledby="study-progress-title">
          <SectionHeading title={isFa ? "پیشرفت مطالعه" : "Study Progress"} subtitle={rangeLabel(range, isFa)} />
          {derived.studySeries.length ? (
            <BarChart points={derived.studySeries} target={derived.targetMinutes} isFa={isFa} />
          ) : <EmptyState>{isFa ? "snapshot فعلی سری زمانی دقیقه‌های مطالعه را ارائه نمی‌کند." : "The current snapshot does not expose a study-minutes time series."}</EmptyState>}
        </section>
      </div>

      <div className={styles.secondaryGrid}>
        <section className={styles.card} aria-labelledby="accuracy-trend-title">
          <SectionHeading title={isFa ? "روند دقت" : "Accuracy Trend"} subtitle={rangeLabel(range, isFa)} />
          {derived.accuracySeries.length >= 2
            ? <LineChart points={derived.accuracySeries} />
            : <EmptyState>{isFa ? "برای نمایش روند دقت حداقل دو snapshot زمانی لازم است." : "At least two persisted accuracy points are required to draw a trend."}</EmptyState>}
        </section>

        <section className={styles.card} aria-labelledby="difficulty-title">
          <SectionHeading title={isFa ? "توزیع بر اساس سختی" : "Distribution by Difficulty"} subtitle={isFa ? "فقط در صورت وجود داده در API" : "Shown only when supplied by the API"} />
          {derived.difficulty.length ? (
            <div className={styles.difficultyList}>
              {derived.difficulty.map((item) => (
                <div className={styles.difficultyRow} key={item.label}>
                  <span>{localizeDifficulty(item.label, isFa)}</span>
                  <div><span style={{inlineSize: `${clamp(item.value)}%`}} /></div>
                  <strong>{Math.round(item.value)}%</strong>
                </div>
              ))}
            </div>
          ) : <EmptyState>{isFa ? "تفکیک سختی در snapshot فعلی ارائه نشده است." : "Difficulty distribution is not exposed by the current snapshot."}</EmptyState>}
        </section>
      </div>

      <div className={styles.insightGrid}>
        <section className={`${styles.card} ${styles.improvedCard}`} aria-labelledby="improved-title">
          <SectionHeading title={isFa ? "بیشترین پیشرفت" : "Most Improved"} subtitle={isFa ? "تغییر ثبت‌شده نسبت به snapshot قبلی" : "Recorded change versus a previous snapshot"} />
          {derived.improved.length ? derived.improved.map(({item, delta}) => (
            <InsightRow key={`${item.scope_type}:${item.scope_id}`} title={item.scope_title || item.scope_id || (isFa ? "حوزه بدون عنوان" : "Untitled scope")} value={Math.round(item.mastery_score_pct)} delta={`+${Math.round(delta)}%`} positive />
          )) : <EmptyState>{isFa ? "API فعلی delta مقایسه‌ای برای حوزه‌ها ارائه نکرده است؛ مقدار ساختگی نمایش داده نمی‌شود." : "The current API does not expose comparable scope deltas, so no improvement is fabricated."}</EmptyState>}
        </section>

        <section className={`${styles.card} ${styles.attentionCard}`} aria-labelledby="attention-title">
          <SectionHeading title={isFa ? "نیازمند توجه" : "Needs Attention"} subtitle={isFa ? "کمترین تسلط میان حوزه‌های دارای شواهد" : "Lowest mastery among evidence-backed scopes"} />
          {derived.needsAttention.length ? derived.needsAttention.map((item) => (
            <InsightRow key={`${item.scope_type}:${item.scope_id}`} title={item.scope_title || item.scope_id || (isFa ? "حوزه بدون عنوان" : "Untitled scope")} value={Math.round(item.mastery_score_pct)} />
          )) : <EmptyState>{isFa ? "هنوز حوزه‌ای برای اولویت‌بندی وجود ندارد." : "There is not enough evidence to prioritize a weak area yet."}</EmptyState>}
          <Link className={styles.practiceLink} href={`/${locale}/tests/new`}>{isFa ? "تمرین نقاط ضعف" : "Practice weak areas"}</Link>
        </section>
      </div>

      <section className={`${styles.card} ${styles.activityCard}`} aria-labelledby="activity-title">
        <SectionHeading title={isFa ? "فعالیت" : "Activity"} subtitle={isFa ? "خلاصه فعالیت ثبت‌شده" : "Persisted learning activity summary"} />
        <div className={styles.activityGrid}>
          <ActivityMetric icon="▣" label={isFa ? "درس‌های تکمیل‌شده" : "Lessons Completed"} value={derived.lessonsCompleted} />
          <ActivityMetric icon="✓" label={isFa ? "تمرین‌های تکمیل‌شده" : "Exercises Completed"} value={derived.exercisesCompleted} />
          <ActivityMetric icon="◷" label={isFa ? "دقایق تمرین" : "Minutes Practiced"} value={derived.practicedMinutes} />
        </div>
      </section>

      <footer className={styles.footerCta}>
        <div>
          <strong>{isFa ? "روی ضعیف‌ترین حوزه تمرکز کنید" : "Turn progress into the next focused step"}</strong>
          <p>{isFa ? "صفحه Progress فقط وضعیت ذخیره‌شده را نمایش می‌دهد؛ منطق یادگیری در backend باقی می‌ماند." : "Progress visualizes persisted state; learning decisions remain backend-owned."}</p>
        </div>
        <Link className="button button-primary" href={`/${locale}/tests/new`}>{isFa ? "شروع تمرین" : "Start practice"}</Link>
      </footer>
    </div>
  );
}

function MetricCard({icon, label, value, note, ring = false}: {icon: string; label: string; value: number | null; note: string; ring?: boolean}) {
  return (
    <article className={styles.card}>
      <div className={styles.metricHeader}><div className={styles.metricIcon} aria-hidden="true">{icon}</div><span>{label}</span></div>
      <div className={styles.metricValueRow}>
        <strong>{value === null ? "—" : `${Math.round(value)}%`}</strong>
        {ring ? <MiniRing value={value ?? 0} /> : null}
      </div>
      <small className={styles.metricNote}>{note}</small>
    </article>
  );
}

function MiniRing({value}: {value: number}) {
  const safe = clamp(value);
  return (
    <svg className={styles.miniRing} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" pathLength="100" />
      <circle cx="22" cy="22" r="18" pathLength="100" strokeDasharray={`${safe} ${100 - safe}`} />
    </svg>
  );
}

function SectionHeading({title, subtitle}: {title: string; subtitle: string}) {
  return <div className={styles.sectionHeading}><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function BarChart({points, target, isFa}: {points: SeriesPoint[]; target: number | null; isFa: boolean}) {
  const max = Math.max(...points.map((point) => point.value), target ?? 0, 1);
  return (
    <div className={styles.barChartWrap}>
      <div className={styles.barChart} role="img" aria-label={points.map((point) => `${point.label}: ${point.value}`).join(", ")}>
        {target !== null ? <span className={styles.targetLine} style={{insetBlockEnd: `${Math.min(96, Math.max(4, (target / max) * 100))}%`}}><b>{isFa ? "هدف" : "Target"} {Math.round(target)}</b></span> : null}
        {points.map((point) => (
          <div className={styles.barItem} key={`${point.label}:${point.value}`}>
            <span className={styles.barValue}>{Math.round(point.value)}</span>
            <span className={styles.barTrack}><span style={{blockSize: `${Math.max(5, Math.round((point.value / max) * 100))}%`}} /></span>
            <small>{point.label}</small>
          </div>
        ))}
      </div>
      <p className={styles.chartCaption}>{isFa ? "دقیقه مطالعه/تمرین" : "Study / practice minutes"}</p>
    </div>
  );
}

function LineChart({points}: {points: SeriesPoint[]}) {
  const width = 620;
  const height = 210;
  const padX = 28;
  const padY = 24;
  const values = points.map((point) => clamp(point.value));
  const min = Math.max(0, Math.floor(Math.min(...values) / 10) * 10 - 10);
  const max = Math.min(100, Math.ceil(Math.max(...values) / 10) * 10 + 10);
  const span = Math.max(max - min, 1);
  const coords = points.map((point, index) => ({
    x: padX + (index * (width - padX * 2)) / Math.max(points.length - 1, 1),
    y: height - padY - ((clamp(point.value) - min) / span) * (height - padY * 2),
  }));
  const polyline = coords.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className={styles.lineChartWrap}>
      <svg className={styles.lineChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={points.map((point) => `${point.label}: ${Math.round(point.value)}%`).join(", ")}>
        {[0, 1, 2, 3].map((line) => <line key={line} x1={padX} x2={width - padX} y1={padY + line * ((height - padY * 2) / 3)} y2={padY + line * ((height - padY * 2) / 3)} />)}
        <polyline points={polyline} />
        {coords.map((point, index) => <circle key={`${point.x}:${point.y}`} cx={point.x} cy={point.y} r="5" />)}
      </svg>
      <div className={styles.lineLabels}>
        {points.map((point, index) => <small key={`${point.label}:${index}`}>{point.label}</small>)}
      </div>
    </div>
  );
}

function InsightRow({title, value, delta, positive = false}: {title: string; value: number; delta?: string; positive?: boolean}) {
  return (
    <div className={styles.insightRow}>
      <div><strong>{title}</strong>{delta ? <span className={positive ? styles.positiveDelta : ""}>{delta}</span> : null}</div>
      <div className={styles.insightScore}><span><i style={{inlineSize: `${clamp(value)}%`}} /></span><b>{value}%</b></div>
    </div>
  );
}

function ActivityMetric({icon, label, value}: {icon: string; label: string; value: number | null}) {
  return <article className={styles.activityMetric}><span aria-hidden="true">{icon}</span><div><strong>{value === null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(value))}</strong><small>{label}</small></div></article>;
}

function EmptyState({children}: {children: React.ReactNode}) {
  return <div className={styles.emptyState}><span aria-hidden="true">· · ·</span><p>{children}</p></div>;
}

function asRecord(value: unknown): LooseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function readNumber(value: unknown, keys: string[]): number | null {
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim() !== "") {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readText(value: unknown, keys: string[]): string | null {
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function readPercent(value: unknown, keys: string[]): number | null {
  const number = readNumber(value, keys);
  if (number === null) return null;
  return number <= 1 ? clamp(number * 100) : clamp(number);
}

function normalizeRatio(value: number): number {
  return clamp(value <= 1 ? value * 100 : value);
}

function extractSeries(value: unknown, valueKeys: string[]): SeriesPoint[] {
  const record = asRecord(value);
  const candidates: unknown[] = [];
  for (const key of ["days", "daily", "last_7_days", "week", "weekly", "series", "items", "snapshots", "history", "trend"]) {
    if (Array.isArray(record[key])) candidates.push(record[key]);
  }
  if (Array.isArray(value)) candidates.push(value);

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const points = candidate.map((item, index) => {
      const rawLabel = readText(item, ["label", "day", "date", "name", "period", "snapshot_at", "created_at"]);
      const amount = readNumber(item, valueKeys);
      if (amount === null) return null;
      const date = rawLabel ? parseDate(rawLabel) : null;
      return {label: compactLabel(rawLabel ?? `#${index + 1}`), value: valueKeys.some((key) => key.includes("accuracy") || key.includes("pct") || key.includes("score")) ? normalizeRatio(amount) : Math.max(0, amount), date};
    }).filter((point): point is SeriesPoint => point !== null);
    if (points.length) return points;
  }
  return [];
}

function filterSeries(points: SeriesPoint[], range: RangeKey): SeriesPoint[] {
  if (!points.length || range === "all") return points.slice(-24);
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const dated = points.filter((point) => point.date !== null);
  if (dated.length === points.length) {
    const latest = Math.max(...dated.map((point) => point.date!.getTime()));
    const threshold = latest - days * 24 * 60 * 60 * 1000;
    return points.filter((point) => point.date!.getTime() >= threshold).slice(-24);
  }
  const fallbackCount = range === "7d" ? 7 : range === "30d" ? 12 : 18;
  return points.slice(-fallbackCount);
}

function extractDifficulty(records: LooseRecord[]): DifficultyPoint[] {
  for (const record of records) {
    for (const key of ["difficulty_distribution", "by_difficulty", "difficulty", "difficulty_breakdown"]) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        const rows = candidate.map((item) => {
          const label = readText(item, ["difficulty", "label", "name", "level"]);
          const value = readPercent(item, ["accuracy_pct", "mastery_pct", "value", "score_pct", "percent"]);
          return label && value !== null ? {label, value} : null;
        }).filter((row): row is DifficultyPoint => row !== null);
        if (rows.length) return rows.slice(0, 3);
      }
      const nested = asRecord(candidate);
      const rows = Object.entries(nested).map(([label, raw]) => {
        const direct = typeof raw === "number" ? raw : readNumber(raw, ["accuracy_pct", "mastery_pct", "value", "score_pct", "percent"]);
        return direct === null ? null : {label, value: direct <= 1 ? direct * 100 : direct};
      }).filter((row): row is DifficultyPoint => row !== null);
      if (rows.length) return rows.slice(0, 3);
    }
  }
  return [];
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compactLabel(value: string): string {
  const date = parseDate(value);
  if (date) return new Intl.DateTimeFormat("en-CA", {month: "short", day: "numeric"}).format(date);
  return value.length > 10 ? value.slice(0, 10) : value;
}

function rangeLabel(range: RangeKey, isFa: boolean): string {
  const option = RANGE_OPTIONS.find((item) => item.key === range);
  return option ? (isFa ? option.fa : option.en) : "";
}

function localizeDifficulty(value: string, isFa: boolean): string {
  if (!isFa) return value;
  const normalized = value.toLowerCase();
  if (normalized.includes("begin") || normalized.includes("easy")) return "مقدماتی";
  if (normalized.includes("inter")) return "متوسط";
  if (normalized.includes("adv") || normalized.includes("hard")) return "پیشرفته";
  return value;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {DashboardEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import {
  ACHIEVEMENT_MODEL_VERSION,
  TOTAL_ACHIEVEMENT_MARKERS,
  TOTAL_MILESTONES,
  buildMilestones,
  countAchievementMarkers,
  type AchievementMetricSnapshot,
  type MilestoneCategory,
  type MilestoneView,
} from "./achievementModel";
import styles from "./AchievementsClient.module.css";

type FilterKey = "all" | MilestoneCategory;
type LooseRecord = Record<string, unknown>;
type CachedAchievements = {savedAt: string; dashboard: DashboardEnvelope};
type TrendPoint = {value: number; date: Date | null};

const CACHE_KEY = "gmp-achievements-safe-snapshot-v1";

const FILTERS: Array<{key: FilterKey; fa: string; en: string}> = [
  {key: "all", fa: "همه", en: "All"},
  {key: "streak", fa: "Streak", en: "Streak"},
  {key: "mastery", fa: "Mastery", en: "Mastery"},
  {key: "improvement", fa: "Improvement", en: "Improvement"},
  {key: "consistency", fa: "Consistency", en: "Consistency"},
];

function asRecord(value: unknown): LooseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as LooseRecord
    : {};
}

function readNumber(record: LooseRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function readText(record: LooseRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizePercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

function extractTrendPoints(value: unknown): TrendPoint[] {
  const rows: unknown[] = [];
  if (Array.isArray(value)) rows.push(...value);
  else {
    const record = asRecord(value);
    const candidateKeys = ["points", "items", "series", "snapshots", "days", "daily", "weekly", "last_7_days"];
    for (const key of candidateKeys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        rows.push(...candidate);
        break;
      }
    }
  }

  return rows.flatMap((entry) => {
    const row = asRecord(entry);
    const rawValue = readNumber(row, [
      "mastery_score_pct",
      "mastery_pct",
      "score_pct",
      "accuracy_pct",
    ]);
    const numeric = normalizePercent(rawValue);
    if (numeric === null) return [];
    const rawDate = readText(row, ["date", "captured_at", "as_of", "created_at", "completed_at"]);
    const parsedDate = rawDate ? new Date(rawDate) : null;
    return [{
      value: numeric,
      date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
    }];
  });
}

function trendImprovement(points: TrendPoint[]) {
  if (points.length < 2) return 0;
  let best = Math.max(0, points[points.length - 1]!.value - points[0]!.value);
  for (let index = 1; index < points.length; index += 1) {
    best = Math.max(best, points[index]!.value - points[index - 1]!.value);
  }
  return Math.max(0, best);
}

function formatNumber(value: number, isFa: boolean) {
  return new Intl.NumberFormat(isFa ? "fa-IR" : "en-CA", {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value)));
}

function formatDate(value: string | null, isFa: boolean) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(isFa ? "fa-IR" : "en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function deriveMetrics(dashboard: DashboardEnvelope["data"]): AchievementMetricSnapshot {
  const evidence = dashboard.mastery.filter((item) => item.confidence > 0 && item.coverage_ratio > 0);
  const categories = evidence.filter((item) => item.scope_type === "CATEGORY");
  const lessons = evidence.filter((item) => item.scope_type === "LESSON");
  const overallMastery = evidence.length
    ? evidence.reduce((sum, item) => sum + item.mastery_score_pct, 0) / evidence.length
    : null;
  const masteredScopes = evidence.filter((item) => item.mastery_score_pct >= 80).length;
  const masteredCategories = categories.filter((item) => item.mastery_score_pct >= 80).length;

  const activity = asRecord(dashboard.activity);
  const recentTest = asRecord(dashboard.recent_test);
  const streakDays = Math.max(0, readNumber(activity, ["current_streak_days", "streak_days", "streak"]) ?? 0);
  const questionsAnswered = Math.max(0, readNumber(activity, ["questions_answered", "total_questions", "questions_total"]) ?? 0);
  const completedSessionsFromActivity = readNumber(activity, ["completed_attempts", "attempts_completed", "sessions", "session_count"]);
  const recentCompletedAt = readText(recentTest, ["completed_at", "finished_at", "created_at"]);
  const completedSessions = Math.max(0, completedSessionsFromActivity ?? (recentCompletedAt ? 1 : 0));
  const recentAccuracy = normalizePercent(
    readNumber(recentTest, ["accuracy_pct", "score_pct", "score", "accuracy"])
      ?? readNumber(activity, ["accuracy_pct", "recent_accuracy", "accuracy"]),
  );
  const recentQuestionCount = readNumber(recentTest, ["question_count", "questions", "total_questions"]);

  const directImprovement = evidence.reduce((best, item) => {
    const delta = readNumber(asRecord(item), ["delta_pct", "change_pct", "improvement_pct", "mastery_delta_pct"]);
    return delta !== null && delta > best ? delta : best;
  }, 0);
  const seriesImprovement = trendImprovement(extractTrendPoints(dashboard.trend));

  return {
    streakDays,
    masteredScopes,
    masteredCategories,
    overallMastery,
    recentAccuracy,
    recentQuestionCount,
    recentCompletedAt,
    completedSessions,
    questionsAnswered,
    lessonEvidenceCount: lessons.length,
    bestImprovement: Math.max(0, directImprovement, seriesImprovement),
  };
}

function metricDestination(locale: Locale, category: MilestoneCategory) {
  if (category === "mastery" || category === "improvement") return `/${locale}/progress`;
  return `/${locale}/tests/new`;
}

function MilestoneCard({milestone, isFa}: {milestone: MilestoneView; isFa: boolean}) {
  const earnedDate = formatDate(milestone.completedAt, isFa);
  return (
    <article className={`${styles.milestoneCard} ${styles[`tone_${milestone.tone}`]}${milestone.completed ? ` ${styles.completedCard}` : ""}`}>
      <div className={styles.milestoneIcon} aria-hidden="true">{milestone.completed ? "✓" : milestone.icon}</div>
      <div className={styles.milestoneCopy}>
        <strong className={styles.milestoneName} dir="auto">{milestone.name}</strong>
        <p>{milestone.description}</p>
      </div>
      {milestone.completed ? (
        <div className={styles.earnedMeta}>
          <span>{isFa ? "کسب‌شده" : "Earned"}</span>
          {earnedDate ? <time dateTime={milestone.completedAt ?? undefined}>{earnedDate}</time> : <small>{isFa ? "بر اساس شواهد فعلی" : "From current evidence"}</small>}
        </div>
      ) : (
        <>
          <div className={styles.progressMeta}>
            <span>{milestone.current}</span>
            <strong>{formatNumber(milestone.progress, isFa)}%</strong>
          </div>
          <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={milestone.progress} aria-label={`${milestone.name}: ${milestone.progress}%`}>
            <span style={{inlineSize: `${milestone.progress}%`}} />
          </div>
        </>
      )}
    </article>
  );
}

export function AchievementsClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [filter, setFilter] = useState<FilterKey>("all");
  const [data, setData] = useState<CachedAchievements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dashboard = await apiRequest<DashboardEnvelope>("/api/backend/dashboard");
      if (!dashboard) throw new ApiError({status: 502, code: "EMPTY_ACHIEVEMENTS_SOURCE", message: "Achievement source data was empty."});
      const snapshot = {savedAt: new Date().toISOString(), dashboard};
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
      setData(snapshot);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Achievements loading failed."}));
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        try { setData(JSON.parse(cached) as CachedAchievements); }
        catch { sessionStorage.removeItem(CACHE_KEY); }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial read synchronizes this derived gamification view with persisted learning evidence.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const derived = useMemo(() => {
    if (!data) return null;
    const metrics = deriveMetrics(data.dashboard.data);
    const milestones = buildMilestones(metrics, isFa);
    const completed = milestones.filter((item) => item.completed);
    const nearest = milestones
      .filter((item) => !item.completed)
      .sort((a, b) => b.progress - a.progress)[0] ?? null;
    const recent = [...completed]
      .sort((a, b) => {
        const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 3);
    return {
      metrics,
      milestones,
      completed,
      nearest,
      recent,
      earnedMarkers: countAchievementMarkers(metrics),
    };
  }, [data, isFa]);

  if (loading && !data) return <LoadingCard label={isFa ? "بارگذاری دستاوردها" : "Loading achievements"} />;
  if (!data || !derived) {
    return (
      <StatusPanel
        title={error?.status === 401 ? (isFa ? "ابتدا وارد شوید" : "Please log in") : (error?.message ?? (isFa ? "دستاوردها در دسترس نیست" : "Achievements unavailable"))}
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

  const visibleMilestones = filter === "all"
    ? derived.milestones
    : derived.milestones.filter((item) => item.category === filter);
  const snapshotDate = new Date(data.savedAt).toLocaleString(isFa ? "fa-IR" : "en-CA", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={styles.viewportBreakout}>
      <div className={styles.page}>
        {error ? (
          <StatusPanel
            title={isFa ? "نمای ذخیره‌شده نمایش داده می‌شود" : "Showing the last safe snapshot"}
            tone="warning"
            requestId={error.requestId}
            action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
          >
            <p>{snapshotDate}</p>
          </StatusPanel>
        ) : null}

        <header className={styles.pageHeading}>
          <p className={styles.eyebrow}>Grammar Mastery</p>
          <h1>{isFa ? <>دستاوردها و <span dir="ltr">Milestones</span></> : "Achievements & Milestones"}</h1>
          <p>{isFa ? "پیشرفت واقعی شما در استمرار، تسلط، بهبود و کیفیت تمرین" : "Your real progress across consistency, mastery, improvement, and practice quality."}</p>
        </header>

        <section className={styles.statsGrid} aria-label={isFa ? "خلاصه دستاوردها" : "Achievement summary"}>
          <article className={`${styles.statCard} ${styles.tone_blue}`}>
            <span className={styles.statIcon} aria-hidden="true">◆</span>
            <div><small>{isFa ? "دستاوردهای کسب‌شده" : "Achievements earned"}</small><strong>{formatNumber(derived.earnedMarkers, isFa)} / {formatNumber(TOTAL_ACHIEVEMENT_MARKERS, isFa)}</strong></div>
          </article>
          <article className={`${styles.statCard} ${styles.tone_green}`}>
            <span className={styles.statIcon} aria-hidden="true">✓</span>
            <div><small>{isFa ? "Milestoneهای تکمیل‌شده" : "Milestones completed"}</small><strong>{formatNumber(derived.completed.length, isFa)} / {formatNumber(TOTAL_MILESTONES, isFa)}</strong></div>
          </article>
          <article className={`${styles.statCard} ${styles.tone_amber}`}>
            <span className={styles.statIcon} aria-hidden="true">◒</span>
            <div><small>{isFa ? "روز متوالی" : "Current streak"}</small><strong>{formatNumber(derived.metrics.streakDays, isFa)}</strong></div>
          </article>
          <article className={`${styles.statCard} ${styles.tone_violet}`}>
            <span className={styles.statIcon} aria-hidden="true">↗</span>
            <div><small>{isFa ? "بهترین بهبود ثبت‌شده" : "Best recorded improvement"}</small><strong>+{formatNumber(derived.metrics.bestImprovement, isFa)}%</strong></div>
          </article>
        </section>

        <div className={styles.contentGrid}>
          <main className={styles.mainColumn}>
            <div className={styles.tabs} role="tablist" aria-label={isFa ? "فیلتر دستاوردها" : "Filter milestones"}>
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.key}
                  className={filter === item.key ? styles.activeTab : undefined}
                  onClick={() => setFilter(item.key)}
                >
                  {isFa ? item.fa : item.en}
                </button>
              ))}
            </div>

            <section className={styles.milestonesPanel} aria-labelledby="your-milestones-title">
              <div className={styles.panelHeading}>
                <div>
                  <h2 id="your-milestones-title">{isFa ? "دستاوردهای شما" : "Your milestones"}</h2>
                  <p>{isFa ? "هر وضعیت از داده‌های واقعی Dashboard محاسبه می‌شود؛ تاریخ کسب فقط وقتی نمایش داده می‌شود که API آن را قابل استنتاج کند." : "Each state is derived from real Dashboard evidence; an earned date is shown only when the API makes it inferable."}</p>
                </div>
                <span>{formatNumber(visibleMilestones.length, isFa)}</span>
              </div>
              <div className={styles.milestoneGrid}>
                {visibleMilestones.map((milestone) => <MilestoneCard key={milestone.id} milestone={milestone} isFa={isFa} />)}
              </div>
            </section>
          </main>

          <aside className={styles.sidebar} aria-label={isFa ? "وضعیت Milestoneها" : "Milestone status"}>
            <section className={styles.sidePanel}>
              <h2>{isFa ? <>نزدیک‌ترین <span dir="ltr">Milestone</span></> : "Nearest milestone"}</h2>
              {derived.nearest ? (
                <div className={`${styles.nearestCard} ${styles[`tone_${derived.nearest.tone}`]}`}>
                  <div className={styles.nearestTop}>
                    <span className={styles.nearestIcon} aria-hidden="true">{derived.nearest.icon}</span>
                    <div><strong dir="auto">{derived.nearest.name}</strong><p>{derived.nearest.description}</p></div>
                  </div>
                  <div className={styles.progressMeta}><span>{derived.nearest.current}</span><strong>{formatNumber(derived.nearest.progress, isFa)}%</strong></div>
                  <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={derived.nearest.progress} aria-label={`${derived.nearest.name}: ${derived.nearest.progress}%`}>
                    <span style={{inlineSize: `${derived.nearest.progress}%`}} />
                  </div>
                  <Link className={styles.sideAction} href={metricDestination(locale, derived.nearest.category)}>
                    {derived.nearest.category === "mastery" || derived.nearest.category === "improvement"
                      ? (isFa ? "مشاهده پیشرفت" : "View progress")
                      : (isFa ? "شروع تمرین" : "Start practice")}
                  </Link>
                </div>
              ) : (
                <div className={styles.allComplete}>
                  <span aria-hidden="true">✓</span>
                  <p>{isFa ? "همه Milestoneهای این نسخه تکمیل شده‌اند." : "All milestones in this model are complete."}</p>
                </div>
              )}
            </section>

            <section className={styles.sidePanel}>
              <h2>{isFa ? "Recent achievements" : "Recent achievements"}</h2>
              {derived.recent.length ? (
                <div className={styles.recentList}>
                  {derived.recent.map((item) => {
                    const exactDate = formatDate(item.completedAt, isFa);
                    return (
                      <article key={item.id} className={styles.recentItem}>
                        <span className={`${styles.recentIcon} ${styles[`tone_${item.tone}`]}`} aria-hidden="true">{item.icon}</span>
                        <div><strong dir="auto">{item.name}</strong><small>{exactDate ?? (isFa ? "بر اساس snapshot فعلی" : "Current snapshot")}</small></div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.emptyRecent}>{isFa ? "هنوز Milestone تکمیل‌شده‌ای ثبت نشده است؛ اولین تمرین کامل بهترین نقطه شروع است." : "No milestone has been completed yet. A first completed session is the best starting point."}</p>
              )}
              <button className={styles.viewAllButton} type="button" onClick={() => setFilter("all")}>
                {isFa ? "مشاهده همه Milestoneها" : "View all milestones"}
              </button>
            </section>

            <footer className={styles.modelNote}>
              <span>{isFa ? "مدل محاسبه" : "Calculation model"}</span>
              <code dir="ltr">{ACHIEVEMENT_MODEL_VERSION}</code>
              <small>{isFa ? `آخرین همگام‌سازی: ${snapshotDate}` : `Last synced: ${snapshotDate}`}</small>
            </footer>
          </aside>
        </div>
      </div>
    </div>
  );
}

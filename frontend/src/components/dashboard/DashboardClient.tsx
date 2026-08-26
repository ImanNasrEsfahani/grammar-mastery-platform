"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {DashboardEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";

type DashboardAction = {code: string; destination: string; reason: string};
type CachedDashboard = {savedAt: string; dashboard: DashboardEnvelope; nextAction: DashboardAction};
type LooseRecord = Record<string, unknown>;
type TrendPoint = {label: string; value: number};

export function DashboardClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [data, setData] = useState<CachedDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const snapshotKey = `gmp-dashboard-safe-snapshot-v2:${locale}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // One backend snapshot is enough. The authoritative action code is already
      // part of /dashboard; destination/reason are projected locally from that
      // same snapshot instead of issuing a second heavy next-action request.
      const dashboard = await apiRequest<DashboardEnvelope>("/api/backend/dashboard");
      if (!dashboard) throw new ApiError({status: 502, code: "EMPTY_DASHBOARD", message: "Dashboard data was empty."});
      const nextAction = actionFromDashboard(dashboard.data, locale);
      const snapshot = {savedAt: new Date().toISOString(), dashboard, nextAction};
      sessionStorage.setItem(snapshotKey, JSON.stringify(snapshot));
      setData(snapshot);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Dashboard loading failed."}));
      const cached = sessionStorage.getItem(snapshotKey);
      if (cached) {
        try { setData(JSON.parse(cached) as CachedDashboard); } catch { sessionStorage.removeItem(snapshotKey); }
      }
    } finally {
      setLoading(false);
    }
  }, [locale, snapshotKey]);

  // Initial fetch synchronizes the client view with the persisted dashboard snapshot.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const derived = useMemo(() => {
    if (!data) return null;
    const dashboard = data.dashboard.data;
    const evidence = dashboard.mastery.filter((item) => item.confidence > 0 && item.coverage_ratio > 0);
    const focus = [...evidence].sort((a, b) => a.mastery_score_pct - b.mastery_score_pct).slice(0, 3);
    const categories = evidence.filter((item) => item.scope_type === "CATEGORY");
    const masteryMap = (categories.length ? categories : evidence).slice(0, 6);
    const overall = evidence.length
      ? Math.round(evidence.reduce((sum, item) => sum + item.mastery_score_pct, 0) / evidence.length)
      : null;
    const activity = asRecord(dashboard.activity);
    const trend = extractTrend(dashboard.trend, isFa);
    const currentStreak = readNumber(activity, ["current_streak_days", "streak_days", "streak"]);
    const todayQuestions = readNumber(activity, ["questions_today", "today_questions", "daily_questions"]);
    const dailyGoal = readDailyGoal(activity);
    const reviewDue = readNumber(asRecord(dashboard.review_queue), ["due_count"]) ?? 0;
    const reviewItems = readReviewItems(dashboard.review_queue).slice(0, 3);
    const masteredLessons = evidence.filter((item) => item.scope_type === "LESSON" && item.mastery_score_pct >= 80).length;
    const masteredScopes = evidence.filter((item) => item.mastery_score_pct >= 80).length;
    const strongest = [...evidence].sort((a, b) => b.mastery_score_pct - a.mastery_score_pct)[0] ?? null;
    return {
      evidence,
      focus,
      masteryMap,
      overall,
      activity,
      trend,
      currentStreak,
      todayQuestions,
      dailyGoal,
      reviewDue,
      reviewItems,
      masteredCount: masteredLessons || masteredScopes,
      strongest,
    };
  }, [data, isFa]);

  if (loading && !data) return <LoadingCard label={isFa ? "بارگذاری داشبورد" : "Loading dashboard"} />;
  if (!data || !derived) {
    return (
      <StatusPanel
        title={error?.status === 401 ? (isFa ? "ابتدا وارد شوید" : "Please log in") : (error?.message ?? "Dashboard unavailable")}
        tone="danger"
        requestId={error?.requestId}
        action={error?.status === 401 ? {label: isFa ? "ورود" : "Log in", href: `/${locale}/login`} : {label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
      >
        <p>{error?.code}</p>
      </StatusPanel>
    );
  }

  const dashboard = data.dashboard.data;
  const action = data.nextAction;
  const inProgress = dashboard.in_progress_attempt;
  const answered = inProgress?.answered_count ?? 0;
  const questionCount = inProgress?.question_count ?? 0;
  const attemptProgress = questionCount > 0 ? Math.min(100, Math.round((answered / questionCount) * 100)) : 0;
  const primaryFocus = derived.focus[0] ?? null;
  const dailyGoalPercent = derived.dailyGoal?.target
    ? Math.min(100, Math.round(((derived.dailyGoal.completed ?? 0) / derived.dailyGoal.target) * 100))
    : null;

  return (
    <div className="dashboard-reference-layout">
      {error ? (
        <StatusPanel title={isFa ? "نمای ذخیره‌شده نمایش داده می‌شود" : "Showing the last safe snapshot"} tone="warning" requestId={error.requestId} action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}>
          <p>{new Date(data.savedAt).toLocaleString(locale === "fa" ? "fa-IR" : "en-CA")}</p>
        </StatusPanel>
      ) : null}

      <section className="dashboard-welcome surface" aria-labelledby="dashboard-welcome-title">
        <div className="dashboard-welcome-copy">
          <p className="eyebrow">Grammar Mastery</p>
          <h1 id="dashboard-welcome-title" lang="fr" dir="ltr">Bonjour <span aria-hidden="true">👋</span></h1>
          <p>{isFa ? "به مسیر یادگیری گرامر فرانسه خوش آمدید. هر روز یک قدم به تسلط نزدیک‌تر می‌شوید." : "Welcome back to your French grammar path. One focused step at a time."}</p>
        </div>
        <div className="dashboard-level-card" aria-label={isFa ? "مسیر سطح B1 به B2" : "Level path B1 to B2"}>
          <span>{isFa ? "سطح فعلی" : "Current path"}</span>
          <strong dir="ltr">B1 <span aria-hidden="true">→</span> B2</strong>
          <OverallRing value={derived.overall} isFa={isFa} />
          <Link href={`/${locale}/progress`}>{isFa ? "مشاهده جزئیات" : "View progress"}</Link>
        </div>
        <div className="dashboard-today-card">
          <div className="dashboard-section-heading">
            <div>
              <p className="eyebrow">{isFa ? "اقدام امروز" : "Today action"}</p>
              <h2>{humanizeAction(action.code)}</h2>
            </div>
            <span className="dashboard-icon-badge" aria-hidden="true">✓</span>
          </div>
          <p>{action.reason}</p>
          <div className="dashboard-action-facts">
            <span><strong>{derived.reviewDue}</strong>{isFa ? " مرور سررسیدشده" : " reviews due"}</span>
            <span><strong>{primaryFocus ? `${Math.round(primaryFocus.mastery_score_pct)}%` : "—"}</strong>{isFa ? " تمرکز فعلی" : " focus mastery"}</span>
          </div>
          <Link className="button button-primary dashboard-main-cta" href={action.destination}>{isFa ? "ادامه مسیر" : "Continue"}</Link>
        </div>
      </section>

      <section className="dashboard-kpis" aria-label={isFa ? "شاخص‌های اصلی" : "Key metrics"}>
        <MetricCard icon="🔥" value={formatMetric(derived.currentStreak)} label={isFa ? "روز متوالی" : "day streak"} note={isFa ? "تداوم یادگیری" : "learning consistency"} />
        <MetricCard icon="▤" value={formatMetric(readNumber(derived.activity, ["questions_answered"]) ?? 0)} label={isFa ? "سؤال پاسخ داده‌شده" : "questions answered"} note={isFa ? "طبق snapshot داشبورد" : "from dashboard snapshot"} />
        <MetricCard icon="◎" value={derived.overall === null ? "—" : `${derived.overall}%`} label={isFa ? "تسلط کلی" : "overall mastery"} note={isFa ? "میانگین حوزه‌های دارای شواهد" : "average of evidence-bearing scopes"} />
        <MetricCard icon="⌂" value={formatMetric(derived.reviewDue)} label={isFa ? "بازبینی‌های موعددار" : "reviews due"} note={isFa ? "نیاز به مرور" : "ready for review"} tone="danger" />
      </section>

      <div className="dashboard-content-grid">
        <section className="surface dashboard-focus-card stack" aria-labelledby="focus-today-title">
          <div className="dashboard-section-heading">
            <h2 id="focus-today-title">{isFa ? "تمرکز امروز" : "Focus today"}</h2>
            <span className="dashboard-icon-badge" aria-hidden="true">◎</span>
          </div>
          {primaryFocus ? (
            <>
              <div className="focus-highlight">
                <span className="focus-priority">{isFa ? "اولویت بر اساس کمترین تسلط" : "Priority by lowest mastery"}</span>
                <strong lang={looksFrench(primaryFocus.scope_title) ? "fr" : undefined} dir={looksFrench(primaryFocus.scope_title) ? "ltr" : undefined}>
                  {primaryFocus.scope_title || scopeTypeLabel(primaryFocus.scope_type, isFa)}
                </strong>
                <div className="focus-scores">
                  <ScoreDial value={Math.round(primaryFocus.mastery_score_pct)} label={isFa ? "تسلط" : "Mastery"} />
                  <ScoreDial value={Math.round(primaryFocus.confidence * 100)} label={isFa ? "اعتماد" : "Confidence"} tone="warning" />
                </div>
              </div>
              <p className="muted">{isFa ? "این اولویت مستقیماً از پایین‌ترین امتیاز تسلط میان حوزه‌های دارای شواهد ساخته شده است." : "This priority is derived directly from the lowest mastery score among evidence-bearing scopes."}</p>
              <Link className="button button-danger-soft" href={action.destination}>{isFa ? "تمرین این تمرکز" : "Practice this focus"}</Link>
            </>
          ) : (
            <EmptyDashboardState>{isFa ? "هنوز شواهد کافی برای تعیین تمرکز امروز وجود ندارد." : "There is not enough evidence to choose today's focus yet."}</EmptyDashboardState>
          )}
        </section>

        <section className="surface dashboard-mastery-map stack" aria-labelledby="mastery-map-title">
          <div className="dashboard-section-heading">
            <h2 id="mastery-map-title">{isFa ? "نقشه تسلط گرامر" : "Grammar mastery map"}</h2>
            <span className="dashboard-icon-badge" aria-hidden="true">⌘</span>
          </div>
          {derived.masteryMap.length ? derived.masteryMap.map((item) => (
            <div className="mastery-map-row" key={`${item.scope_type}:${item.scope_id}`}>
              <span className="mastery-map-label" title={item.scope_title || item.scope_id}>{item.scope_title || scopeTypeLabel(item.scope_type, isFa)}</span>
              <progress max={100} value={Math.round(item.mastery_score_pct)} aria-label={`${item.scope_title || item.scope_id}: ${Math.round(item.mastery_score_pct)}%`} />
              <strong>{Math.round(item.mastery_score_pct)}%</strong>
            </div>
          )) : <EmptyDashboardState>{isFa ? "با پاسخ‌دادن به سؤال‌ها، نقشه تسلط اینجا شکل می‌گیرد." : "Your mastery map will appear as evidence accumulates."}</EmptyDashboardState>}
          <Link className="dashboard-text-link" href={`/${locale}/progress`}>{isFa ? "مشاهده نقشه کامل" : "View full progress"}</Link>
        </section>

        <section className="surface dashboard-resume-card stack stack-small" aria-labelledby="resume-title">
          <div className="dashboard-section-heading">
            <h2 id="resume-title">{isFa ? "تلاش ناتمام" : "Resume attempt"}</h2>
            <span className="dashboard-icon-badge" aria-hidden="true">↶</span>
          </div>
          {inProgress ? (
            <>
              <strong>{isFa ? "از همان‌جایی که ماندید ادامه دهید" : "Continue where you left off"}</strong>
              <p>{isFa ? `${answered} از ${questionCount} سؤال پاسخ داده شده است.` : `${answered} of ${questionCount} questions answered.`}</p>
              <progress max={100} value={attemptProgress} aria-label={isFa ? `پیشرفت تلاش ${attemptProgress} درصد` : `Attempt progress ${attemptProgress}%`} />
              <Link className="button button-secondary" href={`/${locale}/attempts/${inProgress.attempt_id}`}>{isFa ? "ادامه از همان‌جا" : "Resume"}</Link>
            </>
          ) : <EmptyDashboardState>{isFa ? "در حال حاضر تلاش نیمه‌تمامی ندارید." : "You have no unfinished attempt right now."}</EmptyDashboardState>}
        </section>

        <section className="surface dashboard-review-card stack stack-small" aria-labelledby="review-inbox-title">
          <div className="dashboard-section-heading">
            <h2 id="review-inbox-title">{isFa ? "صندوق بازبینی" : "Review Inbox"}</h2>
            <span className="dashboard-icon-badge" aria-hidden="true">⌂</span>
          </div>
          <p className="review-due-count"><strong>{derived.reviewDue}</strong><span>{isFa ? "مرور موعددار" : "reviews due"}</span></p>
          {derived.reviewItems.length ? (
            <ul className="dashboard-review-list">
              {derived.reviewItems.map((item, index) => <li key={`${item.label}:${index}`}><span>{item.label}</span>{item.count !== null ? <strong>{item.count}</strong> : null}</li>)}
            </ul>
          ) : <p className="muted">{isFa ? "جزئیات موضوعات مرور در snapshot فعلی ارائه نشده است." : "The current snapshot does not expose review-topic details."}</p>}
          <Link className="button button-secondary" href={`/${locale}/review`}>{isFa ? "مشاهده و بازبینی" : "Open review"}</Link>
        </section>

        <section className="surface dashboard-weekly-card stack stack-small" aria-labelledby="weekly-progress-title">
          <div className="dashboard-section-heading">
            <h2 id="weekly-progress-title">{isFa ? "پیشرفت هفتگی" : "Weekly progress"}</h2>
            <span className="dashboard-icon-badge" aria-hidden="true">▥</span>
          </div>
          {derived.trend.length ? <WeeklyBars points={derived.trend} /> : <EmptyDashboardState>{isFa ? "API فعلی هنوز سری روزانه قابل‌نمایش ارائه نکرده است." : "The current API snapshot does not expose a displayable daily series yet."}</EmptyDashboardState>}
        </section>

        <section className="surface dashboard-daily-goal stack stack-small" aria-labelledby="daily-goal-title">
          <div className="dashboard-section-heading">
            <h2 id="daily-goal-title">{isFa ? "هدف روزانه" : "Daily goal"}</h2>
            <span className="dashboard-icon-badge success" aria-hidden="true">◎</span>
          </div>
          {derived.dailyGoal?.target ? (
            <>
              <p className="daily-goal-copy"><strong>{derived.dailyGoal.completed ?? 0}</strong> / {derived.dailyGoal.target} {isFa ? "سؤال" : "questions"}</p>
              <progress max={100} value={dailyGoalPercent ?? 0} aria-label={isFa ? `هدف روزانه ${dailyGoalPercent ?? 0} درصد` : `Daily goal ${dailyGoalPercent ?? 0}%`} />
            </>
          ) : derived.todayQuestions !== null ? (
            <>
              <p className="daily-goal-copy"><strong>{derived.todayQuestions}</strong> {isFa ? "سؤال امروز" : "questions today"}</p>
              <p className="muted">{isFa ? "هدف عددی در snapshot فعلی مشخص نشده است." : "No numeric daily target is present in the current snapshot."}</p>
            </>
          ) : <EmptyDashboardState>{isFa ? "هدف روزانه هنوز توسط داده‌های داشبورد تعیین نشده است." : "A daily goal is not currently supplied by dashboard data."}</EmptyDashboardState>}
        </section>
      </div>

      <section className="surface dashboard-achievements" aria-labelledby="achievements-title">
        <div className="dashboard-section-heading">
          <div>
            <p className="eyebrow">{isFa ? "بر پایه داده‌های واقعی" : "Evidence-derived"}</p>
            <h2 id="achievements-title">{isFa ? "دستاوردهای اخیر" : "Recent achievements"}</h2>
          </div>
        </div>
        <div className="achievement-grid">
          <Achievement icon="🔥" value={formatMetric(derived.currentStreak)} label={isFa ? "روز متوالی فعلی" : "current streak"} />
          <Achievement icon="◆" value={formatMetric(derived.masteredCount)} label={isFa ? "حوزه با تسلط ۸۰٪+" : "scopes at 80%+"} />
          <Achievement icon="↗" value={derived.strongest ? `${Math.round(derived.strongest.mastery_score_pct)}%` : "—"} label={derived.strongest?.scope_title || (isFa ? "قوی‌ترین حوزه ثبت‌شده" : "strongest recorded scope")} />
        </div>
      </section>

      <blockquote className="dashboard-quote" lang="fr" dir="ltr">Chaque jour, un petit progrès compte.</blockquote>
    </div>
  );
}

function OverallRing({value, isFa}: {value: number | null; isFa: boolean}) {
  const safe = value ?? 0;
  return (
    <div className="overall-ring-wrap">
      <svg className="overall-ring" viewBox="0 0 100 100" role="img" aria-label={value === null ? (isFa ? "تسلط کلی هنوز محاسبه نشده است" : "Overall mastery is not available yet") : `${isFa ? "تسلط کلی" : "Overall mastery"}: ${value}%`}>
        <circle className="overall-ring-track" cx="50" cy="50" r="41" pathLength="100" />
        <circle className="overall-ring-value" cx="50" cy="50" r="41" pathLength="100" strokeDasharray={`${safe} ${100 - safe}`} />
      </svg>
      <span><strong>{value === null ? "—" : `${value}%`}</strong><small>{isFa ? "پیشرفت کلی" : "overall"}</small></span>
    </div>
  );
}

function MetricCard({icon, value, label, note, tone}: {icon: string; value: string; label: string; note: string; tone?: "danger"}) {
  return (
    <article className={`surface dashboard-metric${tone === "danger" ? " dashboard-metric-danger" : ""}`}>
      <span className="dashboard-metric-icon" aria-hidden="true">{icon}</span>
      <span><strong>{value}</strong><b>{label}</b><small>{note}</small></span>
    </article>
  );
}

function ScoreDial({value, label, tone}: {value: number; label: string; tone?: "warning"}) {
  return (
    <div className={`score-dial${tone ? " score-dial-warning" : ""}`}>
      <span style={{background: `conic-gradient(currentColor ${Math.max(0, Math.min(100, value))}%, var(--surface-soft) 0)`}}><i>{value}%</i></span>
      <small>{label}</small>
    </div>
  );
}

function WeeklyBars({points}: {points: TrendPoint[]}) {
  const max = Math.max(...points.map((point) => point.value), 1);
  return (
    <div className="weekly-bars" role="img" aria-label={points.map((point) => `${point.label}: ${point.value}`).join(", ")}>
      {points.map((point) => (
        <div className="weekly-bar-item" key={`${point.label}:${point.value}`}>
          <span className="weekly-bar-value">{point.value}</span>
          <span className="weekly-bar-track"><span style={{height: `${Math.max(8, Math.round((point.value / max) * 100))}%`}} /></span>
          <small>{point.label}</small>
        </div>
      ))}
    </div>
  );
}

function Achievement({icon, value, label}: {icon: string; value: string; label: string}) {
  return <article className="achievement-card"><span aria-hidden="true">{icon}</span><div><strong>{value}</strong><small>{label}</small></div></article>;
}

function EmptyDashboardState({children}: {children: React.ReactNode}) {
  return <div className="dashboard-empty-state"><span aria-hidden="true">· · ·</span><p>{children}</p></div>;
}

function actionFromDashboard(dashboard: DashboardEnvelope["data"], locale: Locale): DashboardAction {
  const isFa = locale === "fa";
  const code = String(dashboard.next_action || "REGULAR_PRACTICE");
  const dueCount = Number(dashboard.review_queue?.due_count ?? 0);
  const unresolvedCount = Number(dashboard.error_review?.unresolved_group_count ?? 0);
  const confidentLessons = dashboard.mastery
    .filter((item) => item.scope_type === "LESSON" && item.confidence >= 0.45 && (item.evidence_count ?? 0) > 0)
    .slice()
    .sort((a, b) => (
      a.mastery_score_pct - b.mastery_score_pct
      || b.confidence - a.confidence
      || String(a.scope_id).localeCompare(String(b.scope_id))
    ));
  const weakestLesson = confidentLessons[0] ?? null;

  switch (code) {
    case "OVERDUE_REVIEW":
      return {
        code,
        destination: `/${locale}/review`,
        reason: isFa
          ? `${dueCount} مرور به زمان انجام رسیده و در اولویت است.`
          : `${dueCount} review item(s) are due and take priority.`,
      };
    case "DUE_REVIEW":
      // Compatibility only: runtime v1.0.1 no longer selects raw unresolved
      // mistake groups ahead of the Stage 17 concept clock.
      return {
        code,
        destination: `/${locale}/review`,
        reason: isFa
          ? `${unresolvedCount} گروه خطای حل‌نشده برای مرور وجود دارد.`
          : `${unresolvedCount} unresolved error group(s) are ready for review.`,
      };
    case "CRITICAL_CONFIDENT_LESSON":
      return {
        code,
        destination: weakestLesson ? `/${locale}/lessons/${weakestLesson.scope_id}` : `/${locale}/tests/new`,
        reason: isFa
          ? "یک درس با شواهد کافی، تسلط کمتر از ۴۰٪ دارد."
          : "A lesson has sufficient evidence and mastery below 40%.",
      };
    case "WEAK_CONFIDENT_LESSON":
      return {
        code,
        destination: weakestLesson ? `/${locale}/lessons/${weakestLesson.scope_id}` : `/${locale}/tests/new`,
        reason: isFa
          ? "یک درس با شواهد کافی در بازه تسلط ضعیف قرار دارد."
          : "A lesson has sufficient evidence and is in the weak mastery range.",
      };
    case "DEVELOPING_LESSON":
      return {
        code,
        destination: weakestLesson ? `/${locale}/lessons/${weakestLesson.scope_id}` : `/${locale}/tests/new`,
        reason: isFa
          ? "یک درس با شواهد کافی هنوز در حال توسعه است."
          : "A lesson has sufficient evidence and is still developing.",
      };
    case "BUILD_EVIDENCE":
      return {
        code,
        destination: `/${locale}/tests/new`,
        reason: isFa
          ? "هنوز شواهد یادگیری کافی برای برچسب‌گذاری نقاط ضعف وجود ندارد."
          : "There is not enough learning evidence yet to label weaknesses.",
      };
    case "REGULAR_PRACTICE":
      return {
        code,
        destination: `/${locale}/tests/new`,
        reason: isFa
          ? "مرور فوری یا ضعف مطمئن شناسایی نشده است؛ تمرین منظم ادامه یابد."
          : "No urgent review or confident weakness is detected; continue regular practice.",
      };
    default:
      return {
        code,
        destination: `/${locale}/tests/new`,
        reason: isFa ? "تمرین بعدی شما آماده است." : "Your next practice is ready.",
      };
  }
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

function readDailyGoal(activity: LooseRecord): {completed: number | null; target: number} | null {
  const goal = asRecord(activity.daily_goal);
  const target = readNumber(goal, ["target", "goal", "total"]) ?? readNumber(activity, ["daily_goal_target", "goal_questions", "questions_target"]);
  if (target === null || target <= 0) return null;
  const completed = readNumber(goal, ["completed", "done", "current", "progress"]) ?? readNumber(activity, ["daily_goal_progress", "questions_today", "today_questions"]);
  return {completed, target};
}

function extractTrend(value: unknown, isFa: boolean): TrendPoint[] {
  const record = asRecord(value);
  const candidateKeys = ["days", "daily", "last_7_days", "week", "weekly", "series", "items"];
  for (const key of candidateKeys) {
    const candidate = record[key];
    if (!Array.isArray(candidate)) continue;
    const points = candidate.map((item, index) => {
      const label = readText(item, ["label", "day", "date", "name"]) ?? `${isFa ? "روز" : "Day"} ${index + 1}`;
      const amount = readNumber(item, ["questions_answered", "count", "value", "minutes", "activity"]);
      return amount === null ? null : {label: compactTrendLabel(label, isFa), value: Math.max(0, Math.round(amount))};
    }).filter((item): item is TrendPoint => item !== null);
    if (points.length) return points.slice(-7);
  }
  return [];
}

function compactTrendLabel(label: string, isFa: boolean): string {
  const date = new Date(label);
  if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat(isFa ? "fa-IR" : "en-CA", {weekday: "short"}).format(date);
  return label.length > 8 ? label.slice(0, 8) : label;
}

function readReviewItems(value: unknown): Array<{label: string; count: number | null}> {
  const record = asRecord(value);
  const raw = [record.items, record.topics, record.scopes].find(Array.isArray);
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === "string") return {label: item, count: null};
    const label = readText(item, ["scope_title", "lesson_title", "title", "label", "name", "scope_id", "review_type"]);
    if (!label) return null;
    return {label, count: readNumber(item, ["count", "due_count", "repetitions"])};
  }).filter((item): item is {label: string; count: number | null} => item !== null);
}

function formatMetric(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(value));
}

function humanizeAction(code: string): string {
  return code.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function scopeTypeLabel(scopeType: string | undefined, isFa: boolean): string {
  const labels: Record<string, [string, string]> = {
    SUBTOPIC: ["مبحث", "Subtopic"],
    LESSON: ["درس", "Lesson"],
    CATEGORY: ["دسته", "Category"],
    TAG: ["برچسب", "Tag"],
  };
  const label = labels[scopeType ?? ""];
  return label ? label[isFa ? 0 : 1] : (isFa ? "موضوع" : "Topic");
}

function looksFrench(value: string | null | undefined): boolean {
  return Boolean(value && /[A-Za-zÀ-ÿ]/.test(value));
}

"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState, type CSSProperties} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {DashboardEnvelope, NextActionEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./ProfileClient.module.css";

type CachedProfile = {
  savedAt: string;
  dashboard: DashboardEnvelope;
  nextAction: NextActionEnvelope;
};

type LooseRecord = Record<string, unknown>;
type TrendPoint = {label: string; value: number};
type MasteryItem = DashboardEnvelope["data"]["mastery"][number];

const PROFILE_CACHE_KEY = "gmp-profile-safe-snapshot-v1";

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : {};
}

function readNumber(record: LooseRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function formatNumber(value: number | null, isFa: boolean) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(isFa ? "fa-IR" : "en-CA", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: unknown, isFa: boolean) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(isFa ? "fa-IR" : "en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: unknown, isFa: boolean) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(isFa ? "fa-IR" : "en-CA", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function humanizeMode(value: unknown, isFa: boolean) {
  const mode = String(value ?? "").trim().toUpperCase();
  const labels: Record<string, [string, string]> = {
    ADAPTIVE: ["تطبیقی", "Adaptive"],
    CUSTOM: ["سفارشی", "Custom"],
    TCF: ["TCF", "TCF"],
    REVIEW: ["مرور", "Review"],
  };
  const pair = labels[mode];
  if (pair) return isFa ? pair[0] : pair[1];
  return mode ? mode.replaceAll("_", " ") : (isFa ? "تنظیم نشده" : "Not configured");
}

function extractTrend(value: unknown, isFa: boolean): TrendPoint[] {
  const points: TrendPoint[] = [];
  const pushPoint = (entry: unknown, index: number) => {
    const row = asRecord(entry);
    const number = readNumber(row, [
      "mastery_score_pct",
      "mastery_pct",
      "score_pct",
      "value",
      "score",
    ]);
    if (number === null) return;
    const rawLabel = row.label ?? row.date ?? row.captured_at ?? row.as_of ?? index + 1;
    const label = typeof rawLabel === "string"
      ? rawLabel.slice(0, 10)
      : new Intl.NumberFormat(isFa ? "fa-IR" : "en-CA").format(Number(rawLabel));
    points.push({label, value: Math.max(0, Math.min(100, number))});
  };

  if (Array.isArray(value)) value.forEach(pushPoint);
  else {
    const record = asRecord(value);
    const candidates = record.points ?? record.items ?? record.series ?? record.snapshots;
    if (Array.isArray(candidates)) candidates.forEach(pushPoint);
  }
  return points.slice(-8);
}

function evidenceItems(items: MasteryItem[]) {
  return items.filter((item) => item.confidence > 0 && item.coverage_ratio > 0);
}

function itemTitle(item: MasteryItem | null, isFa: boolean) {
  if (!item) return isFa ? "هنوز داده کافی نیست" : "Not enough evidence yet";
  return item.scope_title || `${item.scope_type} · ${item.scope_id}`;
}

function masteryTone(score: number) {
  if (score >= 80) return "strong";
  if (score >= 60) return "developing";
  if (score >= 45) return "watch";
  return "weak";
}

function TrendChart({points, isFa}: {points: TrendPoint[]; isFa: boolean}) {
  if (points.length < 2) {
    return (
      <div className={styles.chartEmpty}>
        <span aria-hidden="true">⌁</span>
        <p>{isFa ? "با ثبت چند snapshot، روند پیشرفت اینجا نمایش داده می‌شود." : "Your progress trend appears after a few saved snapshots."}</p>
      </div>
    );
  }

  const width = 100;
  const height = 38;
  const xStep = width / Math.max(1, points.length - 1);
  const polyline = points
    .map((point, index) => `${(index * xStep).toFixed(2)},${(height - (point.value / 100) * height).toFixed(2)}`)
    .join(" ");
  const area = `0,${height} ${polyline} ${width},${height}`;

  return (
    <div className={styles.chartWrap}>
      <svg className={styles.trendSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={isFa ? "نمودار روند تسلط" : "Mastery trend chart"} preserveAspectRatio="none">
        <line x1="0" y1="9.5" x2="100" y2="9.5" className={styles.gridLine} />
        <line x1="0" y1="19" x2="100" y2="19" className={styles.gridLine} />
        <line x1="0" y1="28.5" x2="100" y2="28.5" className={styles.gridLine} />
        <polygon points={area} className={styles.trendArea} />
        <polyline points={polyline} className={styles.trendLine} />
        {points.map((point, index) => (
          <circle key={`${point.label}-${index}`} cx={index * xStep} cy={height - (point.value / 100) * height} r="1.35" className={styles.trendDot} />
        ))}
      </svg>
      <div className={styles.chartLabels}>
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function MasteryRows({items, isFa}: {items: MasteryItem[]; isFa: boolean}) {
  if (!items.length) {
    return <p className={styles.emptyCopy}>{isFa ? "هنوز داده تسلط قابل اتکایی وجود ندارد." : "No reliable mastery evidence yet."}</p>;
  }
  return (
    <div className={styles.masteryRows}>
      {items.map((item) => {
        const score = Math.round(item.mastery_score_pct);
        return (
          <div className={styles.masteryRow} key={`${item.scope_type}:${item.scope_id}`}>
            <div className={styles.masteryCopy}>
              <strong dir="auto">{item.scope_title || item.scope_type}</strong>
              <span>{isFa ? "اطمینان" : "Confidence"} {Math.round(item.confidence * 100)}%</span>
            </div>
            <div className={styles.masteryTrack} aria-label={`${score}%`}>
              <span className={styles[`tone_${masteryTone(score)}`]} style={{inlineSize: `${score}%`}} />
            </div>
            <strong className={styles.masteryScore}>{formatNumber(score, isFa)}%</strong>
          </div>
        );
      })}
    </div>
  );
}

export function ProfileClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [data, setData] = useState<CachedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboard, nextAction] = await Promise.all([
        apiRequest<DashboardEnvelope>("/api/backend/dashboard"),
        apiRequest<NextActionEnvelope>("/api/backend/next-actions/current"),
      ]);
      if (!dashboard || !nextAction) {
        throw new ApiError({status: 502, code: "EMPTY_PROFILE_SOURCE", message: "Profile learning data was empty."});
      }
      const snapshot = {savedAt: new Date().toISOString(), dashboard, nextAction};
      sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(snapshot));
      setData(snapshot);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Profile loading failed."}));
      const cached = sessionStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        try {
          setData(JSON.parse(cached) as CachedProfile);
        } catch {
          sessionStorage.removeItem(PROFILE_CACHE_KEY);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const derived = useMemo(() => {
    if (!data) return null;
    const dashboard = data.dashboard.data;
    const evidence = evidenceItems(dashboard.mastery);
    const sorted = [...evidence].sort((a, b) => a.mastery_score_pct - b.mastery_score_pct);
    const weak = sorted.slice(0, 5);
    const strong = [...sorted].reverse().slice(0, 3);
    const overall = evidence.length
      ? Math.round(evidence.reduce((sum, item) => sum + item.mastery_score_pct, 0) / evidence.length)
      : null;
    const activity = asRecord(dashboard.activity);
    const rawDashboard = asRecord(dashboard);
    const reviewQueue = asRecord(dashboard.review_queue);
    const recentTest = asRecord(dashboard.recent_test);
    const inProgress = asRecord(dashboard.in_progress_attempt);
    const questions = readNumber(activity, ["questions_answered", "total_questions", "questions_total"]);
    const sessions = readNumber(activity, ["completed_attempts", "attempts_completed", "sessions", "session_count"]);
    const streak = readNumber(activity, ["current_streak_days", "streak_days", "streak"]);
    const studyMinutes = readNumber(activity, ["study_minutes", "learning_minutes", "total_minutes"]);
    const due = readNumber(reviewQueue, ["due_count"]) ?? 0;
    const trend = extractTrend(dashboard.trend, isFa);
    const profileLocale = String(rawDashboard.profile_locale ?? (isFa ? "fa-IR" : "en-CA"));
    return {
      dashboard,
      evidence,
      weak,
      strong,
      overall,
      activity,
      questions,
      sessions,
      streak,
      studyMinutes,
      due,
      trend,
      recentTest,
      inProgress,
      profileLocale,
      weakest: weak[0] ?? null,
      strongest: strong[0] ?? null,
    };
  }, [data, isFa]);

  if (loading && !data) {
    return <LoadingCard label={isFa ? "بارگذاری پروفایل یادگیری" : "Loading learner profile"} />;
  }

  if (!data || !derived) {
    return (
      <StatusPanel
        title={error?.status === 401 ? (isFa ? "برای دیدن پروفایل وارد شوید" : "Log in to view your profile") : (error?.message ?? (isFa ? "پروفایل در دسترس نیست" : "Profile unavailable"))}
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

  const action = data.nextAction.data;
  const overallPct = derived.overall ?? 0;
  const ringStyle = {"--profile-mastery": `${overallPct}%`} as CSSProperties;
  const recentScore = readNumber(derived.recentTest, ["score_pct"]);
  const recentMode = humanizeMode(derived.recentTest.mode, isFa);
  const joinedDate = "—"; // The current Stage21 learner contract does not expose account creation date.
  const currentLevel = "B1";
  const targetLevel = "B2";

  const activityItems = [
    derived.recentTest.attempt_id ? {
      icon: "✓",
      title: isFa ? "آخرین آزمون کامل‌شده" : "Latest completed test",
      detail: recentScore === null
        ? recentMode
        : `${recentMode} · ${formatNumber(Math.round(recentScore), isFa)}%`,
      when: formatDateTime(derived.recentTest.completed_at, isFa),
      tone: "success",
    } : null,
    derived.inProgress.attempt_id ? {
      icon: "↻",
      title: isFa ? "یک آزمون نیمه‌تمام دارید" : "You have an unfinished attempt",
      detail: isFa ? "برای ادامه از همان‌جا بازش کنید." : "Resume from where you left off.",
      when: formatDateTime(derived.inProgress.started_at, isFa),
      tone: "info",
    } : null,
    derived.due > 0 ? {
      icon: "⌁",
      title: isFa ? `${formatNumber(derived.due, true)} مرور سررسیدشده` : `${derived.due} reviews due`,
      detail: isFa ? "صف مرور آماده تمرین است." : "Your review queue is ready.",
      when: isFa ? "اکنون" : "Now",
      tone: "warning",
    } : null,
  ].filter(Boolean) as Array<{icon: string; title: string; detail: string; when: string; tone: string}>;

  return (
    <div className={styles.profilePage}>
      {error ? (
        <StatusPanel
          title={isFa ? "نمای ذخیره‌شده پروفایل نمایش داده می‌شود" : "Showing the last safe profile snapshot"}
          tone="warning"
          requestId={error.requestId}
          action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
        >
          <p>{formatDateTime(data.savedAt, isFa)}</p>
        </StatusPanel>
      ) : null}

      <section className={styles.identityCard} aria-labelledby="profile-title">
        <div className={styles.avatar} aria-hidden="true">GM</div>
        <div className={styles.identityCopy}>
          <div className={styles.identityTitleRow}>
            <div>
              <p className={styles.eyebrow}>{isFa ? "پروفایل یادگیرنده" : "Learner profile"}</p>
              <h1 id="profile-title">{isFa ? "زبان‌آموز Grammar Mastery" : "Grammar Mastery Learner"}</h1>
            </div>
            <span className={styles.levelBadge}>{isFa ? "سطح فعلی" : "Current"} · {currentLevel}</span>
          </div>
          <p className={styles.identityLead}>
            {isFa
              ? "نمایی متمرکز از مسیر گرامر، تسلط، استمرار و تمرکز بعدی شما."
              : "A learner-centered view of your grammar path, mastery, consistency, and next focus."}
          </p>
          <dl className={styles.identityMeta}>
            <div><dt>{isFa ? "مسیر سطح" : "Level path"}</dt><dd dir="ltr">{currentLevel} → {targetLevel}</dd></div>
            <div><dt>{isFa ? "زبان یادگیری" : "Learning language"}</dt><dd>Français</dd></div>
            <div><dt>{isFa ? "زبان رابط" : "Interface"}</dt><dd>{derived.profileLocale.toLowerCase().startsWith("fa") ? "فارسی" : "English"}</dd></div>
            <div title={isFa ? "تاریخ عضویت در قرارداد فعلی API ارائه نمی‌شود." : "Joined date is not exposed by the current API contract."}><dt>{isFa ? "عضویت از" : "Joined"}</dt><dd>{joinedDate}</dd></div>
          </dl>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.primaryAction} href={`/${locale}/progress`}>{isFa ? "مشاهده پیشرفت" : "View progress"}</Link>
          <Link className={styles.secondaryAction} href={`/${locale}/settings`}>{isFa ? "تنظیمات" : "Settings"}</Link>
        </div>
      </section>

      <nav className={styles.profileTabs} aria-label={isFa ? "بخش‌های پروفایل" : "Profile sections"}>
        <span aria-current="page">{isFa ? "خلاصه" : "Overview"}</span>
        <Link href={`/${locale}/progress`}>{isFa ? "پیشرفت" : "Progress"}</Link>
        <Link href={`/${locale}/history`}>{isFa ? "تاریخچه" : "History"}</Link>
        <Link href={`/${locale}/settings`}>{isFa ? "تنظیمات" : "Settings"}</Link>
      </nav>

      <section className={styles.metricsGrid} aria-label={isFa ? "آمار کلی یادگیری" : "Learning summary"}>
        <article className={styles.metricCard}>
          <div className={styles.masteryRing} style={ringStyle}><span>{derived.overall === null ? "—" : `${formatNumber(derived.overall, isFa)}%`}</span></div>
          <div><span>{isFa ? "تسلط کلی" : "Overall mastery"}</span><small>{isFa ? "میانگین حوزه‌های دارای شواهد" : "evidence-bearing scopes"}</small></div>
        </article>
        <article className={styles.metricCard}><b aria-hidden="true">▤</b><div><strong>{formatNumber(derived.questions, isFa)}</strong><span>{isFa ? "سؤال پاسخ‌داده‌شده" : "Questions answered"}</span></div></article>
        <article className={styles.metricCard}><b aria-hidden="true">◫</b><div><strong>{formatNumber(derived.sessions, isFa)}</strong><span>{isFa ? "جلسه کامل‌شده" : "Completed sessions"}</span></div></article>
        <article className={styles.metricCard}><b aria-hidden="true">◷</b><div><strong>{derived.studyMinutes === null ? "—" : `${formatNumber(Math.round(derived.studyMinutes / 60), isFa)}h`}</strong><span>{isFa ? "زمان مطالعه" : "Study time"}</span></div></article>
        <article className={styles.metricCard}><b aria-hidden="true">⌁</b><div><strong>{formatNumber(derived.due, isFa)}</strong><span>{isFa ? "مرور سررسیدشده" : "Reviews due"}</span></div></article>
        <article className={styles.metricCard}><b aria-hidden="true">🔥</b><div><strong>{formatNumber(derived.streak, isFa)}</strong><span>{isFa ? "روز متوالی" : "Day streak"}</span></div></article>
      </section>

      <div className={styles.contentGrid}>
        <div className={styles.mainColumn}>
          <section className={styles.surfaceCard} aria-labelledby="profile-trend-title">
            <div className={styles.cardHeading}>
              <div><p className={styles.eyebrow}>{isFa ? "روند زمانی" : "Time trend"}</p><h2 id="profile-trend-title">{isFa ? "نمودار پیشرفت" : "Progress trend"}</h2></div>
              <Link href={`/${locale}/progress`}>{isFa ? "جزئیات" : "Details"}</Link>
            </div>
            <TrendChart points={derived.trend} isFa={isFa} />
          </section>

          <section className={styles.surfaceCard} aria-labelledby="profile-focus-title">
            <div className={styles.cardHeading}>
              <div><p className={styles.eyebrow}>{isFa ? "تمرکز پیشنهادی" : "Suggested focus"}</p><h2 id="profile-focus-title">{isFa ? "حوزه‌هایی که بیشترین توجه را می‌خواهند" : "Areas that need the most attention"}</h2></div>
              <Link href={action.destination}>{isFa ? "تمرین بعدی" : "Next practice"}</Link>
            </div>
            <MasteryRows items={derived.weak} isFa={isFa} />
          </section>

          <section className={styles.surfaceCard} aria-labelledby="profile-goals-title">
            <div className={styles.cardHeading}>
              <div><p className={styles.eyebrow}>{isFa ? "ترجیحات یادگیری" : "Learning preferences"}</p><h2 id="profile-goals-title">{isFa ? "هدف‌ها و شیوه تمرین" : "Goals & practice mode"}</h2></div>
              <Link href={`/${locale}/settings`}>{isFa ? "ویرایش در تنظیمات" : "Edit in settings"}</Link>
            </div>
            <div className={styles.preferenceGrid}>
              <div>
                <span className={styles.preferenceIcon} aria-hidden="true">◎</span>
                <div><strong>{isFa ? "هدف‌های یادگیری" : "Learning goals"}</strong><p>{isFa ? "هدف ذخیره‌شده در قرارداد فعلی پروفایل در دسترس نیست." : "Saved learning goals are not exposed by the current profile contract."}</p></div>
              </div>
              <div>
                <span className={styles.preferenceIcon} aria-hidden="true">⚙</span>
                <div><strong>{isFa ? "حالت تمرین ترجیحی" : "Preferred practice mode"}</strong><p>{derived.recentTest.mode ? (isFa ? `آخرین حالت استفاده‌شده: ${recentMode}` : `Last used mode: ${recentMode}`) : (isFa ? "هنوز تنظیم نشده است." : "Not configured yet.")}</p></div>
              </div>
              <div className={styles.recommendedGoal}>
                <span className={styles.preferenceIcon} aria-hidden="true">→</span>
                <div><strong>{isFa ? "تمرکز پیشنهادی سیستم" : "System-recommended focus"}</strong><p dir="auto">{itemTitle(derived.weakest, isFa)}</p></div>
              </div>
            </div>
          </section>
        </div>

        <aside className={styles.sideColumn}>
          <section className={styles.surfaceCard} aria-labelledby="profile-strength-title">
            <div className={styles.cardHeading}><div><p className={styles.eyebrow}>{isFa ? "خلاصه مهارت" : "Skill summary"}</p><h2 id="profile-strength-title">{isFa ? "قوت‌ها و ضعف‌ها" : "Strengths & weaknesses"}</h2></div></div>
            <div className={styles.summaryBlock}>
              <span className={styles.goodLabel}>✓ {isFa ? "قوی‌ترین" : "Strongest"}</span>
              <strong dir="auto">{itemTitle(derived.strongest, isFa)}</strong>
              {derived.strongest ? <small>{formatNumber(Math.round(derived.strongest.mastery_score_pct), isFa)}% {isFa ? "تسلط" : "mastery"}</small> : null}
            </div>
            <div className={styles.summaryBlock}>
              <span className={styles.weakLabel}>! {isFa ? "نیازمند توجه" : "Needs attention"}</span>
              <strong dir="auto">{itemTitle(derived.weakest, isFa)}</strong>
              {derived.weakest ? <small>{formatNumber(Math.round(derived.weakest.mastery_score_pct), isFa)}% {isFa ? "تسلط" : "mastery"}</small> : null}
            </div>
            <Link className={styles.cardFooterLink} href={`/${locale}/progress`}>{isFa ? "مشاهده همه حوزه‌ها" : "View all mastery areas"}</Link>
          </section>

          <section className={styles.surfaceCard} aria-labelledby="profile-activity-title">
            <div className={styles.cardHeading}><div><p className={styles.eyebrow}>{isFa ? "فعالیت اخیر" : "Recent activity"}</p><h2 id="profile-activity-title">{isFa ? "آخرین اتفاق‌های یادگیری" : "Latest learning activity"}</h2></div></div>
            {activityItems.length ? (
              <div className={styles.activityList}>
                {activityItems.map((entry, index) => (
                  <div className={styles.activityItem} key={`${entry.title}-${index}`}>
                    <span className={`${styles.activityIcon} ${styles[`activity_${entry.tone}`]}`} aria-hidden="true">{entry.icon}</span>
                    <div><strong>{entry.title}</strong><p>{entry.detail}</p><small>{entry.when}</small></div>
                  </div>
                ))}
              </div>
            ) : <p className={styles.emptyCopy}>{isFa ? "هنوز فعالیت قابل نمایش وجود ندارد." : "No recent learning activity yet."}</p>}
            <Link className={styles.cardFooterLink} href={`/${locale}/history`}>{isFa ? "مشاهده تاریخچه" : "View history"}</Link>
          </section>

          <section className={`${styles.surfaceCard} ${styles.nextActionCard}`} aria-labelledby="profile-next-title">
            <p className={styles.eyebrow}>{isFa ? "اقدام بعدی" : "Next action"}</p>
            <h2 id="profile-next-title">{isFa ? "بهترین حرکت بعدی شما" : "Your best next move"}</h2>
            <p>{action.reason}</p>
            <Link className={styles.primaryAction} href={action.destination}>{isFa ? "ادامه مسیر" : "Continue learning"}</Link>
          </section>
        </aside>
      </div>

      <p className={styles.dataNote}>
        {isFa
          ? `آخرین snapshot: ${formatDate(data.dashboard.data.as_of, true)}. برای حفظ حریم خصوصی، اطلاعات هویتی حساس اضافه نمایش داده نمی‌شود.`
          : `Latest snapshot: ${formatDate(data.dashboard.data.as_of, false)}. Extra sensitive identity data is intentionally not shown.`}
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import styles from "./StreakDetailClient.module.css";

type DayActivity = {
  date: string;
  questions_answered: number;
  practice_seconds: number;
  timed_answer_count: number;
  active: boolean;
};

type StreakDetailData = {
  as_of: string;
  timezone: string;
  policy: {
    streak_rule: "ACTIVE_DAY";
    active_day_definition: string;
  };
  current_streak_days: number;
  longest_streak_days: number;
  streak_status: "ACTIVE_TODAY" | "AT_RISK_TODAY" | "BROKEN";
  today: {
    questions_answered: number;
    question_delta_vs_yesterday: number;
    practice_seconds: number;
    timed_answer_count: number;
    timing_coverage_ratio: number | null;
  };
  consistency_30d: {
    active_days: number;
    total_days: number;
    rate_pct: number;
    days: DayActivity[];
  };
  week: {
    days: DayActivity[];
    average_practice_seconds: number;
  };
  milestones: {
    achieved_days: number[];
    next_days: number | null;
    remaining_days: number;
    progress_pct: number;
  };
};

type StreakDetailEnvelope = {
  data: StreakDetailData;
  meta: {
    request_id: string;
    api_version: string;
  };
};

type Copy = ReturnType<typeof copyFor>;

const GOAL_STORAGE_KEY = "gmp-daily-goal-minutes-v1";
const DEFAULT_GOAL_MINUTES = 20;
const MIN_GOAL_MINUTES = 5;
const MAX_GOAL_MINUTES = 120;

export function StreakDetailClient({locale}: {locale: Locale}) {
  const copy = copyFor(locale);
  const isFa = locale === "fa";
  const [payload, setPayload] = useState<StreakDetailEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [goalMinutes, setGoalMinutes] = useState(DEFAULT_GOAL_MINUTES);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState(String(DEFAULT_GOAL_MINUTES));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<StreakDetailEnvelope>("/api/backend/streak");
      if (!result) {
        throw new ApiError({
          status: 502,
          code: "EMPTY_STREAK_DETAIL",
          message: "Streak detail data was empty.",
        });
      }
      setPayload(result);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({
              status: 0,
              code: "NETWORK_ERROR",
              message: "Streak detail loading failed.",
            }),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(GOAL_STORAGE_KEY);
    const parsed = stored === null ? NaN : Number(stored);
    if (Number.isFinite(parsed) && parsed >= MIN_GOAL_MINUTES && parsed <= MAX_GOAL_MINUTES) {
      setGoalMinutes(Math.round(parsed));
      setGoalDraft(String(Math.round(parsed)));
    }
    void load();
  }, [load]);

  const derived = useMemo(() => {
    if (!payload) return null;
    const data = payload.data;
    const practiceMinutes = data.today.practice_seconds / 60;
    const progress = goalMinutes > 0 ? Math.min(100, Math.round((practiceMinutes / goalMinutes) * 100)) : 0;
    const remaining = Math.max(0, goalMinutes - practiceMinutes);
    const weekly = data.week.days.slice(-7);
    const weeklyMax = Math.max(...weekly.map((item) => item.practice_seconds), 60);
    return {data, practiceMinutes, progress, remaining, weekly, weeklyMax};
  }, [goalMinutes, payload]);

  if (loading && !payload) {
    return <StreakSkeleton copy={copy} isFa={isFa} />;
  }

  if (!payload || !derived) {
    return (
      <main className={styles.page} dir={isFa ? "rtl" : "ltr"}>
        <div className={styles.shell}>
          <Link className={styles.backLink} href={`/${locale}/dashboard`}>
            <ArrowIcon mirrored={isFa} /> {copy.back}
          </Link>
          <section className={styles.errorCard} role="alert">
            <strong>{error?.status === 401 ? copy.loginRequired : copy.unavailable}</strong>
            <p>{error?.message ?? copy.unavailableDetail}</p>
            {error?.status === 401 ? (
              <Link className={styles.primaryButton} href={`/${locale}/login`}>{copy.login}</Link>
            ) : (
              <button className={styles.primaryButton} type="button" onClick={() => void load()}>{copy.retry}</button>
            )}
          </section>
        </div>
      </main>
    );
  }

  const {data, practiceMinutes, progress, remaining, weekly, weeklyMax} = derived;
  const active30 = data.consistency_30d.active_days;
  const total30 = data.consistency_30d.total_days;
  const milestoneLabel = data.milestones.next_days
    ? copy.milestoneName(data.milestones.next_days)
    : copy.allMilestones;
  const timingCoverage = data.today.timing_coverage_ratio;
  const timingIncomplete = timingCoverage !== null && timingCoverage < 0.8;

  const saveGoal = () => {
    const parsed = Math.round(Number(goalDraft));
    if (!Number.isFinite(parsed)) return;
    const bounded = Math.min(MAX_GOAL_MINUTES, Math.max(MIN_GOAL_MINUTES, parsed));
    window.localStorage.setItem(GOAL_STORAGE_KEY, String(bounded));
    setGoalMinutes(bounded);
    setGoalDraft(String(bounded));
    setGoalDialogOpen(false);
  };

  return (
    <main className={styles.page} dir={isFa ? "rtl" : "ltr"}>
      <div className={styles.shell}>
        <div className={styles.topRow}>
          <Link className={styles.backLink} href={`/${locale}/dashboard`}>
            <ArrowIcon mirrored={isFa} /> {copy.back}
          </Link>
          {error ? (
            <button className={styles.refreshButton} type="button" onClick={() => void load()}>
              {copy.refresh}
            </button>
          ) : null}
        </div>

        <header className={styles.intro}>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </header>

        <section className={styles.kpiGrid} aria-label={copy.summaryAria}>
          <KpiCard
            label={copy.todayGoal}
            value={`${formatMinutes(practiceMinutes, locale)} / ${formatNumber(goalMinutes, locale)} ${copy.minutes}`}
            accent="green"
            accessory={`${formatNumber(progress, locale)}%`}
            icon={<GoalIcon />}
          />
          <KpiCard
            label={copy.currentStreak}
            value={`${formatNumber(data.current_streak_days, locale)} ${copy.days}`}
            accent="orange"
            accessory={<FlameMiniIcon />}
            icon={<FlameIcon />}
          />
          <KpiCard
            label={copy.longestStreak}
            value={`${formatNumber(data.longest_streak_days, locale)} ${copy.days}`}
            accent="purple"
            accessory="★"
            icon={<StarIcon />}
          />
          <KpiCard
            label={copy.todayQuestions}
            value={`${formatNumber(data.today.questions_answered, locale)} ${copy.questions}`}
            accent="blue"
            accessory={formatSigned(data.today.question_delta_vs_yesterday, locale)}
            icon={<QuestionIcon />}
          />
        </section>

        <section className={styles.middleGrid}>
          <article className={`${styles.card} ${styles.goalCard}`}>
            <h2>{copy.dailyProgress}</h2>
            <div className={styles.goalBody}>
              <GoalDonut progress={progress} value={`${formatNumber(progress, locale)}%`} caption={`${formatMinutes(practiceMinutes, locale)} ${copy.of} ${formatNumber(goalMinutes, locale)} ${copy.minutes}`} />
              <dl className={styles.goalFacts}>
                <div>
                  <dt>{copy.timeToday}</dt>
                  <dd>{formatMinutes(practiceMinutes, locale)} {copy.minutes}</dd>
                </div>
                <div>
                  <dt>{copy.questionsAnswered}</dt>
                  <dd>{formatNumber(data.today.questions_answered, locale)} {copy.questions}</dd>
                </div>
                <div>
                  <dt>{copy.remaining}</dt>
                  <dd className={styles.warningValue}>{formatMinutes(remaining, locale)} {copy.minutes}</dd>
                </div>
              </dl>
            </div>
            {timingIncomplete ? (
              <p className={styles.dataNote}>{copy.timingWarning(Math.round((timingCoverage ?? 0) * 100))}</p>
            ) : null}
          </article>

          <article className={`${styles.card} ${styles.consistencyCard}`}>
            <div className={styles.cardHeadingInline}>
              <h2>{copy.consistency30}</h2>
              <span className={styles.subtleBadge}>{formatNumber(data.consistency_30d.rate_pct, locale)}%</span>
            </div>
            <ConsistencyGrid days={data.consistency_30d.days} locale={locale} copy={copy} />
            <div className={styles.consistencyFooter}>
              <strong>{copy.activeDays(active30, total30)}</strong>
              <span>{copy.consistencyRate}: {formatNumber(data.consistency_30d.rate_pct, locale)}%</span>
            </div>
          </article>

          <article className={`${styles.card} ${styles.milestoneCard}`}>
            <h2>{copy.nextMilestone}</h2>
            <div className={styles.milestonePanel}>
              <strong>{milestoneLabel}</strong>
              <span>{data.milestones.next_days ? copy.daysToMilestone(data.milestones.remaining_days) : copy.allMilestonesDone}</span>
              <div className={styles.progressTrack} aria-label={`${copy.milestoneProgress} ${data.milestones.progress_pct}%`}>
                <span style={{width: `${data.milestones.progress_pct}%`}} />
              </div>
            </div>
            <div className={styles.milestoneSteps}>
              {[7, 14, 30, 60].map((days) => (
                <span
                  className={data.milestones.achieved_days.includes(days) ? styles.milestoneDone : undefined}
                  key={days}
                >
                  {formatNumber(days, locale)} {copy.days}
                </span>
              ))}
            </div>
          </article>
        </section>

        <section className={styles.bottomGrid}>
          <article className={`${styles.card} ${styles.weekCard}`}>
            <div className={styles.weekHeader}>
              <h2>{copy.weeklyTrend}</h2>
              <div>
                <span>{copy.dailyAverage}</span>
                <strong>{formatMinutes(data.week.average_practice_seconds / 60, locale)} {copy.minutes}</strong>
              </div>
            </div>
            <WeeklyBars days={weekly} maxSeconds={weeklyMax} locale={locale} copy={copy} />
          </article>

          <article className={`${styles.card} ${styles.safetyCard}`}>
            <h2>{copy.streakSafety}</h2>
            <div className={styles.policyPanel}>
              <strong>{copy.missedDayPolicy}</strong>
              <p>{copy.policyDescription(data.streak_status)}</p>
              <small>{copy.policyTechnical}: {data.policy.active_day_definition}</small>
            </div>
            <div className={styles.safetyActions}>
              <Link className={styles.primaryButton} href={`/${locale}/tests/new`}>{copy.continuePractice}</Link>
              <button className={styles.secondaryButton} type="button" onClick={() => setGoalDialogOpen(true)}>{copy.setDailyGoal}</button>
            </div>
          </article>
        </section>

        <p className={styles.timezoneNote}>{copy.timezone}: <b dir="ltr">{data.timezone}</b></p>
      </div>

      {goalDialogOpen ? (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={() => setGoalDialogOpen(false)}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="daily-goal-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.dialogHeader}>
              <h2 id="daily-goal-dialog-title">{copy.setDailyGoal}</h2>
              <button type="button" className={styles.iconButton} aria-label={copy.close} onClick={() => setGoalDialogOpen(false)}>×</button>
            </div>
            <p>{copy.goalDialogHint}</p>
            <label className={styles.goalInputLabel}>
              <span>{copy.minutesPerDay}</span>
              <input
                type="number"
                min={MIN_GOAL_MINUTES}
                max={MAX_GOAL_MINUTES}
                step={5}
                inputMode="numeric"
                value={goalDraft}
                onChange={(event) => setGoalDraft(event.target.value)}
              />
            </label>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setGoalDialogOpen(false)}>{copy.cancel}</button>
              <button type="button" className={styles.primaryButton} onClick={saveGoal}>{copy.save}</button>
            </div>
            <small>{copy.localGoalNote}</small>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function KpiCard({
  label,
  value,
  icon,
  accent,
  accessory,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: "green" | "orange" | "purple" | "blue";
  accessory: React.ReactNode;
}) {
  return (
    <article className={`${styles.kpiCard} ${styles[`accent${capitalize(accent)}`]}`}>
      <span className={styles.kpiIcon} aria-hidden="true">{icon}</span>
      <div className={styles.kpiCopy}>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <span className={styles.kpiAccessory}>{accessory}</span>
    </article>
  );
}

function GoalDonut({progress, value, caption}: {progress: number; value: string; caption: string}) {
  const safe = Math.max(0, Math.min(100, progress));
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const dash = (safe / 100) * circumference;
  return (
    <div className={styles.donutWrap}>
      <svg viewBox="0 0 120 120" role="img" aria-label={`${value} ${caption}`}>
        <circle className={styles.donutTrack} cx="60" cy="60" r={radius} />
        <circle
          className={styles.donutValue}
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <span><strong>{value}</strong><small>{caption}</small></span>
    </div>
  );
}

function ConsistencyGrid({days, locale, copy}: {days: DayActivity[]; locale: Locale; copy: Copy}) {
  const normalized = days.slice(-30);
  const firstDay = normalized[0];
  const padding = firstDay ? weekdayIndex(firstDay.date) : 0;
  return (
    <div className={styles.calendarWrap}>
      <div className={styles.weekdayHeader} aria-hidden="true">
        {copy.weekdayShort.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className={styles.consistencyGrid} role="list" aria-label={copy.consistency30}>
        {Array.from({length: padding}, (_, index) => <span className={styles.calendarSpacer} key={`pad-${index}`} />)}
        {normalized.map((day) => (
          <span
            className={day.active ? styles.dayActive : styles.dayRest}
            key={day.date}
            role="listitem"
            title={`${formatDate(day.date, locale)} — ${day.questions_answered} ${copy.questions}`}
            aria-label={`${formatDate(day.date, locale)}: ${day.active ? copy.active : copy.restDay}`}
          />
        ))}
      </div>
    </div>
  );
}

function WeeklyBars({days, maxSeconds, locale, copy}: {days: DayActivity[]; maxSeconds: number; locale: Locale; copy: Copy}) {
  return (
    <div className={styles.weeklyBars} role="img" aria-label={copy.weeklyTrend}>
      {days.map((day, index) => {
        const minutes = day.practice_seconds / 60;
        const height = day.practice_seconds === 0 ? 2 : Math.max(10, Math.round((day.practice_seconds / maxSeconds) * 100));
        return (
          <div className={styles.barItem} key={day.date}>
            <strong>{formatMinutes(minutes, locale)}</strong>
            <span className={styles.barTrack}>
              <span className={index === days.length - 2 ? styles.barHighlight : undefined} style={{height: `${height}%`}} />
            </span>
            <small>{copy.weekdayShort[weekdayIndex(day.date)]}</small>
          </div>
        );
      })}
    </div>
  );
}

function StreakSkeleton({copy, isFa}: {copy: Copy; isFa: boolean}) {
  return (
    <main className={styles.page} dir={isFa ? "rtl" : "ltr"} aria-busy="true">
      <div className={styles.shell}>
        <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
        <p className={styles.loadingText}>{copy.loading}</p>
        <div className={styles.kpiGrid}>
          {Array.from({length: 4}, (_, index) => <div className={`${styles.kpiCard} ${styles.skeleton}`} key={index} />)}
        </div>
        <div className={styles.middleGrid}>
          {Array.from({length: 3}, (_, index) => <div className={`${styles.card} ${styles.skeleton} ${styles.skeletonCard}`} key={index} />)}
        </div>
      </div>
    </main>
  );
}

function copyFor(locale: Locale) {
  if (locale === "fa") {
    return {
      back: "بازگشت به داشبورد",
      title: "هدف روزانه و زنجیره تمرین",
      subtitle: "استمرار تمرین را ببینید، هدف امروز را کامل کنید و milestone بعدی را دنبال کنید.",
      summaryAria: "خلاصه هدف روزانه و زنجیره",
      todayGoal: "هدف امروز",
      currentStreak: "Streak فعلی",
      longestStreak: "طولانی‌ترین Streak",
      todayQuestions: "سؤال امروز",
      minutes: "دقیقه",
      days: "روز",
      questions: "سؤال",
      dailyProgress: "پیشرفت هدف روزانه",
      timeToday: "زمان امروز",
      questionsAnswered: "سؤال پاسخ‌داده‌شده",
      remaining: "باقی‌مانده",
      of: "از",
      consistency30: "Consistency — ۳۰ روز اخیر",
      consistencyRate: "نرخ استمرار",
      activeDays: (active: number, total: number) => `${formatNumber(active, "fa")} روز فعال از ${formatNumber(total, "fa")} روز`,
      nextMilestone: "Milestone بعدی",
      milestoneName: (days: number) => `${formatNumber(days, "fa")}-Day Consistency`,
      daysToMilestone: (days: number) => `${formatNumber(days, "fa")} روز دیگر تا milestone`,
      milestoneProgress: "پیشرفت milestone",
      allMilestones: "تمام milestoneها کامل شده",
      allMilestonesDone: "زنجیره فعلی از milestoneهای نمایش‌داده‌شده عبور کرده است.",
      weeklyTrend: "روند هفتگی",
      dailyAverage: "میانگین روزانه",
      streakSafety: "Streak Safety",
      missedDayPolicy: "Missed-day policy",
      policyDescription: (status: StreakDetailData["streak_status"]) => status === "ACTIVE_TODAY"
        ? "امروز تمرین ثبت شده و زنجیره فعال است."
        : status === "AT_RISK_TODAY"
          ? "امروز هنوز تمرین ثبت نشده؛ تا پایان روز فرصت دارید زنجیره را حفظ کنید."
          : "زنجیره قبلی شکسته است؛ اولین روز تمرین، زنجیره تازه را شروع می‌کند.",
      policyTechnical: "قاعده",
      continuePractice: "ادامه تمرین",
      setDailyGoal: "تنظیم هدف روزانه",
      refresh: "تازه‌سازی",
      retry: "تلاش دوباره",
      unavailable: "جزئیات زنجیره فعلاً در دسترس نیست",
      unavailableDetail: "ارائه‌دهنده داده نتوانست جزئیات زنجیره را برگرداند.",
      loginRequired: "ابتدا وارد شوید",
      login: "ورود",
      loading: "در حال بارگذاری جزئیات زنجیره…",
      timingWarning: (pct: number) => `زمان تمرین از response time سؤال‌ها ساخته شده و پوشش زمان‌سنجی امروز ${formatNumber(pct, "fa")}% است؛ بنابراین دقیقه‌ها ممکن است کمتر از زمان واقعی باشند.`,
      timezone: "منطقه زمانی محاسبات",
      goalDialogHint: "یک هدف زمانی واقع‌بینانه انتخاب کنید. این هدف برای انگیزه است و روی محاسبه Streak اثر نمی‌گذارد.",
      minutesPerDay: "دقیقه در روز",
      cancel: "انصراف",
      save: "ذخیره",
      close: "بستن",
      localGoalNote: "در این نسخه، هدف روزانه در همین مرورگر ذخیره می‌شود تا بدون تغییر قرارداد Stage 21 قابل استفاده باشد.",
      active: "تمرین انجام شده",
      restDay: "بدون تمرین",
      weekdayShort: ["د", "س", "چ", "پ", "ج", "ش", "ی"],
    };
  }
  return {
    back: "Back to dashboard",
    title: "Daily goal & practice streak",
    subtitle: "See your consistency, finish today’s goal, and keep the next milestone in sight.",
    summaryAria: "Daily goal and streak summary",
    todayGoal: "Today’s goal",
    currentStreak: "Current streak",
    longestStreak: "Longest streak",
    todayQuestions: "Questions today",
    minutes: "min",
    days: "days",
    questions: "questions",
    dailyProgress: "Daily goal progress",
    timeToday: "Time today",
    questionsAnswered: "Questions answered",
    remaining: "Remaining",
    of: "of",
    consistency30: "Consistency — last 30 days",
    consistencyRate: "Consistency rate",
    activeDays: (active: number, total: number) => `${active} active days of ${total}`,
    nextMilestone: "Next milestone",
    milestoneName: (days: number) => `${days}-Day Consistency`,
    daysToMilestone: (days: number) => `${days} days to the milestone`,
    milestoneProgress: "Milestone progress",
    allMilestones: "All milestones completed",
    allMilestonesDone: "Your current streak is beyond the displayed milestones.",
    weeklyTrend: "Weekly trend",
    dailyAverage: "Daily average",
    streakSafety: "Streak Safety",
    missedDayPolicy: "Missed-day policy",
    policyDescription: (status: StreakDetailData["streak_status"]) => status === "ACTIVE_TODAY"
      ? "Practice is recorded today and your streak is active."
      : status === "AT_RISK_TODAY"
        ? "No practice is recorded yet today; you have until the end of the day to keep the streak."
        : "The previous streak is broken; the next active day starts a new streak.",
    policyTechnical: "Rule",
    continuePractice: "Continue practice",
    setDailyGoal: "Set daily goal",
    refresh: "Refresh",
    retry: "Retry",
    unavailable: "Streak detail is unavailable",
    unavailableDetail: "The data provider could not return streak details.",
    loginRequired: "Please log in first",
    login: "Log in",
    loading: "Loading streak detail…",
    timingWarning: (pct: number) => `Practice time is derived from question response time and today’s timed coverage is ${pct}%, so minutes may be understated.`,
    timezone: "Calculation timezone",
    goalDialogHint: "Choose a realistic time goal. It motivates practice but does not change streak calculation.",
    minutesPerDay: "Minutes per day",
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    localGoalNote: "In this version the daily goal is saved in this browser so the frozen Stage 21 contract stays unchanged.",
    active: "Practiced",
    restDay: "Rest day",
    weekdayShort: ["M", "T", "W", "T", "F", "S", "S"],
  };
}

function formatNumber(value: number, locale: Locale) {
  const localeCode = locale === "fa" ? "fa-IR" : "en-CA";
  return new Intl.NumberFormat(localeCode, {maximumFractionDigits: 0}).format(value);
}

function formatMinutes(value: number, locale: Locale) {
  const localeCode = locale === "fa" ? "fa-IR" : "en-CA";
  return new Intl.NumberFormat(localeCode, {maximumFractionDigits: value < 10 ? 1 : 0}).format(value);
}

function formatSigned(value: number, locale: Locale) {
  if (value === 0) return "±0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value), locale)}`;
}

function formatDate(isoDate: string, locale: Locale) {
  const date = new Date(`${isoDate}T12:00:00`);
  const localeCode = locale === "fa" ? "fa-IR" : "en-CA";
  return new Intl.DateTimeFormat(localeCode, {month: "short", day: "numeric"}).format(date);
}

function weekdayIndex(isoDate: string) {
  const day = new Date(`${isoDate}T12:00:00`).getDay();
  return day === 0 ? 6 : day - 1;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ArrowIcon({mirrored}: {mirrored: boolean}) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{transform: mirrored ? "scaleX(-1)" : undefined}}>
      <path d="M12.5 4.5 7 10l5.5 5.5M7.5 10H16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GoalIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/><path d="m16.5 7.5 3-3M17 4.5h2.5V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function FlameIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M12.2 3.2c.7 3-1.8 4.2-1 6.8.5 1.5 1.7 2.2 2.8 1.5 1.1-.7 1.4-2.3.8-3.8 3.2 2.1 5.2 5 4.4 8.1-.8 3.2-3.7 5.2-7.2 5.2-4.1 0-7.2-2.6-7.2-6.4 0-3.3 2.2-6.1 7.4-11.4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}
function FlameMiniIcon() {
  return <span aria-hidden="true">🔥</span>;
}
function StarIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="m12 3 2.5 5.3 5.7.7-4.2 4 1.1 5.8-5.1-2.9-5.1 2.9L8 13 3.8 9l5.7-.7L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}
function QuestionIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M8.8 8.3a3.5 3.5 0 0 1 6.7 1.4c0 2.4-3.5 2.7-3.5 5.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/><path d="M12 18.1h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7"/></svg>;
}

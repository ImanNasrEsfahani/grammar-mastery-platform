"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import type {CSSProperties} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {AttemptResultEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./AttemptResultClient.module.css";

type ResultData = AttemptResultEnvelope["data"];
type DifficultyRow = ResultData["difficulty_analysis"][number];
type SubtopicRow = ResultData["subtopic_analysis"][number];
type Band = SubtopicRow["mastery_band_after"];

type IconName =
  | "back"
  | "share"
  | "target"
  | "check"
  | "x"
  | "clock"
  | "review"
  | "spark"
  | "home"
  | "up"
  | "down"
  | "minus"
  | "warning"
  | "brain"
  | "list";

function Icon({name}: {name: IconName}) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "back") return <svg {...common}><path d="M15 18l-6-6 6-6"/></svg>;
  if (name === "share") return <svg {...common}><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.9l7.6-4.5M8.2 13.1l7.6 4.5"/></svg>;
  if (name === "target") return <svg {...common}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7M16 5h3v3"/></svg>;
  if (name === "check") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/></svg>;
  if (name === "x") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>;
  if (name === "clock") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  if (name === "review") return <svg {...common}><path d="M4 5h11a4 4 0 0 1 4 4v8"/><path d="M16 14l3 3 3-3"/><path d="M8 9H4v10h9"/></svg>;
  if (name === "spark") return <svg {...common}><path d="M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/></svg>;
  if (name === "home") return <svg {...common}><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>;
  if (name === "up") return <svg {...common}><path d="M12 19V5M6 11l6-6 6 6"/></svg>;
  if (name === "down") return <svg {...common}><path d="M12 5v14M6 13l6 6 6-6"/></svg>;
  if (name === "minus") return <svg {...common}><path d="M5 12h14"/></svg>;
  if (name === "warning") return <svg {...common}><path d="M12 3L2.8 20h18.4L12 3z"/><path d="M12 9v5M12 17h.01"/></svg>;
  if (name === "brain") return <svg {...common}><path d="M9 5a3 3 0 0 0-5 2.2A3.5 3.5 0 0 0 4.5 14 3 3 0 0 0 9 18V5zM15 5a3 3 0 0 1 5 2.2 3.5 3.5 0 0 1-.5 6.8A3 3 0 0 1 15 18V5z"/><path d="M9 9h6M9 14h6"/></svg>;
  return <svg {...common}><path d="M7 5h10M7 10h10M7 15h10M7 20h10"/></svg>;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  EASY: "var(--result-green)",
  MEDIUM: "var(--result-blue)",
  HARD: "var(--result-orange)",
  VERY_HARD: "var(--result-coral)",
};

function clamp(value: number, low = 0, high = 100) {
  return Math.max(low, Math.min(high, value));
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function duration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function milliseconds(value: number | null | undefined, isFa: boolean) {
  if (value == null) return "—";
  const seconds = value / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} ${isFa ? "ثانیه" : "s"}`;
}

function modeLabel(mode: string, isFa: boolean) {
  const normalized = mode.toLowerCase();
  const fa: Record<string, string> = {adaptive: "هوشمند", tcf: "TCF", custom: "سفارشی", review: "مرور", mistakes: "اشتباهات"};
  const en: Record<string, string> = {adaptive: "Adaptive", tcf: "TCF", custom: "Custom", review: "Review", mistakes: "Mistakes"};
  return (isFa ? fa : en)[normalized] ?? mode;
}

function difficultyLabel(value: string, isFa: boolean) {
  const fa: Record<string, string> = {EASY: "آسان", MEDIUM: "متوسط", HARD: "سخت", VERY_HARD: "خیلی سخت"};
  const en: Record<string, string> = {EASY: "Easy", MEDIUM: "Medium", HARD: "Hard", VERY_HARD: "Very hard"};
  return (isFa ? fa : en)[value] ?? value;
}

function bandMeta(band: Band, isFa: boolean) {
  const map = {
    NO_EVIDENCE: {icon: "○", fa: "بدون شواهد", en: "No evidence", tone: "neutral"},
    UNCERTAIN: {icon: "?", fa: "نامطمئن", en: "Uncertain", tone: "warning"},
    WEAK: {icon: "!", fa: "ضعیف", en: "Weak", tone: "danger"},
    DEVELOPING: {icon: "↗", fa: "در حال رشد", en: "Developing", tone: "primary"},
    STRONG: {icon: "✓", fa: "قوی", en: "Strong", tone: "success"},
  } as const;
  const item = map[band] ?? map.UNCERTAIN;
  return {...item, label: isFa ? item.fa : item.en};
}

function scoreMessage(score: number, isFa: boolean) {
  if (score >= 90) return isFa ? "عالی! عملکرد این جلسه بسیار قوی بود." : "Excellent — a very strong session.";
  if (score >= 75) return isFa ? "خیلی خوب! در مسیر درستی هستید." : "Very good — you are on the right track.";
  if (score >= 55) return isFa ? "خوب است؛ چند نقطهٔ مشخص برای تقویت دارید." : "Good — a few focused areas need reinforcement.";
  return isFa ? "این نتیجه چند نقطهٔ مناسب برای تمرین هدفمند نشان می‌دهد." : "This result reveals useful areas for focused practice.";
}

function titleFor(data: ResultData, isFa: boolean) {
  if (data.test_title) return data.test_title;
  const titles = data.lessons.map((lesson) => lesson.title_fr).filter(Boolean);
  if (!titles.length) return isFa ? "نتیجهٔ تمرین گرامر" : "Grammar practice result";
  if (titles.length <= 2) return titles.join(" · ");
  return isFa ? `${titles.slice(0, 2).join(" · ")} و ${titles.length - 2} درس دیگر` : `${titles.slice(0, 2).join(" · ")} + ${titles.length - 2} more`;
}

function subtopicDisplay(row: Pick<SubtopicRow, "subtopic_title_fr" | "subtopic_title_fa" | "subtopic_id">, isFa: boolean) {
  return (isFa ? row.subtopic_title_fa : row.subtopic_title_fr) || row.subtopic_title_fr || row.subtopic_title_fa || row.subtopic_id;
}

function QuestionTypeIcon({index}: {index: number}) {
  return <span className={styles.typeIcon} aria-hidden="true">{["▣", "◆", "⌘", "✦", "◇"][index % 5]}</span>;
}

export function AttemptResultClient({attemptId, locale}: {attemptId: string; locale: Locale}) {
  const isFa = locale === "fa";
  const [result, setResult] = useState<AttemptResultEnvelope | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareState, setShareState] = useState<"idle" | "done" | "failed">("idle");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<AttemptResultEnvelope>(`/api/backend/attempts/${attemptId}/result`);
      if (!response) throw new ApiError({status: 502, code: "EMPTY_RESULT", message: "The result was empty."});
      setResult(response);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Result loading failed."}));
    } finally {
      setLoading(false);
    }
  }, [attemptId]);

  // Keep bookmarked result routes synchronized with the owner-scoped completed attempt.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const data = result?.data;
  const weakLessonIds = useMemo(() => {
    if (!data) return [];
    const ids = data.weaknesses.map((item) => item.lesson_id).filter((value): value is string => Boolean(value));
    return [...new Set(ids.length ? ids : data.lessons.map((lesson) => lesson.id))];
  }, [data]);

  if (loading) return <LoadingCard label={isFa ? "در حال ساخت تحلیل نتیجه" : "Building result insights"} />;
  if (!data) {
    return (
      <StatusPanel
        title={error?.message ?? (isFa ? "نتیجه در دسترس نیست" : "Result unavailable")}
        tone="danger"
        requestId={error?.requestId}
        action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
      >
        <p>{error?.code}</p>
      </StatusPanel>
    );
  }

  const reviewHref = data.review_item_ids[0] ? `/${locale}/review/${data.review_item_ids[0]}` : `/${locale}/review`;
  const practiceParams = new URLSearchParams({mode: "adaptive", scope: weakLessonIds.length ? "lessons" : "all"});
  if (weakLessonIds.length) practiceParams.set("lessons", weakLessonIds.join(","));
  const practiceHref = `/${locale}/tests/new?${practiceParams.toString()}`;
  const date = new Date(data.completed_at).toLocaleString(isFa ? "fa-IR" : "en-CA", {dateStyle: "medium", timeStyle: "short"});
  const score = clamp(data.score_pct);
  const ringStyle = {"--score": score} as CSSProperties;
  const difficultyTotal = Math.max(1, data.difficulty_analysis.reduce((sum, row) => sum + row.total, 0));
  let difficultyCursor = 0;
  const difficultyStops = data.difficulty_analysis.map((row) => {
    const start = difficultyCursor;
    difficultyCursor += (row.total / difficultyTotal) * 100;
    return `${DIFFICULTY_COLORS[row.difficulty] ?? "var(--result-muted)"} ${start}% ${difficultyCursor}%`;
  });
  const difficultyDonutStyle = {"--difficulty-donut": `conic-gradient(${difficultyStops.join(", ")})`} as CSSProperties;

  async function share() {
    const shareData = {
      title: isFa ? "نتیجه تمرین Grammar Mastery" : "Grammar Mastery practice result",
      text: isFa ? `امتیاز من: ${Math.round(data.score_pct)}%` : `My score: ${Math.round(data.score_pct)}%`,
      url: window.location.href,
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else await navigator.clipboard.writeText(window.location.href);
      setShareState("done");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      setShareState("failed");
      window.setTimeout(() => setShareState("idle"), 1800);
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.topline}>
        <Link className={styles.backLink} href={`/${locale}/dashboard`}><Icon name="back" /> {isFa ? "نتایج تمرین" : "Practice results"}</Link>
        <button className={styles.shareButton} type="button" onClick={share} aria-live="polite">
          <Icon name="share" /> {shareState === "done" ? (isFa ? "لینک کپی شد" : "Link copied") : shareState === "failed" ? (isFa ? "اشتراک‌گذاری ناموفق" : "Share failed") : (isFa ? "اشتراک‌گذاری" : "Share")}
        </button>
      </div>

      <header className={styles.resultHeader}>
        <div>
          <p className={styles.eyebrow}>{isFa ? "تحلیل جلسهٔ تکمیل‌شده" : "Completed session insight"}</p>
          <h1 lang="fr" dir="ltr">{titleFor(data, isFa)}</h1>
          <div className={styles.sessionMeta}>
            <span>{data.question_count} {isFa ? "سؤال" : "questions"}</span>
            <span>•</span>
            <span>{modeLabel(data.mode, isFa)}</span>
            <span>•</span>
            <span><Icon name="clock" /> {duration(data.duration_seconds)}</span>
            <span>•</span>
            <time dateTime={data.completed_at}>{date}</time>
          </div>
        </div>
        <code className={styles.attemptId}>ID: {data.attempt_id}</code>
      </header>

      <div className={styles.resultGrid}>
        <aside className={styles.scoreCard} aria-label={isFa ? "خلاصه امتیاز" : "Score summary"}>
          <div className={styles.scoreRing} style={ringStyle} role="img" aria-label={`${Math.round(score)}%`}>
            <span>{Math.round(score)}%</span>
          </div>
          <p className={styles.scoreLabel}>{isFa ? "امتیاز شما" : "Your score"}</p>
          <strong className={styles.scoreFraction}>{data.correct_count} / {data.question_count}</strong>
          <p className={styles.scoreMessage}><span aria-hidden="true">🏆</span>{scoreMessage(score, isFa)}</p>
          <nav className={styles.scoreActions} aria-label={isFa ? "قدم بعدی" : "Next actions"}>
            <Link className={`${styles.action} ${styles.primaryAction}`} href={reviewHref}><Icon name="review" />{isFa ? "مرور اشتباهات" : "Review mistakes"}<span aria-hidden="true">›</span></Link>
            <Link className={`${styles.action} ${styles.secondaryAction}`} href={practiceHref}><Icon name="spark" />{isFa ? "تمرین ضعف‌ها" : "Practice weaknesses"}</Link>
            <Link className={`${styles.action} ${styles.secondaryAction}`} href={`/${locale}/dashboard`}><Icon name="home" />{isFa ? "بازگشت به داشبورد" : "Back to dashboard"}</Link>
          </nav>
        </aside>

        <div className={styles.mainColumn}>
          <section className={styles.kpiPanel} aria-label={isFa ? "شاخص‌های جلسه" : "Session metrics"}>
            <Metric icon="target" label={isFa ? "دقت" : "Accuracy"} value={percent(data.accuracy_pct)} tone="blue" />
            <Metric icon="check" label={isFa ? "پاسخ صحیح" : "Correct"} value={String(data.correct_count)} tone="green" />
            <Metric icon="x" label={isFa ? "پاسخ غلط" : "Incorrect"} value={String(data.incorrect_count)} tone="coral" />
            <Metric icon="clock" label={isFa ? "زمان" : "Duration"} value={duration(data.duration_seconds)} detail={isFa ? `میانگین پاسخ: ${milliseconds(data.average_response_ms, true)}` : `Avg answer: ${milliseconds(data.average_response_ms, false)}`} tone="blue" />
          </section>

          <div className={styles.analysisRow}>
            <section className={styles.panel}>
              <div className={styles.panelHeading}><div><p className={styles.eyebrow}>{isFa ? "Difficulty Analysis" : "Difficulty Analysis"}</p><h2>{isFa ? "عملکرد بر اساس سختی" : "Performance by difficulty"}</h2></div></div>
              <div className={styles.difficultyLayout}>
                <div className={styles.difficultyDonut} style={difficultyDonutStyle}><strong>{Math.round(data.accuracy_pct)}%</strong><span>{isFa ? "دقت کل" : "overall"}</span></div>
                <div className={styles.difficultyLegend}>
                  {data.difficulty_analysis.map((row: DifficultyRow) => (
                    <div key={row.difficulty} className={styles.legendRow}>
                      <span className={styles.legendDot} style={{background: DIFFICULTY_COLORS[row.difficulty]}} />
                      <span>{difficultyLabel(row.difficulty, isFa)}</span>
                      <strong>{row.total ? `${percent(row.accuracy_pct)} (${row.correct}/${row.total})` : "—"}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Subtopics</p><h2>{isFa ? "عملکرد بر اساس زیرموضوع" : "Performance by subtopic"}</h2></div></div>
              <div className={styles.subtopicList}>
                {data.subtopic_analysis.map((row) => {
                  const accuracy = row.accuracy_pct ?? 0;
                  const tone = accuracy >= 80 ? "var(--result-green)" : accuracy >= 60 ? "var(--result-orange)" : "var(--result-coral)";
                  return (
                    <div className={styles.subtopicPerf} key={row.subtopic_id}>
                      <span className={styles.subtopicTitle} lang="fr" dir="ltr">{row.subtopic_title_fr || subtopicDisplay(row, isFa)}</span>
                      <div className={styles.subtopicBar}><span style={{width: `${clamp(accuracy)}%`, background: tone}} /></div>
                      <strong>{percent(row.accuracy_pct)}</strong>
                      <small>{row.correct}/{row.total}</small>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Question Types</p><h2>{isFa ? "عملکرد بر اساس نوع سؤال" : "Performance by question type"}</h2></div></div>
            <div className={styles.typeGrid}>
              {data.question_type_analysis.map((row, index) => (
                <article className={styles.typeCard} key={row.question_type}>
                  <QuestionTypeIcon index={index} />
                  <div><strong dir="ltr">{row.question_type}</strong><span>{row.correct}/{row.total}</span></div>
                  <em>{percent(row.accuracy_pct)}</em>
                  <div className={styles.miniBar}><span style={{width: `${clamp(row.accuracy_pct ?? 0)}%`}} /></div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Mastery Impact</p><h2>{isFa ? "اثر این جلسه بر تسلط" : "Mastery impact of this session"}</h2></div><span className={styles.impactSummary}>{isFa ? `${data.mastery_impact.affected_subtopic_count} زیرموضوع` : `${data.mastery_impact.affected_subtopic_count} subtopics`}</span></div>
            <div className={styles.impactStats}>
              <ImpactStat icon="up" value={data.mastery_impact.improved_subtopic_count} label={isFa ? "بهبود" : "Improved"} tone="success" />
              <ImpactStat icon="down" value={data.mastery_impact.declined_subtopic_count} label={isFa ? "کاهش" : "Declined"} tone="danger" />
              <ImpactStat icon="spark" value={data.mastery_impact.new_evidence_subtopic_count} label={isFa ? "شواهد جدید" : "First evidence"} tone="primary" />
              <ImpactStat icon="minus" value={data.mastery_impact.unchanged_subtopic_count} label={isFa ? "بدون تغییر" : "Unchanged"} tone="neutral" />
            </div>
            <div className={styles.masteryList}>
              {data.subtopic_analysis.map((row) => {
                const band = bandMeta(row.mastery_band_after, isFa);
                const delta = row.mastery_delta_pct;
                return (
                  <article className={styles.masteryRow} key={row.subtopic_id}>
                    <div className={styles.masteryTitle}><strong lang="fr" dir="ltr">{row.subtopic_title_fr || row.subtopic_id}</strong><small>{row.subtopic_title_fa}</small></div>
                    <div className={styles.masteryTransition}>
                      <span>{row.new_evidence ? (isFa ? "اولین شواهد" : "First evidence") : percent(row.mastery_before_pct)}</span>
                      <b aria-hidden="true">→</b>
                      <strong>{percent(row.mastery_after_pct)}</strong>
                      {delta != null ? <em className={delta > EPSILON ? styles.deltaUp : delta < -EPSILON ? styles.deltaDown : styles.deltaFlat}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}</em> : null}
                    </div>
                    <div className={styles.masteryDiagnostics}>
                      <span className={`${styles.bandBadge} ${styles[`band_${band.tone}`]}`}><b aria-hidden="true">{band.icon}</b>{band.label}</span>
                      <small>{isFa ? "اطمینان" : "Confidence"} {Math.round(row.mastery_confidence_after * 100)}%</small>
                      <small>{isFa ? "پوشش" : "Coverage"} {Math.round(row.mastery_coverage_after * 100)}%</small>
                    </div>
                  </article>
                );
              })}
            </div>
            <p className={styles.methodNote}>{isFa ? "تسلط از مدل Stage 15 و کل شواهد همان زیرموضوع محاسبه می‌شود؛ دقت همین جلسه جایگزین mastery نیست." : "Mastery comes from the Stage 15 evidence model across the subtopic history; this session's accuracy is not substituted for mastery."}</p>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Question Breakdown</p><h2>{isFa ? "جزئیات پاسخ‌ها" : "Question breakdown"}</h2></div><span className={styles.impactSummary}>{data.breakdown.length}</span></div>
            <ol className={styles.breakdownList}>
              {data.breakdown.map((item) => (
                <li key={item.test_question_id} className={styles.breakdownItem}>
                  <details>
                    <summary>
                      <span className={item.feedback.is_correct ? styles.questionCorrect : styles.questionWrong}>{item.feedback.is_correct ? "✓" : "×"}</span>
                      <strong>{isFa ? `سؤال ${item.position}` : `Question ${item.position}`}</strong>
                      <span lang="fr" dir="ltr">{item.subtopic_title_fr || item.subtopic_id}</span>
                      <small>{difficultyLabel(item.difficulty, isFa)} · {item.question_type} · {milliseconds(item.response_ms, isFa)}</small>
                    </summary>
                    <div className={styles.breakdownDetail}>
                      <p lang={item.stem_locale.startsWith("fr") ? "fr" : undefined} dir={item.stem_locale.startsWith("fr") ? "ltr" : undefined}>{item.stem}</p>
                      <p className={item.feedback.is_correct ? styles.textSuccess : styles.textDanger}>{item.feedback.is_correct ? (isFa ? "پاسخ صحیح" : "Correct answer") : (isFa ? "پاسخ نادرست" : "Incorrect answer")}</p>
                      {item.feedback.full_explanation ? <p>{item.feedback.full_explanation}</p> : null}
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className={styles.insightRail}>
          <section className={styles.sidePanel}>
            <div className={styles.sideHeading}><Icon name="warning" /><h2>{isFa ? "ضعف‌های این جلسه" : "Session weaknesses"}</h2></div>
            {data.weaknesses.length ? (
              <div className={styles.weaknessList}>
                {data.weaknesses.map((row) => (
                  <div className={styles.weaknessItem} key={row.subtopic_id}>
                    <span lang="fr" dir="ltr">{row.subtopic_title_fr || row.subtopic_id}</span>
                    <strong>{percent(row.accuracy_pct)}</strong>
                  </div>
                ))}
              </div>
            ) : <p className={styles.emptyNote}>{isFa ? "در این جلسه زیرموضوعی با پاسخ غلط ثبت نشده است." : "No subtopic had an incorrect answer in this session."}</p>}
            <Link href={practiceHref} className={styles.sideAction}>{isFa ? "تمرین ضعف‌ها" : "Practice weaknesses"}</Link>
          </section>

          <section className={styles.sidePanel}>
            <div className={styles.sideHeading}><Icon name="brain" /><h2>{isFa ? "Misconceptions شناسایی‌شده" : "Mapped misconceptions"}</h2></div>
            {data.misconceptions.length ? (
              <div className={styles.misconceptionList}>
                {data.misconceptions.map((item) => (
                  <article className={styles.misconceptionItem} key={item.id}>
                    <div><strong>{item.name_fa || item.family}</strong><small>{item.statement_fa}</small></div>
                    <span>{item.repeat_count}×</span>
                  </article>
                ))}
              </div>
            ) : <p className={styles.emptyNote}>{isFa ? "برای پاسخ‌های غلط این جلسه misconception نگاشت‌شده‌ای ثبت نشده است." : "No mapped misconception was recorded for this session's wrong answers."}</p>}
            {data.unmapped_wrong_count > 0 ? <p className={styles.unmappedNote}>{isFa ? `${data.unmapped_wrong_count} پاسخ غلط نگاشت misconception نداشت؛ سیستم چیزی را حدس نزده است.` : `${data.unmapped_wrong_count} wrong answer(s) had no misconception mapping; none was guessed.`}</p> : null}
            <Link href={reviewHref} className={styles.sideAction}>{isFa ? "مرور اشتباهات" : "Review mistakes"}</Link>
          </section>

          <section className={styles.sidePanel}>
            <div className={styles.sideHeading}><Icon name="check" /><h2>{isFa ? "نقاط قوت این جلسه" : "Session strengths"}</h2></div>
            {data.strengths.map((row) => (
              <div className={styles.strengthItem} key={row.subtopic_id}><span lang="fr" dir="ltr">{row.subtopic_title_fr || row.subtopic_id}</span><strong>{percent(row.accuracy_pct)}</strong></div>
            ))}
            {!data.strengths.length ? <p className={styles.emptyNote}>{isFa ? "هنوز داده کافی برای این بخش نیست." : "No session strength is available yet."}</p> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Metric({icon, label, value, detail, tone}: {icon: IconName; label: string; value: string; detail?: string; tone: "blue" | "green" | "coral"}) {
  return (
    <div className={`${styles.metric} ${styles[`metric_${tone}`]}`}>
      <div className={styles.metricLabel}><Icon name={icon} /><span>{label}</span></div>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : <small aria-hidden="true">&nbsp;</small>}
    </div>
  );
}

function ImpactStat({icon, value, label, tone}: {icon: IconName; value: number; label: string; tone: "success" | "danger" | "primary" | "neutral"}) {
  return <div className={`${styles.impactStat} ${styles[`impact_${tone}`]}`}><Icon name={icon}/><strong>{value}</strong><span>{label}</span></div>;
}

const EPSILON = 1e-6;

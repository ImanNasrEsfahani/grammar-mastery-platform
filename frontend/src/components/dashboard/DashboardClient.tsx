"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { DashboardEnvelope, NextActionEnvelope } from "@/lib/api/types";
import type { Locale } from "@/lib/i18n";
import { LoadingCard } from "@/components/ui/LoadingCard";
import { StatusPanel } from "@/components/ui/StatusPanel";

type CachedDashboard = {savedAt: string; dashboard: DashboardEnvelope; nextAction: NextActionEnvelope};

export function DashboardClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [data, setData] = useState<CachedDashboard | null>(null);
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
      if (!dashboard || !nextAction) throw new ApiError({status: 502, code: "EMPTY_DASHBOARD", message: "Dashboard data was empty."});
      const snapshot = {savedAt: new Date().toISOString(), dashboard, nextAction};
      sessionStorage.setItem("gmp-dashboard-safe-snapshot", JSON.stringify(snapshot));
      setData(snapshot);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Dashboard loading failed."}));
      const cached = sessionStorage.getItem("gmp-dashboard-safe-snapshot");
      if (cached) {
        try { setData(JSON.parse(cached) as CachedDashboard); } catch { sessionStorage.removeItem("gmp-dashboard-safe-snapshot"); }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch synchronizes the client view with the persisted dashboard snapshot.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <LoadingCard label={isFa ? "بارگذاری داشبورد" : "Loading dashboard"} />;
  if (!data) {
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
  const action = data.nextAction.data;
  const masteryWithEvidence = dashboard.mastery.filter((item) => item.confidence > 0 && item.coverage_ratio > 0).slice(0, 3);
  const inProgress = dashboard.in_progress_attempt;

  return (
    <div className="stack">
      {error ? (
        <StatusPanel title={isFa ? "نمای ذخیره‌شده نمایش داده می‌شود" : "Showing the last safe snapshot"} tone="warning" requestId={error.requestId} action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}>
          <p>{new Date(data.savedAt).toLocaleString(locale === "fa" ? "fa-IR" : "en-CA")}</p>
        </StatusPanel>
      ) : null}
      {inProgress ? (
        <section className="surface resume-attempt-card stack stack-small">
          <p className="eyebrow">{isFa ? "آزمون نیمه‌تمام" : "Unfinished attempt"}</p>
          <h2>{isFa ? "از همان‌جایی که ماندید ادامه دهید" : "Continue where you left off"}</h2>
          <p>{isFa ? `${inProgress.answered_count} از ${inProgress.question_count} سؤال پاسخ داده شده است.` : `${inProgress.answered_count} of ${inProgress.question_count} questions answered.`}</p>
          <Link className="button button-primary" href={`/${locale}/attempts/${inProgress.attempt_id}`}>{isFa ? "ادامه آزمون" : "Resume attempt"}</Link>
        </section>
      ) : null}
      <section className="surface dashboard-hero">
        <div className="stack stack-small">
          <p className="eyebrow">{isFa ? "اقدام پیشنهادی" : "Recommended next action"}</p>
          <h2>{action.code.replaceAll("_", " ")}</h2>
          <p>{action.reason}</p>
          <Link className="button button-primary" href={action.destination}>{isFa ? "شروع" : "Start"}</Link>
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="surface stack stack-small">
          <h2>{isFa ? "شواهد تسلط" : "Mastery evidence"}</h2>
          {masteryWithEvidence.length ? masteryWithEvidence.map((item) => (
            <div className="metric-row" key={`${item.scope_type}:${item.scope_id}`}>
              <span className="mastery-title">{item.scope_title || scopeTypeLabel(item.scope_type, isFa)}</span>
              <strong>{Math.round(item.mastery_score_pct)}%</strong>
              <small>
                <span className="mastery-scope-badge">{scopeTypeLabel(item.scope_type, isFa)}</span>
                {isFa ? "اطمینان" : "Confidence"} {Math.round(item.confidence * 100)}% · {isFa ? "پوشش" : "Coverage"} {Math.round(item.coverage_ratio * 100)}%
                {typeof item.evidence_count === "number" ? ` · ${item.evidence_count} ${isFa ? "شاهد" : "evidence"}` : ""}
              </small>
            </div>
          )) : <p className="muted">{isFa ? "برای برچسب‌گذاری نقاط ضعف هنوز شواهد کافی نیست." : "There is not enough evidence to label weaknesses yet."}</p>}
        </section>
        <section className="surface stack stack-small">
          <h2>{isFa ? "صف مرور" : "Review queue"}</h2>
          <p className="metric-large">{readCount(dashboard.review_queue, "due_count")}</p>
          <p className="muted">{isFa ? "مرور سررسیدشده" : "items due"}</p>
          <Link href={`/${locale}/review`}>{isFa ? "باز کردن مرور" : "Open review"}</Link>
        </section>
        <section className="surface stack stack-small">
          <h2>{isFa ? "فعالیت" : "Activity"}</h2>
          <p className="metric-large">{readCount(dashboard.activity, "questions_answered")}</p>
          <p className="muted">{isFa ? "سؤال پاسخ‌داده‌شده" : "questions answered"}</p>
        </section>
      </div>
    </div>
  );
}

function readCount(value: Record<string, unknown>, key: string): number {
  const result = value[key];
  return typeof result === "number" && Number.isFinite(result) ? result : 0;
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

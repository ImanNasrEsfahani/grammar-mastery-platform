"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { AttemptResultEnvelope } from "@/lib/api/types";
import type { Locale } from "@/lib/i18n";
import { LoadingCard } from "@/components/ui/LoadingCard";
import { StatusPanel } from "@/components/ui/StatusPanel";

export function AttemptResultClient({attemptId, locale}: {attemptId: string; locale: Locale}) {
  const isFa = locale === "fa";
  const [result, setResult] = useState<AttemptResultEnvelope | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<AttemptResultEnvelope>(`/api/backend/attempts/${attemptId}/result`);
      if (!response) throw new ApiError({status: 502, code: "EMPTY_RESULT", message: "The result was empty."});
      setResult(response);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Result loading failed."}));
    } finally { setLoading(false); }
  }, [attemptId]);
  // Initial fetch synchronizes the bookmarked route with the completed server attempt.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (loading) return <LoadingCard label={isFa ? "بارگذاری نتیجه" : "Loading result"} />;
  if (!result) return <StatusPanel title={error?.message ?? "Result unavailable"} tone="danger" requestId={error?.requestId} action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}><p>{error?.code}</p></StatusPanel>;
  const data = result.data;
  return (
    <div className="stack">
      <section className="surface result-summary stack stack-small">
        <p className="eyebrow">{isFa ? "نتیجه نهایی" : "Final result"}</p>
        <p className="result-score">{Math.round(data.score_pct)}%</p>
        <p>{isFa ? `${data.breakdown.length} پاسخ ثبت‌شده` : `${data.breakdown.length} recorded answers`}</p>
        <div className="cluster">
          <Link className="button button-primary" href={`/${locale}/review`}>{isFa ? "مرور خطاها" : "Review errors"}</Link>
          <Link className="button button-secondary" href={`/${locale}/dashboard`}>{isFa ? "داشبورد" : "Dashboard"}</Link>
        </div>
      </section>
      <ol className="result-list">
        {data.breakdown.map((item) => (
          <li className="surface result-item" key={item.test_question_id}>
            <strong>{isFa ? `سؤال ${item.position}` : `Question ${item.position}`}</strong>
            <span className={item.feedback.is_correct ? "text-success" : "text-danger"}>
              <span aria-hidden="true">{item.feedback.is_correct ? "✓" : "×"}</span> {item.feedback.is_correct ? (isFa ? "درست" : "Correct") : (isFa ? "نادرست" : "Incorrect")}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { ReviewCollectionEnvelope } from "@/lib/api/types";
import type { Locale } from "@/lib/i18n";
import { LoadingCard } from "@/components/ui/LoadingCard";
import { StatusPanel } from "@/components/ui/StatusPanel";

export function ReviewListClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [data, setData] = useState<ReviewCollectionEnvelope | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setData(await apiRequest<ReviewCollectionEnvelope>("/api/backend/reviews?page[size]=25&filter[due]=true")); }
    catch (caught) { setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Review queue failed to load."})); }
  }, []);
  // Initial fetch synchronizes this route with the owner-scoped review queue.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  if (!data && !error) return <LoadingCard label={isFa ? "بارگذاری مرورها" : "Loading reviews"} />;
  if (!data) return <StatusPanel title={error?.message ?? "Review unavailable"} tone="danger" requestId={error?.requestId} action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}><p>{error?.code}</p></StatusPanel>;
  if (!data.data.length) return <StatusPanel title={isFa ? "مرور سررسیدشده‌ای ندارید" : "Nothing is due for review"} tone="success" action={{label: isFa ? "تمرین عادی" : "Regular practice", href: `/${locale}/tests/new`}}><p>{isFa ? "با تمرین بعدی شواهد تازه ایجاد کنید." : "Build new evidence with regular practice."}</p></StatusPanel>;
  return (
    <ul className="card-list">
      {data.data.map((item) => (
        <li key={item.id}>
          <Link className="surface list-card" href={`/${locale}/review/${item.id}`}>
            <span className="lesson-number" aria-hidden="true">{item.kind === "MISTAKE" ? "!" : "↻"}</span>
            <span className="review-card-copy">
              <strong>{item.title}</strong>
              <small>{item.kind === "MISTAKE" ? (isFa ? "مرور خطا" : "Mistake review") : (isFa ? "مرور فاصله‌دار" : "Spaced review")}</small>
              <small>{item.due_at ? new Date(item.due_at).toLocaleString(isFa ? "fa-IR" : "en-CA") : item.status}</small>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

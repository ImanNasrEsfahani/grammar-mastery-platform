"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { LessonCollectionEnvelope } from "@/lib/api/types";
import type { Locale } from "@/lib/i18n";
import { DEFAULT_GRAMMAR_BOOK_SLUG } from "@/lib/grammar-content/books";
import { LoadingCard } from "@/components/ui/LoadingCard";
import { StatusPanel } from "@/components/ui/StatusPanel";

export function LessonListClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [data, setData] = useState<LessonCollectionEnvelope | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setData(await apiRequest<LessonCollectionEnvelope>("/api/backend/lessons?page[size]=52&sort=lesson_no")); }
    catch (caught) { setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Lessons failed to load."})); }
  }, []);
  // Initial fetch synchronizes this route with the canonical lesson collection.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  if (!data && !error) return <LoadingCard label={isFa ? "بارگذاری درس‌ها" : "Loading lessons"} />;
  if (!data) return <StatusPanel title={error?.message ?? "Lessons unavailable"} tone="danger" requestId={error?.requestId} action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}><p>{error?.code}</p></StatusPanel>;
  if (!data.data.length) return <StatusPanel title={isFa ? "درسی یافت نشد" : "No lessons found"}><p>{isFa ? "پس از انتشار محتوای فعال، درس‌ها اینجا نمایش داده می‌شوند." : "Active content will appear here after publication."}</p></StatusPanel>;
  return (
    <ol className="card-list">
      {data.data.map((lesson) => (
        <li key={lesson.id}>
          <Link className="surface list-card" href={`/${locale}/lessons/${lesson.id}?book=${DEFAULT_GRAMMAR_BOOK_SLUG}`}>
            <span className="lesson-number">{lesson.lesson_no}</span>
            <span><strong lang="fr" dir="ltr">{lesson.title_fr}</strong><small>{lesson.short_title}</small></span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

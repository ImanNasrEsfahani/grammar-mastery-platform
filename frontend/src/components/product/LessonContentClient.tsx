"use client";

import Link from "next/link";
import {useCallback, useEffect, useState} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {paths} from "@/lib/api/generated";
import type {Locale} from "@/lib/i18n";
import {
  getGrammarBook,
  grammarLessonUrl,
  type GrammarBookSlug,
} from "@/lib/grammar-content/books";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./LessonContentClient.module.css";

type LessonDetailEnvelope =
  paths["/lessons/{lessonId}"]["get"]["responses"][200]["content"]["application/json"];
type LessonDetail = LessonDetailEnvelope["data"];

type ViewState =
  | {kind: "loading"}
  | {kind: "ready"; lesson: LessonDetail; contentUrl: string}
  | {kind: "missing"; lesson: LessonDetail; contentUrl: string}
  | {
      kind: "error";
      message: string;
      code: string;
      requestId?: string;
    };

async function probeStaticHtml(url: string): Promise<Response> {
  const headResponse = await fetch(url, {method: "HEAD", cache: "no-store"});
  if (headResponse.status !== 405) return headResponse;
  return fetch(url, {method: "GET", cache: "no-store"});
}

export function LessonContentClient({
  locale,
  lessonId,
  bookSlug,
}: {
  locale: Locale;
  lessonId: string;
  bookSlug: GrammarBookSlug;
}) {
  const isFa = locale === "fa";
  const book = getGrammarBook(bookSlug);
  const [state, setState] = useState<ViewState>({kind: "loading"});

  const load = useCallback(async () => {
    setState({kind: "loading"});
    try {
      const envelope = await apiRequest<LessonDetailEnvelope>(
        `/api/backend/lessons/${lessonId}`,
      );
      if (!envelope) {
        throw new ApiError({
          status: 502,
          code: "EMPTY_LESSON_RESPONSE",
          message: "The lesson service returned an empty response.",
        });
      }

      const lesson = envelope.data;
      const contentUrl = grammarLessonUrl(bookSlug, lesson.lesson_no);
      const contentResponse = await probeStaticHtml(contentUrl);

      if (contentResponse.status === 404) {
        setState({kind: "missing", lesson, contentUrl});
        return;
      }
      if (!contentResponse.ok) {
        throw new ApiError({
          status: contentResponse.status,
          code: "LESSON_CONTENT_UNAVAILABLE",
          message: `Lesson HTML returned HTTP ${contentResponse.status}.`,
        });
      }

      setState({kind: "ready", lesson, contentUrl});
    } catch (caught) {
      if (caught instanceof ApiError) {
        setState({
          kind: "error",
          message: caught.message,
          code: caught.code,
          requestId: caught.requestId,
        });
        return;
      }
      setState({
        kind: "error",
        message: isFa
          ? "نگاشت یا بارگذاری محتوای این درس ناموفق بود."
          : "The lesson content mapping or load failed.",
        code: "LESSON_CONTENT_MAPPING_ERROR",
      });
    }
  }, [bookSlug, isFa, lessonId]);

  // Keep this route synchronized with the canonical lesson record and static content.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return <LoadingCard label={isFa ? "بارگذاری محتوای درس" : "Loading lesson content"} />;
  }

  if (state.kind === "error") {
    return (
      <StatusPanel
        title={state.message}
        tone="danger"
        requestId={state.requestId}
        action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
      >
        <p>{state.code}</p>
      </StatusPanel>
    );
  }

  const {lesson, contentUrl} = state;
  const fileName = contentUrl.split("/").at(-1) ?? "lesson.html";

  return (
    <section className={styles.shell}>
      <header className={styles.toolbar}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>
            {isFa ? `درس ${lesson.lesson_no} از ${book.lessonCount}` : `Lesson ${lesson.lesson_no} of ${book.lessonCount}`}
          </p>
          <h1 className={styles.title}>
            {isFa ? book.titleFa : book.titleFr}
          </h1>
          <span className={styles.frTitle} lang="fr" dir="ltr">
            {lesson.title_fr}
          </span>
          <div className={styles.meta}>
            <span className={styles.chip}>{book.edition}</span>
            <span className={styles.chip}>{fileName}</span>
            <span className={styles.chip}>{lesson.short_title}</span>
          </div>
        </div>
        <Link className={styles.back} href={`/${locale}/lessons`}>
          {isFa ? "بازگشت به درس‌ها" : "Back to lessons"}
        </Link>
      </header>

      {state.kind === "missing" ? (
        <StatusPanel
          title={isFa ? "فایل HTML این درس هنوز اضافه نشده است" : "This lesson HTML has not been added yet"}
        >
          <p>
            {isFa
              ? "کافی است فایل را با نام استاندارد زیر در مخزن قرار دهید و Frontend را دوباره build/deploy کنید؛ کد دیگری برای همان کتاب لازم نیست تغییر کند."
              : "Add the file at the standard repository path below and rebuild/redeploy the frontend; no other code change is required for another lesson in the same book."}
          </p>
          <code className={styles.path}>{`frontend/public${contentUrl}`}</code>
        </StatusPanel>
      ) : (
        <div className={styles.frameWrap}>
          <iframe
            key={contentUrl}
            className={styles.frame}
            src={contentUrl}
            title={`${book.titleFr} — ${lesson.title_fr}`}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </section>
  );
}

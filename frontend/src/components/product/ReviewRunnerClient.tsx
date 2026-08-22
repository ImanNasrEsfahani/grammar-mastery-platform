"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import Link from "next/link";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";

type ReviewOption = {id: string; position: string; text: string};
type ReviewQuestion = {
  test_question_id?: string;
  question_revision_id: string;
  position?: number;
  stem: string;
  stem_locale: string;
  question_type: string;
  difficulty: string;
  options: ReviewOption[];
  media?: unknown[];
};
type ReviewSchedule = {
  status: "SCHEDULED" | "DUE" | "COMPLETED" | "SUSPENDED";
  learning_state: string | null;
  due_at: string;
  interval_days: number;
  consecutive_correct_reviews: number;
  graduated: boolean;
  scheduler_version: string;
};
type ReviewItem = {
  id: string;
  kind?: "MISTAKE" | "SPACED";
  resolution_status: "UNRESOLVED" | "CORRECTED" | "EXCLUDED_CONTENT_ISSUE";
  reviewability: "RETRY_ALLOWED" | "HISTORY_ONLY";
  marked: boolean;
  feedback_state: "HIDDEN" | "REVEALED";
  previous_selected_option_id?: string | null;
  schedule?: ReviewSchedule | null;
  question: ReviewQuestion;
};
type AnswerFeedback = {
  is_correct: boolean;
  selected_option_id: string;
  correct_option_id: string;
  selected_option_explanation?: string | null;
  correct_option_explanation?: string | null;
  full_explanation?: string | null;
};
type Meta = {request_id: string; api_version: string};
type ReviewItemEnvelope = {data: ReviewItem; meta: Meta};
type ReviewFeedbackEnvelope = {
  data: {review_item: ReviewItem; feedback: AnswerFeedback; schedule?: ReviewSchedule | null};
  meta: Meta;
};
type FeedbackData = ReviewFeedbackEnvelope["data"];

function optionClass(
  optionId: string,
  selectedId: string | null,
  feedback: AnswerFeedback | null,
) {
  const parts = ["answer-option"];
  if (!feedback && optionId === selectedId) parts.push("option-selected");
  if (feedback) {
    if (optionId === feedback.correct_option_id) parts.push("option-correct");
    else if (optionId === feedback.selected_option_id && !feedback.is_correct) parts.push("option-incorrect");
    else parts.push("option-muted");
  }
  return parts.join(" ");
}

export function ReviewRunnerClient({
  locale,
  reviewId,
}: {
  locale: Locale;
  reviewId: string;
}) {
  const isFa = locale === "fa";
  const [item, setItem] = useState<ReviewItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedbackData, setFeedbackData] = useState<FeedbackData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setFeedbackData(null);
    setSelectedId(null);
    try {
      const payload = await apiRequest<ReviewItemEnvelope>(
        `/api/backend/reviews/${reviewId}`,
      );
      if (!payload) throw new ApiError({
        status: 502,
        code: "EMPTY_RESPONSE",
        message: "Review item returned no payload.",
      });
      setItem(payload.data);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({
              status: 0,
              code: "NETWORK_ERROR",
              message: "Review item failed to load.",
            }),
      );
    }
  }, [reviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    if (!selectedId || submitting || feedbackData) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = await apiRequest<ReviewFeedbackEnvelope>(
        `/api/backend/reviews/${reviewId}/grade`,
        {
          method: "POST",
          headers: {"Idempotency-Key": crypto.randomUUID()},
          body: JSON.stringify({selected_option_id: selectedId}),
        },
      );
      if (!payload) throw new ApiError({
        status: 502,
        code: "EMPTY_RESPONSE",
        message: "Review grade returned no payload.",
      });
      setItem(payload.data.review_item);
      setFeedbackData(payload.data);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({
              status: 0,
              code: "NETWORK_ERROR",
              message: "Review answer failed to submit.",
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }, [feedbackData, reviewId, selectedId, submitting]);

  const scheduleMessage = useMemo(() => {
    if (!feedbackData) return null;
    const {feedback, schedule} = feedbackData;
    if (!schedule) {
      return feedback.is_correct
        ? (isFa ? "پاسخ درست ثبت شد." : "Correct answer recorded.")
        : (isFa ? "پاسخ نادرست ثبت شد." : "Incorrect answer recorded.");
    }
    if (schedule.graduated) {
      return isFa
        ? "این مبحث یادگرفته‌شده محسوب شد و از صف مرور فعال خارج شد."
        : "This concept is considered learned and has left the active review queue.";
    }
    if (!feedback.is_correct) {
      return isFa
        ? "پاسخ نادرست بود؛ این مبحث فردا دوباره برای مرور نمایش داده می‌شود."
        : "That answer was incorrect; this concept will be due again tomorrow.";
    }
    return isFa
      ? `پاسخ درست بود؛ فاصله مرور به ${schedule.interval_days} روز افزایش یافت.`
      : `Correct. The next review interval is now ${schedule.interval_days} days.`;
  }, [feedbackData, isFa]);

  if (!item && !error) {
    return <LoadingCard label={isFa ? "آماده‌سازی سؤال مرور" : "Preparing review question"} />;
  }

  if (!item) {
    return (
      <StatusPanel
        title={error?.message ?? (isFa ? "مرور در دسترس نیست" : "Review unavailable")}
        tone="danger"
        requestId={error?.requestId}
        action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
      >
        <p>{error?.code}</p>
      </StatusPanel>
    );
  }

  const feedback = feedbackData?.feedback ?? null;
  const question = item.question;

  return (
    <div className="runner-shell stack">
      <header className="page-heading">
        <p className="eyebrow">{item.kind === "MISTAKE" ? (isFa ? "مرور خطا" : "Mistake review") : (isFa ? "مرور فاصله‌دار" : "Spaced review")}</p>
        <h1>{isFa ? "مرور فعال" : "Active review"}</h1>
        <p>
          {isFa
            ? "ابتدا دوباره پاسخ بدهید. پاسخ صحیح تا زمان ثبت پاسخ شما نمایش داده نمی‌شود."
            : "Answer from memory first. The correct answer stays hidden until you submit."}
        </p>
      </header>

      {error ? (
        <StatusPanel title={error.message} tone="danger" requestId={error.requestId}>
          <p>{error.code}</p>
        </StatusPanel>
      ) : null}

      {item.reviewability === "HISTORY_ONLY" && !feedback ? (
        <StatusPanel
          title={isFa ? "این مورد فقط تاریخی است" : "This item is history-only"}
          tone="warning"
          action={{label: isFa ? "بازگشت به صف مرور" : "Back to review queue", href: `/${locale}/review`}}
        >
          <p>{isFa ? "این سؤال دیگر برای تلاش مجدد ایمن نیست." : "This question is no longer safe for another retry."}</p>
        </StatusPanel>
      ) : (
        <>
          <section className="surface question-card" aria-labelledby="review-question">
            <div className="question-meta">
              <span>{question.question_type}</span>
              <span>{question.difficulty}</span>
            </div>
            <h2 className="question-stem" id="review-question">{question.stem}</h2>
            <p className="option-instruction">
              {isFa ? "یک گزینه را انتخاب کنید." : "Choose one answer."}
            </p>
            <div className="option-list" role="group" aria-labelledby="review-question">
              {question.options.map((option) => {
                const isSelected = selectedId === option.id;
                const status =
                  feedback && option.id === feedback.correct_option_id
                    ? (isFa ? "درست" : "Correct")
                    : feedback && option.id === feedback.selected_option_id && !feedback.is_correct
                      ? (isFa ? "پاسخ شما" : "Your answer")
                      : null;
                return (
                  <button
                    className={optionClass(option.id, selectedId, feedback)}
                    type="button"
                    key={option.id}
                    disabled={Boolean(feedback) || submitting}
                    aria-pressed={!feedback ? isSelected : undefined}
                    onClick={() => setSelectedId(option.id)}
                  >
                    <span className="option-key">{option.position}</span>
                    <span className="option-text">{option.text}</span>
                    {status ? <span className="option-status">{status}</span> : <span />}
                  </button>
                );
              })}
            </div>
          </section>

          {feedback ? (
            <section className={`feedback-card ${feedback.is_correct ? "feedback-correct" : "feedback-incorrect"}`} aria-live="polite">
              <div className="feedback-result">
                <span className="feedback-icon" aria-hidden="true">{feedback.is_correct ? "✓" : "!"}</span>
                <h2>{feedback.is_correct ? (isFa ? "درست پاسخ دادید" : "Correct") : (isFa ? "نیاز به مرور دوباره" : "Needs another review")}</h2>
              </div>
              <div className="explanation-copy">
                {feedback.full_explanation ? <p>{feedback.full_explanation}</p> : null}
                {feedback.correct_option_explanation ? <p>{feedback.correct_option_explanation}</p> : null}
                {scheduleMessage ? <p><strong>{scheduleMessage}</strong></p> : null}
              </div>
            </section>
          ) : null}

          <nav className="runner-navigation" aria-label={isFa ? "کنترل مرور" : "Review controls"}>
            <div className="runner-navigation-inner">
              <Link className="button button-secondary" href={`/${locale}/review`}>
                {isFa ? "بازگشت" : "Back"}
              </Link>
              {feedback ? (
                <Link className="button button-primary" href={`/${locale}/review`}>
                  {isFa ? "مرور بعدی" : "Next review"}
                </Link>
              ) : (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={!selectedId || submitting}
                  onClick={() => void submit()}
                >
                  {submitting ? (isFa ? "در حال بررسی…" : "Checking…") : (isFa ? "ثبت پاسخ" : "Submit answer")}
                </button>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./ReviewRunnerClient.module.css";

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

type PriorityLevel = "high" | "medium" | "low";
type ApiPriorityLevel = "HIGH" | "MEDIUM" | "LOW";

type ReviewSummary = {
  id: string;
  kind: "MISTAKE" | "SPACED";
  status: string;
  title: string;
  group_key?: string | null;
  repeat_count?: number;
  due_at?: string | null;
  marked: boolean;
  priority?: ApiPriorityLevel | null;
  priority_reason?: string | null;
};

type ReviewCollectionEnvelope = {
  data: ReviewSummary[];
  page: {page_size: number; has_more: boolean; next_cursor: string | null};
  meta: Meta;
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
  data: {
    review_item: ReviewItem;
    feedback: AnswerFeedback;
    schedule?: ReviewSchedule | null;
  };
  meta: Meta;
};
type FeedbackData = ReviewFeedbackEnvelope["data"];

type SessionAnswer = {
  cursor: number;
  review_id: string;
  is_correct: boolean;
};

type ReviewSession = {
  version: 1;
  started_at: number;
  cursor: number;
  order: string[];
  summaries: ReviewSummary[];
  answers: SessionAnswer[];
  repeat_requested_ids: string[];
};

type PriorityInfo = {
  level: PriorityLevel;
  reasonFa: string;
  reasonEn: string;
  source: "api" | "fallback";
};

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const REVIEW_PRIORITY_VERSION = "review-priority-ui-v1.0.0";

function sessionKey(locale: Locale) {
  return `gmp-review-session-v1:${locale}`;
}

function readSession(locale: Locale): ReviewSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(sessionKey(locale));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReviewSession;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.order) ||
      !Array.isArray(parsed.summaries) ||
      !Array.isArray(parsed.answers) ||
      !Array.isArray(parsed.repeat_requested_ids) ||
      Date.now() - parsed.started_at > SESSION_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(sessionKey(locale));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(locale: Locale, session: ReviewSession) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(sessionKey(locale), JSON.stringify(session));
}

function clearSession(locale: Locale) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(sessionKey(locale));
}

function fallbackSummary(item: ReviewItem): ReviewSummary {
  return {
    id: item.id,
    kind: item.kind ?? (item.schedule ? "SPACED" : "MISTAKE"),
    status: item.resolution_status,
    title: item.question.question_type,
    repeat_count: item.schedule?.consecutive_correct_reviews ?? 0,
    due_at: item.schedule?.due_at ?? null,
    marked: item.marked,
  };
}

function mergeSummaries(current: ReviewSummary[], incoming: ReviewSummary[]) {
  const map = new Map(current.map((summary) => [summary.id, summary]));
  for (const summary of incoming) {
    map.set(summary.id, {...map.get(summary.id), ...summary});
  }
  return [...map.values()];
}

function normalizeApiPriority(priority: ApiPriorityLevel | null | undefined): PriorityLevel | null {
  if (priority === "HIGH") return "high";
  if (priority === "MEDIUM") return "medium";
  if (priority === "LOW") return "low";
  return null;
}

function priorityInfoFor(summary: ReviewSummary | null): PriorityInfo {
  const apiLevel = normalizeApiPriority(summary?.priority);
  if (apiLevel) {
    const reason = summary?.priority_reason?.trim();
    return {
      level: apiLevel,
      reasonFa: reason || "اولویت توسط صف مرور تعیین شده است.",
      reasonEn: reason || "Priority was supplied by the review queue.",
      source: "api",
    };
  }

  if (!summary) {
    return {
      level: "medium",
      reasonFa: "اطلاعات کافی برای اولویت‌بندی هنوز بارگذاری نشده است.",
      reasonEn: "Not enough queue data is available yet.",
      source: "fallback",
    };
  }

  const repeats = Math.max(0, summary.repeat_count ?? 0);
  const dueMs = summary.due_at ? new Date(summary.due_at).getTime() : Number.NaN;
  const overdueHours = Number.isFinite(dueMs) ? (Date.now() - dueMs) / 3_600_000 : Number.NEGATIVE_INFINITY;

  if (repeats >= 3) {
    return {
      level: "high",
      reasonFa: `${repeats} تکرار ثبت شده؛ الگوی خطا نیاز به توجه فوری دارد.`,
      reasonEn: `${repeats} repeats are recorded; this error pattern needs prompt attention.`,
      source: "fallback",
    };
  }
  if (overdueHours >= 24) {
    return {
      level: "high",
      reasonFa: "این مرور بیش از یک روز از سررسید گذشته است.",
      reasonEn: "This review is more than one day overdue.",
      source: "fallback",
    };
  }
  if (overdueHours >= 0) {
    return {
      level: "medium",
      reasonFa: "این مورد اکنون سررسید شده است.",
      reasonEn: "This item is currently due.",
      source: "fallback",
    };
  }
  if (repeats >= 1) {
    return {
      level: "medium",
      reasonFa: "این الگو قبلاً تکرار شده و باید دوباره تثبیت شود.",
      reasonEn: "This pattern has repeated before and should be reinforced.",
      source: "fallback",
    };
  }
  return {
    level: "low",
    reasonFa: "مرور برنامه‌ریزی‌شده بدون نشانه تکرار شدید است.",
    reasonEn: "Scheduled review with no strong repetition signal.",
    source: "fallback",
  };
}

function optionClass(
  optionId: string,
  selectedId: string | null,
  feedback: AnswerFeedback | null,
) {
  const parts = [styles.option];
  if (!feedback && optionId === selectedId) parts.push(styles.optionSelected);
  if (feedback) {
    if (optionId === feedback.correct_option_id) parts.push(styles.optionCorrect);
    else if (optionId === feedback.selected_option_id && !feedback.is_correct) {
      parts.push(styles.optionIncorrect);
    } else {
      parts.push(styles.optionMuted);
    }
  }
  return parts.join(" ");
}

function difficultyLabel(value: string, isFa: boolean) {
  const labels: Record<string, [string, string]> = {
    EASY: ["آسان", "Easy"],
    MEDIUM: ["متوسط", "Medium"],
    HARD: ["سخت", "Hard"],
    VERY_HARD: ["خیلی سخت", "Very hard"],
  };
  const pair = labels[value] ?? [value, value];
  return isFa ? pair[0] : pair[1];
}

function priorityLabel(priority: PriorityLevel, isFa: boolean) {
  const labels: Record<PriorityLevel, [string, string]> = {
    high: ["بالا", "High"],
    medium: ["متوسط", "Medium"],
    low: ["پایین", "Low"],
  };
  return isFa ? labels[priority][0] : labels[priority][1];
}

function formatNumber(value: number, isFa: boolean) {
  return new Intl.NumberFormat(isFa ? "fa-IR" : "en-CA").format(value);
}

function formatDue(dueAt: string | null | undefined, isFa: boolean) {
  if (!dueAt) return isFa ? "بدون سررسید" : "No due date";
  const due = new Date(dueAt);
  const now = new Date();
  if (Number.isNaN(due.getTime())) return isFa ? "زمان نامعتبر" : "Invalid date";
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayDelta = Math.round((dueDay - nowDay) / 86_400_000);
  if (dayDelta === 0) return isFa ? "امروز" : "Today";
  if (dayDelta === 1) return isFa ? "فردا" : "Tomorrow";
  if (dayDelta === -1) return isFa ? "۱ روز عقب‌افتاده" : "1 day overdue";
  if (dayDelta < 0) {
    return isFa
      ? `${formatNumber(Math.abs(dayDelta), true)} روز عقب‌افتاده`
      : `${Math.abs(dayDelta)} days overdue`;
  }
  return due.toLocaleDateString(isFa ? "fa-IR" : "en-CA", {
    month: "short",
    day: "numeric",
  });
}

function selectedOptionText(question: ReviewQuestion, optionId: string | null | undefined) {
  if (!optionId) return null;
  return question.options.find((option) => option.id === optionId)?.text ?? null;
}

function scheduleStateLabel(schedule: ReviewSchedule | null, isFa: boolean) {
  if (!schedule) return isFa ? "بدون وضعیت" : "No state";
  if (schedule.graduated) return isFa ? "تثبیت‌شده" : "Graduated";
  const state = schedule.learning_state ?? schedule.status;
  const labels: Record<string, [string, string]> = {
    NEW: ["جدید", "New"],
    LEARNING: ["در حال یادگیری", "Learning"],
    REVIEW: ["مرور", "Review"],
    LAPSED: ["لغزش", "Lapsed"],
    SUSPENDED: ["تعلیق", "Suspended"],
    DUE: ["سررسید", "Due"],
    SCHEDULED: ["زمان‌بندی‌شده", "Scheduled"],
    COMPLETED: ["تکمیل‌شده", "Completed"],
  };
  const pair = labels[state] ?? [state, state];
  return isFa ? pair[0] : pair[1];
}

export function ReviewRunnerClient({
  locale,
  reviewId,
}: {
  locale: Locale;
  reviewId: string;
}) {
  const isFa = locale === "fa";
  const router = useRouter();
  const [item, setItem] = useState<ReviewItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedbackData, setFeedbackData] = useState<FeedbackData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [summaryView, setSummaryView] = useState(false);
  const [repeatPending, setRepeatPending] = useState(false);
  const [scheduleBeforeGrade, setScheduleBeforeGrade] = useState<ReviewSchedule | null>(null);

  const persistSession = useCallback((next: ReviewSession) => {
    setSession(next);
    writeSession(locale, next);
  }, [locale]);

  const ensureSession = useCallback((queue: ReviewSummary[], loadedItem: ReviewItem) => {
    const fallback = fallbackSummary(loadedItem);
    const dueQueue = queue.length ? queue : [fallback];
    const saved = readSession(locale);

    if (saved) {
      const matchingIndexes = saved.order
        .map((id, index) => ({id, index}))
        .filter((entry) => entry.id === reviewId);
      let cursor = saved.cursor;
      if (saved.order[cursor] !== reviewId && matchingIndexes.length) {
        const pendingMatch = matchingIndexes.find(
          ({index}) => !saved.answers.some((answer) => answer.cursor === index),
        );
        const firstMatch = matchingIndexes[0];
        if (firstMatch) cursor = pendingMatch?.index ?? firstMatch.index;
      }
      const hasReview = saved.order.includes(reviewId);
      persistSession({
        ...saved,
        cursor: hasReview ? cursor : saved.order.length,
        order: hasReview ? saved.order : [...saved.order, reviewId],
        summaries: mergeSummaries(mergeSummaries([fallback], saved.summaries), dueQueue),
      });
      return;
    }

    const order = dueQueue.map((summary) => summary.id);
    if (!order.includes(reviewId)) order.unshift(reviewId);
    persistSession({
      version: 1,
      started_at: Date.now(),
      cursor: Math.max(0, order.indexOf(reviewId)),
      order,
      summaries: mergeSummaries([fallback], dueQueue),
      answers: [],
      repeat_requested_ids: [],
    });
  }, [locale, persistSession, reviewId]);

  const loadQueue = useCallback(async (loadedItem: ReviewItem) => {
    setQueueLoading(true);
    try {
      const payload = await apiRequest<ReviewCollectionEnvelope>(
        "/api/backend/reviews?page[size]=25&filter[due]=true",
      );
      ensureSession(payload?.data ?? [], loadedItem);
    } catch {
      ensureSession([], loadedItem);
    } finally {
      setQueueLoading(false);
    }
  }, [ensureSession]);

  const load = useCallback(async () => {
    setError(null);
    setFeedbackData(null);
    setSelectedId(null);
    setSummaryView(false);
    setRepeatPending(false);
    setScheduleBeforeGrade(null);
    try {
      const payload = await apiRequest<ReviewItemEnvelope>(
        `/api/backend/reviews/${reviewId}`,
      );
      if (!payload) {
        throw new ApiError({
          status: 502,
          code: "EMPTY_RESPONSE",
          message: "Review item returned no payload.",
        });
      }
      setItem(payload.data);
      void loadQueue(payload.data);
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
  }, [loadQueue, reviewId]);

  // Synchronize the runner with the requested review item on route changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const currentIndex = useMemo(() => {
    if (!session) return 0;
    if (session.order[session.cursor] === reviewId) return session.cursor;
    const firstPending = session.order.findIndex((id, index) => (
      id === reviewId && !session.answers.some((answer) => answer.cursor === index)
    ));
    return firstPending >= 0 ? firstPending : Math.max(0, session.order.indexOf(reviewId));
  }, [reviewId, session]);

  const currentSummary = useMemo(() => {
    if (!item) return null;
    return session?.summaries.find((summary) => summary.id === reviewId) ?? fallbackSummary(item);
  }, [item, reviewId, session]);

  const priority = useMemo(() => priorityInfoFor(currentSummary), [currentSummary]);
  const feedback = feedbackData?.feedback ?? null;
  const scheduleBefore = scheduleBeforeGrade ?? item?.schedule ?? null;
  const scheduleAfter = feedbackData?.schedule ?? feedbackData?.review_item.schedule ?? null;

  const totalItems = Math.max(1, session?.order.length ?? 1);
  const answeredCursors = new Set(session?.answers.map((answer) => answer.cursor) ?? []);
  const answeredCount = answeredCursors.size;
  const correctCount = session?.answers.filter((answer) => answer.is_correct).length ?? 0;
  const incorrectCount = session?.answers.filter((answer) => !answer.is_correct).length ?? 0;
  const remainingCount = Math.max(0, totalItems - answeredCount);
  const progressPct = Math.min(100, Math.round((answeredCount / totalItems) * 100));
  const progressStyle = {"--review-progress": `${progressPct}%`} as CSSProperties;

  const previousId = session && currentIndex > 0 ? session.order[currentIndex - 1] : null;
  const nextId = session && currentIndex + 1 < session.order.length
    ? session.order[currentIndex + 1]
    : null;

  const repeatRequested = session?.repeat_requested_ids.includes(reviewId) ?? false;
  const repeatQueueIndex = repeatRequested && session
    ? session.order.lastIndexOf(reviewId)
    : -1;

  const navigateTo = useCallback((targetId: string, targetCursor: number) => {
    if (session) persistSession({...session, cursor: targetCursor});
    router.push(`/${locale}/review/${targetId}`);
  }, [locale, persistSession, router, session]);

  const submit = useCallback(async () => {
    if (!selectedId || submitting || feedbackData || !item) return;
    setSubmitting(true);
    setError(null);
    setScheduleBeforeGrade(item.schedule ?? null);
    try {
      const payload = await apiRequest<ReviewFeedbackEnvelope>(
        `/api/backend/reviews/${reviewId}/grade`,
        {
          method: "POST",
          headers: {"Idempotency-Key": crypto.randomUUID()},
          body: JSON.stringify({selected_option_id: selectedId}),
        },
      );
      if (!payload) {
        throw new ApiError({
          status: 502,
          code: "EMPTY_RESPONSE",
          message: "Review grade returned no payload.",
        });
      }
      setItem(payload.data.review_item);
      setFeedbackData(payload.data);

      const base = session ?? {
        version: 1 as const,
        started_at: Date.now(),
        cursor: 0,
        order: [reviewId],
        summaries: [fallbackSummary(item)],
        answers: [],
        repeat_requested_ids: [],
      };
      const answer: SessionAnswer = {
        cursor: currentIndex,
        review_id: reviewId,
        is_correct: payload.data.feedback.is_correct,
      };
      const answers = [
        ...base.answers.filter((entry) => entry.cursor !== currentIndex),
        answer,
      ];
      persistSession({...base, cursor: currentIndex, answers});
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
  }, [currentIndex, feedbackData, item, persistSession, reviewId, selectedId, session, submitting]);

  const toggleRepeatInSession = useCallback(() => {
    if (!item || !session) return;
    const alreadyRequested = session.repeat_requested_ids.includes(reviewId);
    if (alreadyRequested) {
      const lastIndex = session.order.lastIndexOf(reviewId);
      const canRemoveTail = lastIndex > currentIndex
        && !session.answers.some((answer) => answer.cursor === lastIndex);
      persistSession({
        ...session,
        order: canRemoveTail
          ? session.order.filter((_, index) => index !== lastIndex)
          : session.order,
        repeat_requested_ids: session.repeat_requested_ids.filter((id) => id !== reviewId),
      });
      setRepeatPending(false);
      return;
    }
    persistSession({
      ...session,
      order: [...session.order, reviewId],
      repeat_requested_ids: [...session.repeat_requested_ids, reviewId],
    });
    setRepeatPending(true);
  }, [currentIndex, item, persistSession, reviewId, session]);

  const finishSession = useCallback(() => {
    clearSession(locale);
    router.push(`/${locale}/review`);
  }, [locale, router]);

  const goNext = useCallback(() => {
    if (!session) {
      setSummaryView(true);
      return;
    }
    const nextCursor = currentIndex + 1;
    const target = session.order[nextCursor];
    if (target) {
      navigateTo(target, nextCursor);
      return;
    }
    setSummaryView(true);
  }, [currentIndex, navigateTo, session]);

  // When the final queued answer has been graded and persisted, the review
  // session is complete. Move directly to the existing summary instead of
  // leaving the learner on the last answered question with nowhere obvious
  // to go. A requested repeat keeps the session open because a new item has
  // been appended to the queue.
  useEffect(() => {
    if (!feedback || !session || submitting || repeatPending) return;
    if (answeredCount < totalItems) return;
    setSummaryView(true);
  }, [answeredCount, feedback, repeatPending, session, submitting, totalItems]);

  useEffect(() => {
    if (!item || feedback || submitting || item.reviewability === "HISTORY_ONLY") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const digit = Number(event.key);
      if (digit >= 1 && digit <= item.question.options.length) {
        event.preventDefault();
        const option = item.question.options[digit - 1];
        if (option) setSelectedId(option.id);
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        void submit();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [feedback, item, selectedId, submit, submitting]);

  const scheduleMessage = useMemo(() => {
    if (!feedbackData) return null;
    const schedule = scheduleAfter;
    if (!schedule) {
      return feedbackData.feedback.is_correct
        ? (isFa ? "پاسخ درست ثبت شد." : "Correct answer recorded.")
        : (isFa ? "پاسخ نادرست ثبت شد." : "Incorrect answer recorded.");
    }
    if (schedule.graduated) {
      return isFa
        ? "این مفهوم تثبیت‌شده محسوب شد و از صف مرور فعال خارج شد."
        : "This concept is considered learned and has left the active review queue.";
    }
    if (!feedbackData.feedback.is_correct) {
      return isFa
        ? "پاسخ نادرست بود؛ این مفهوم در فاصله کوتاه‌تری دوباره مرور می‌شود."
        : "Incorrect; this concept returns on a shorter review interval.";
    }
    return isFa
      ? `پاسخ درست بود؛ فاصله مرور به ${formatNumber(schedule.interval_days, true)} روز افزایش یافت.`
      : `Correct. The next review interval is now ${schedule.interval_days} days.`;
  }, [feedbackData, isFa, scheduleAfter]);

  if (!item && !error) {
    return <LoadingCard label={isFa ? "آماده‌سازی جلسه مرور" : "Preparing review session"} />;
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

  if (summaryView) {
    const sessionAccuracy = answeredCount
      ? Math.round((correctCount / Math.max(1, correctCount + incorrectCount)) * 100)
      : 0;
    return (
      <section className={styles.summaryPage} aria-labelledby="review-summary-title">
        <div className={styles.summaryIcon} aria-hidden="true">✓</div>
        <p className={styles.eyebrow}>{isFa ? "جلسه مرور" : "Review session"}</p>
        <h1 id="review-summary-title">{isFa ? "جلسه مرور تکمیل شد" : "Review session complete"}</h1>
        <p className={styles.summaryLead}>
          {isFa
            ? "پاسخ‌های این جلسه به‌عنوان رویداد مرور ثبت شدند؛ امتیاز آزمون اصلی بازنویسی نمی‌شود."
            : "This session is stored as review evidence; the original test score is not rewritten."}
        </p>
        <div className={styles.summaryMetrics}>
          <div>
            <strong>{formatNumber(answeredCount, isFa)}</strong>
            <span>{isFa ? "مرور انجام‌شده" : "Reviewed"}</span>
          </div>
          <div>
            <strong>{formatNumber(sessionAccuracy, isFa)}%</strong>
            <span>{isFa ? "دقت جلسه" : "Session accuracy"}</span>
          </div>
          <div>
            <strong>{formatNumber(session?.repeat_requested_ids.length ?? 0, isFa)}</strong>
            <span>{isFa ? "تکرار در جلسه" : "Repeated in session"}</span>
          </div>
        </div>
        <div className={styles.summaryActions}>
          <button className={styles.primaryButton} type="button" onClick={finishSession}>
            {isFa ? "بازگشت به صندوق مرور" : "Back to review inbox"}
          </button>
          <Link className={styles.secondaryButton} href={`/${locale}/tests/new`}>
            {isFa ? "ساخت تمرین جدید" : "Build a practice test"}
          </Link>
        </div>
      </section>
    );
  }

  const previousAnswer = selectedOptionText(item.question, item.previous_selected_option_id);
  const selectedText = feedback ? selectedOptionText(item.question, feedback.selected_option_id) : null;
  const correctText = feedback ? selectedOptionText(item.question, feedback.correct_option_id) : null;
  const misconceptionLabel = currentSummary?.group_key
    || (feedback && !feedback.is_correct && selectedText && correctText && selectedText !== correctText
      ? `${selectedText} ↔ ${correctText}`
      : null);
  const intervalBefore = scheduleBefore?.interval_days ?? null;
  const intervalAfter = scheduleAfter?.interval_days ?? null;
  const streakBefore = scheduleBefore?.consecutive_correct_reviews ?? null;
  const streakAfter = scheduleAfter?.consecutive_correct_reviews ?? null;
  const impactDelta = intervalBefore !== null && intervalAfter !== null
    ? intervalAfter - intervalBefore
    : null;
  const queueRows = session?.order.map((id, index) => ({
    id,
    index,
    summary: session.summaries.find((summary) => summary.id === id),
    answered: session.answers.find((answer) => answer.cursor === index),
  })) ?? [{id: reviewId, index: 0, summary: currentSummary ?? undefined, answered: undefined}];

  return (
    <div className={styles.reviewSession} dir="ltr">
      <aside
        dir={isFa ? "rtl" : "ltr"}
        className={styles.inboxPanel}
        aria-label={isFa ? "فهرست جلسه مرور" : "Review session list"}
      >
        <div className={styles.panelHeader}>
          <div>
            <span className={styles.eyebrow}>{isFa ? "صندوق بازبینی" : "Review inbox"}</span>
            <h2>{isFa ? "مرور خطاها" : "Error review"}</h2>
          </div>
          <Link
            className={styles.backLink}
            href={`/${locale}/review`}
            aria-label={isFa ? "بازگشت به صندوق مرور" : "Back to review inbox"}
          >‹</Link>
        </div>
        <div className={styles.listCaption}>
          <span>{isFa ? "لیست مرور" : "Review list"}</span>
          <span>{queueLoading ? "…" : `(${formatNumber(totalItems, isFa)})`}</span>
        </div>
        <div className={styles.queueList}>
          {queueRows.map(({id, index, summary, answered}) => {
            const rowPriority = priorityInfoFor(summary ?? null);
            const active = index === currentIndex;
            return (
              <button
                type="button"
                key={`${id}-${index}`}
                className={`${styles.queueCard} ${active ? styles.queueCardActive : ""}`}
                aria-current={active ? "step" : undefined}
                aria-label={`${summary?.title ?? "Grammar review"}; ${priorityLabel(rowPriority.level, isFa)}; ${formatDue(summary?.due_at, isFa)}`}
                onClick={() => navigateTo(id, index)}
              >
                <span className={`${styles.priorityBadge} ${styles[`priority_${rowPriority.level}`]}`}>
                  {priorityLabel(rowPriority.level, isFa)}
                </span>
                <span className={styles.queueCopy}>
                  <strong>{summary?.title ?? (isFa ? "مرور گرامر" : "Grammar review")}</strong>
                  <small>↻ {formatDue(summary?.due_at, isFa)}</small>
                </span>
                <span
                  className={`${styles.repeatBubble} ${answered ? (answered.is_correct ? styles.repeatBubbleCorrect : styles.repeatBubbleIncorrect) : ""}`}
                  aria-label={isFa ? "تعداد تکرار" : "Repeat count"}
                >
                  {formatNumber(summary?.repeat_count ?? 0, isFa)}
                </span>
              </button>
            );
          })}
        </div>
        <button className={styles.finishButton} type="button" onClick={finishSession}>
          {isFa ? "پایان جلسه مرور" : "Finish review session"}
        </button>
      </aside>

      <main dir={isFa ? "rtl" : "ltr"} className={styles.runnerColumn}>
        <section className={styles.focusHeader} aria-label={isFa ? "پیشرفت سؤال جاری" : "Current review progress"}>
          <div className={styles.focusMeta}>
            <div className={styles.focusCounter}>
              <button
                type="button"
                className={styles.roundButton}
                disabled={!previousId}
                onClick={() => previousId && navigateTo(previousId, currentIndex - 1)}
                aria-label={isFa ? "مرور قبلی" : "Previous review"}
              >‹</button>
              <strong>
                {isFa ? "سؤال" : "Question"} {formatNumber(currentIndex + 1, isFa)} {isFa ? "از" : "of"} {formatNumber(totalItems, isFa)}
              </strong>
              <button
                type="button"
                className={styles.roundButton}
                disabled={!feedback || !nextId}
                onClick={() => feedback && nextId && navigateTo(nextId, currentIndex + 1)}
                aria-label={isFa ? "مرور بعدی" : "Next review"}
              >›</button>
            </div>
            <div className={styles.dueMeta}>
              <span>{isFa ? "تکرار" : "Repeat"}: <strong>{formatNumber(currentSummary?.repeat_count ?? 0, isFa)}</strong></span>
              <span>{isFa ? "سررسید" : "Due"}: <strong>{formatDue(currentSummary?.due_at, isFa)}</strong></span>
            </div>
          </div>
          <div className={styles.progressTrack} aria-label={`${progressPct}%`}>
            <span style={{inlineSize: `${Math.max(4, progressPct)}%`}} />
          </div>
          <small>{formatNumber(progressPct, isFa)}% {isFa ? "تکمیل جلسه" : "session complete"}</small>
        </section>

        {error ? (
          <StatusPanel title={error.message} tone="danger" requestId={error.requestId}>
            <p>{error.code}</p>
          </StatusPanel>
        ) : null}

        {item.reviewability === "HISTORY_ONLY" && !feedback ? (
          <section className={styles.historyOnlyCard}>
            <div className={styles.historyIcon} aria-hidden="true">i</div>
            <div>
              <h2>{isFa ? "این مورد فقط برای تاریخچه نگهداری می‌شود" : "This item is history-only"}</h2>
              <p>
                {isFa
                  ? "سؤال دیگر برای تلاش مجدد ایمن نیست و در آزمون جدید استفاده نمی‌شود."
                  : "This question is no longer safe for another retry and is excluded from new tests."}
              </p>
              <Link className={styles.secondaryButton} href={`/${locale}/review`}>
                {isFa ? "بازگشت به صندوق مرور" : "Back to review inbox"}
              </Link>
            </div>
          </section>
        ) : (
          <section className={styles.questionCard} aria-labelledby="review-question">
            <div className={styles.questionTopline}>
              <div className={styles.tagRow}>
                <span className={styles.lessonChip}>{currentSummary?.title ?? item.kind ?? "Review"}</span>
                <span className={styles.metaChip}>{difficultyLabel(item.question.difficulty, isFa)}</span>
                <span
                  className={`${styles.priorityBadge} ${styles[`priority_${priority.level}`]}`}
                  title={isFa ? priority.reasonFa : priority.reasonEn}
                  data-priority-version={REVIEW_PRIORITY_VERSION}
                >
                  {isFa ? "اولویت" : "Priority"} {priorityLabel(priority.level, isFa)}
                </span>
              </div>
              {previousAnswer ? (
                <span className={styles.previousAnswer}>
                  {isFa ? "پاسخ قبلی" : "Previous answer"}: <b dir="ltr">{previousAnswer}</b>
                </span>
              ) : null}
            </div>

            <h1
              className={styles.questionStem}
              id="review-question"
              dir={item.question.stem_locale.startsWith("fa") ? "rtl" : "ltr"}
            >
              {item.question.stem}
            </h1>
            <p className={styles.optionInstruction}>
              {isFa
                ? "یک گزینه را از حافظه انتخاب کنید. میانبرهای ۱ تا ۴ فعال‌اند."
                : "Choose from memory. Keyboard shortcuts 1–4 are available."}
            </p>

            <div className={styles.optionList} role="group" aria-labelledby="review-question">
              {item.question.options.map((option, index) => {
                const isSelected = selectedId === option.id;
                const status = feedback && option.id === feedback.correct_option_id
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
                    aria-keyshortcuts={`${index + 1}`}
                    onClick={() => setSelectedId(option.id)}
                  >
                    <span className={styles.optionKey}>{index + 1}</span>
                    <span className={styles.optionText} dir="ltr">{option.text}</span>
                    {status ? <span className={styles.optionStatus}>{status}</span> : <span />}
                  </button>
                );
              })}
            </div>

            {feedback ? (
              <div
                className={`${styles.feedbackCard} ${feedback.is_correct ? styles.feedbackCorrect : styles.feedbackIncorrect}`}
                aria-live="polite"
              >
                <div className={styles.feedbackHeading}>
                  <span className={styles.feedbackIcon} aria-hidden="true">{feedback.is_correct ? "✓" : "!"}</span>
                  <div>
                    <strong>
                      {feedback.is_correct
                        ? (isFa ? "درست پاسخ دادید" : "Correct")
                        : (isFa ? "نیاز به مرور دوباره" : "Needs another review")}
                    </strong>
                    {scheduleMessage ? <p>{scheduleMessage}</p> : null}
                  </div>
                </div>
                {feedback.full_explanation ? <p className={styles.fullExplanation}>{feedback.full_explanation}</p> : null}
              </div>
            ) : null}

            <div className={styles.questionFooter}>
              <div className={styles.repeatControl}>
                <button
                  className={styles.repeatButton}
                  type="button"
                  disabled={!feedback || !session}
                  aria-pressed={repeatRequested}
                  onClick={toggleRepeatInSession}
                >
                  <span aria-hidden="true">↻</span>
                  {repeatRequested
                    ? (isFa ? "لغو تکرار در همین جلسه" : "Remove session repeat")
                    : (isFa ? "تکرار در همین جلسه" : "Repeat in this session")}
                </button>
                <span className={styles.repeatStatus} aria-live="polite">
                  {repeatRequested && repeatQueueIndex >= 0
                    ? (isFa
                        ? `برای انتهای صف اضافه شد؛ نوبت ${formatNumber(repeatQueueIndex + 1, true)} از ${formatNumber(totalItems, true)}.`
                        : `Added to the end of this session: item ${repeatQueueIndex + 1} of ${totalItems}.`)
                    : (feedback
                        ? (isFa ? "در صورت نیاز می‌توانید همین مفهوم را دوباره در این جلسه ببینید." : "Optionally revisit this concept later in the same session.")
                        : (isFa ? "پس از ثبت پاسخ فعال می‌شود." : "Available after grading."))}
                </span>
              </div>
              {feedback ? (
                <button className={styles.primaryButton} type="button" onClick={goNext}>
                  {nextId || repeatPending ? (isFa ? "بعدی" : "Next") : (isFa ? "خلاصه جلسه" : "Session summary")}
                  <span aria-hidden="true">›</span>
                </button>
              ) : (
                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled={!selectedId || submitting}
                  onClick={() => void submit()}
                >
                  {submitting ? (isFa ? "در حال بررسی…" : "Checking…") : (isFa ? "ثبت پاسخ" : "Submit answer")}
                </button>
              )}
            </div>
          </section>
        )}
      </main>

      <aside
        dir={isFa ? "rtl" : "ltr"}
        className={styles.insightColumn}
        aria-label={isFa ? "تحلیل جلسه مرور" : "Review session insights"}
      >
        <section className={styles.progressCard} style={progressStyle}>
          <div className={styles.cardTitleRow}>
            <h2>{isFa ? "پیشرفت جلسه" : "Session progress"}</h2>
            <span className={styles.miniStatus}>{formatNumber(remainingCount, isFa)} {isFa ? "باقی‌مانده" : "left"}</span>
          </div>
          <div className={styles.progressBody}>
            <div className={styles.progressRing} role="img" aria-label={`${progressPct}%`}>
              <span>{formatNumber(progressPct, isFa)}%</span>
            </div>
            <dl className={styles.statsList}>
              <div><dt>{isFa ? "پاسخ داده‌شده" : "Answered"}</dt><dd>{formatNumber(answeredCount, isFa)}/{formatNumber(totalItems, isFa)}</dd></div>
              <div><dt><i className={styles.dotGreen} />{isFa ? "درست" : "Correct"}</dt><dd>{formatNumber(correctCount, isFa)}</dd></div>
              <div><dt><i className={styles.dotRed} />{isFa ? "غلط" : "Incorrect"}</dt><dd>{formatNumber(incorrectCount, isFa)}</dd></div>
              <div><dt><i className={styles.dotOrange} />{isFa ? "نیاز به مرور" : "Remaining"}</dt><dd>{formatNumber(remainingCount, isFa)}</dd></div>
            </dl>
          </div>
        </section>

        <section className={styles.priorityCard} aria-labelledby="priority-card-title">
          <div className={styles.cardTitleRow}>
            <h2 id="priority-card-title">{isFa ? "اولویت مرور" : "Review priority"}</h2>
            <span className={`${styles.priorityBadge} ${styles[`priority_${priority.level}`]}`}>
              {priorityLabel(priority.level, isFa)}
            </span>
          </div>
          <p>{isFa ? priority.reasonFa : priority.reasonEn}</p>
          <small>
            {priority.source === "api"
              ? (isFa ? "اولویت از API صف مرور دریافت شده است." : "Priority came from the review queue API.")
              : (isFa ? `محاسبه جایگزین نسخه ${REVIEW_PRIORITY_VERSION}` : `Fallback policy ${REVIEW_PRIORITY_VERSION}`)}
          </small>
        </section>

        {feedback ? (
          <>
            <section className={styles.misconceptionCard} aria-labelledby="misconception-card-title">
              <div className={styles.cardTitleRow}>
                <h2 id="misconception-card-title">{isFa ? "اشتباه محتمل شما" : "Likely misconception"}</h2>
                <span className={styles.repeatCountBadge}>
                  {formatNumber(currentSummary?.repeat_count ?? 0, isFa)}×
                </span>
              </div>
              {misconceptionLabel ? (
                <strong className={styles.misconception} dir="ltr">{misconceptionLabel}</strong>
              ) : (
                <strong className={styles.noInference}>
                  {isFa ? "الگوی خطای مشخصی ثبت نشده است" : "No specific error pattern is recorded"}
                </strong>
              )}
              {feedback.selected_option_explanation ? (
                <p>{feedback.selected_option_explanation}</p>
              ) : (
                <p>
                  {isFa
                    ? "برای این گزینه توضیح اختصاصی ثبت نشده؛ از حدس زدن نوع misconception خودداری شده است."
                    : "No option-specific explanation was returned, so no misconception is inferred beyond the recorded evidence."}
                </p>
              )}
            </section>

            <section className={styles.ruleCard} aria-labelledby="rule-card-title">
              <div className={styles.cardTitleRow}>
                <h2 id="rule-card-title">{isFa ? "قاعده مرتبط" : "Related rule"}</h2>
                <span className={styles.ruleIcon} aria-hidden="true">§</span>
              </div>
              {feedback.correct_option_explanation ? (
                <p className={styles.ruleLead} dir="auto">{feedback.correct_option_explanation}</p>
              ) : (
                <p className={styles.mutedCopy}>
                  {isFa ? "توضیح قاعده همراه پاسخ ثبت نشده است." : "No related-rule explanation was returned with this answer."}
                </p>
              )}
              {feedback.full_explanation && feedback.full_explanation !== feedback.correct_option_explanation ? (
                <details className={styles.ruleDetails}>
                  <summary>{isFa ? "توضیح کامل" : "Full explanation"}</summary>
                  <p dir="auto">{feedback.full_explanation}</p>
                </details>
              ) : null}
              <Link className={styles.inlineLink} href={`/${locale}/lessons`}>
                {isFa ? "مرور قاعده در درس‌ها" : "Review the rule in Lessons"}
              </Link>
            </section>

            <section className={styles.masteryCard} aria-labelledby="mastery-card-title">
              <div className={styles.cardTitleRow}>
                <h2 id="mastery-card-title">{isFa ? "اثر بر تسلط" : "Mastery impact"}</h2>
                <span className={`${styles.masterySignal} ${feedback.is_correct ? styles.masteryPositive : styles.masteryNegative}`}>
                  {feedback.is_correct ? "↗" : "↘"}
                </span>
              </div>
              <div className={styles.masteryHeadline}>
                <span aria-hidden="true">{feedback.is_correct ? "✓" : "!"}</span>
                <strong>
                  {scheduleAfter?.graduated
                    ? (isFa ? "این مورد تثبیت شد" : "This item graduated")
                    : feedback.is_correct
                      ? (isFa ? "شاهد مثبت یادگیری ثبت شد" : "Positive learning evidence recorded")
                      : (isFa ? "شاهد ضعف جدید ثبت شد" : "New weakness evidence recorded")}
                </strong>
              </div>
              <dl className={styles.masteryMetrics}>
                <div>
                  <dt>{isFa ? "فاصله مرور" : "Review interval"}</dt>
                  <dd>
                    {intervalBefore !== null ? formatNumber(intervalBefore, isFa) : "—"}
                    <span aria-hidden="true">→</span>
                    {intervalAfter !== null ? formatNumber(intervalAfter, isFa) : "—"}
                    <small>{isFa ? "روز" : "days"}</small>
                  </dd>
                </div>
                <div>
                  <dt>{isFa ? "درست متوالی" : "Correct streak"}</dt>
                  <dd>
                    {streakBefore !== null ? formatNumber(streakBefore, isFa) : "—"}
                    <span aria-hidden="true">→</span>
                    {streakAfter !== null ? formatNumber(streakAfter, isFa) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{isFa ? "وضعیت" : "State"}</dt>
                  <dd>{scheduleStateLabel(scheduleAfter, isFa)}</dd>
                </div>
                <div>
                  <dt>{isFa ? "مرور بعدی" : "Next due"}</dt>
                  <dd>{scheduleAfter?.graduated ? (isFa ? "خارج از صف" : "Out of queue") : formatDue(scheduleAfter?.due_at, isFa)}</dd>
                </div>
              </dl>
              {impactDelta !== null ? (
                <p className={styles.impactDelta}>
                  {isFa
                    ? `تغییر فاصله: ${impactDelta >= 0 ? "+" : ""}${formatNumber(impactDelta, true)} روز`
                    : `Interval change: ${impactDelta >= 0 ? "+" : ""}${impactDelta} days`}
                </p>
              ) : null}
              <small className={styles.masteryDisclaimer}>
                {isFa
                  ? "این کارت فقط اثر همین رویداد مرور را از داده SRS نشان می‌دهد؛ امتیاز آزمون اصلی بازنویسی نمی‌شود."
                  : "This card shows the effect of this review event from SRS evidence only; the original test score is not rewritten."}
              </small>
            </section>
          </>
        ) : (
          <section className={styles.learningLockedCard}>
            <span className={styles.lockedIcon} aria-hidden="true">◎</span>
            <h2>{isFa ? "تحلیل پس از پاسخ" : "Post-answer analysis"}</h2>
            <p>
              {isFa
                ? "ابتدا از حافظه پاسخ دهید؛ سپس Misconception، قاعده مرتبط و اثر بر تسلط نمایش داده می‌شود."
                : "Answer from memory first; misconception, related rule and mastery impact appear after grading."}
            </p>
          </section>
        )}

        <section className={styles.recommendationCard}>
          <h2>{isFa ? "تمرین‌های پیشنهادی" : "Suggested practice"}</h2>
          <Link href={`/${locale}/tests/new?mode=review`} className={styles.recommendationLink}>
            <span aria-hidden="true">◎</span>
            <span>{isFa ? "تمرین این زیرموضوع" : "Practice this subtopic"}</span>
          </Link>
          <Link href={`/${locale}/tests/new?mode=mistakes`} className={styles.recommendationLink}>
            <span aria-hidden="true">▣</span>
            <span>{isFa ? "سؤال‌های مشابه بیشتر" : "More similar questions"}</span>
          </Link>
          <Link href={`/${locale}/lessons`} className={styles.recommendationLink}>
            <span aria-hidden="true">⌂</span>
            <span>{isFa ? "مرور قاعده در درس‌ها" : "Review the rule in Lessons"}</span>
          </Link>
        </section>
      </aside>
    </div>
  );
}

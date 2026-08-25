"use client";

import {type CSSProperties, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useRouter} from "next/navigation";
import type {AnswerFeedback, AnswerReceiptEnvelope, AttemptQuestion, NextQuestionEnvelope} from "@/lib/api/types";
import {ApiError, apiRequest, isTransient} from "@/lib/api/client";
import {
  getPendingAnswer,
  pendingAnswerKey,
  putPendingAnswer,
  removePendingAnswer,
  type PendingAnswerRecord,
} from "@/lib/offline/pending-answer-store";
import type {Locale} from "@/lib/i18n";
import {t} from "@/lib/i18n";
import {ThemeToggle} from "@/components/navigation/ThemeToggle";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import {Progress} from "./Progress";
import {QuestionCard} from "./QuestionCard";
import {Explanation} from "./Explanation";
import styles from "./AttemptRunner.module.css";

type RunnerPhase = "loading" | "ready" | "submitting" | "feedback" | "offline" | "error";
type ReportReason = "AMBIGUOUS" | "TYPO" | "ANSWER" | "CONTENT" | "OTHER";

type AttemptMeta = {
  question_count?: number;
  test_id?: string;
  mode?: string;
};

type ReportDraft = {
  schema_version: "runner-report-draft-v1";
  created_at: string;
  attempt_id: string;
  test_question_id: string;
  question_revision_id: string;
  position: number;
  reason: ReportReason;
  note: string;
  selected_option_id: string | null;
  stem: string;
  locale: Locale;
};

const BOOKMARK_KEY = "gmp-runner-bookmarks-v1";
const REPORT_DRAFT_KEY = "gmp-runner-report-drafts-v1";

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function AttemptRunner({
  attemptId,
  locale,
  expectedTotal,
}: {
  attemptId: string;
  locale: Locale;
  expectedTotal?: number;
}) {
  const labels = t(locale);
  const isFa = locale === "fa";
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startedAtRef = useRef<number>(0);
  const completionKeyRef = useRef<string>("");
  const pendingRef = useRef<PendingAnswerRecord | null>(null);
  const [phase, setPhase] = useState<RunnerPhase>("loading");
  const [question, setQuestion] = useState<AttemptQuestion | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [totalQuestions, setTotalQuestions] = useState<number | undefined>(expectedTotal);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showTimer, setShowTimer] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("AMBIGUOUS");
  const [reportNote, setReportNote] = useState("");
  const [reportSaved, setReportSaved] = useState(false);

  const copy = useMemo(() => isFa ? {
    focus: "حالت تمرکز",
    elapsed: "زمان",
    more: "تنظیمات تمرین",
    hideTimer: "پنهان‌کردن زمان",
    showTimer: "نمایش زمان",
    progress: "پیشرفت آزمون",
    answered: "پاسخ داده شده",
    unanswered: "پاسخ نداده",
    marked: "علامت‌گذاری شده",
    guides: "راهنماها",
    relatedRule: "قاعده مرتبط",
    explanation: "نکته و توضیح",
    misconception: "اشتباه رایج",
    keyboard: "کلیدهای صفحه‌کلید",
    chooseWith: "برای انتخاب گزینه",
    submitWith: "برای ثبت پاسخ",
    nextWith: "برای سؤال بعدی",
    bookmark: "علامت‌گذاری",
    bookmarked: "علامت‌گذاری شد",
    report: "گزارش مشکل",
    reportTitle: "گزارش مشکل در سؤال",
    reportIntro: "در قرارداد فعلی API، endpoint ارسال گزارش کاربر وجود ندارد. این فرم یک پیش‌نویس ساخت‌یافته و قابل ارسال برای تیم محتوا ایجاد می‌کند.",
    reason: "نوع مشکل",
    note: "توضیح تکمیلی",
    saveReport: "ذخیره پیش‌نویس گزارش",
    savedReport: "پیش‌نویس گزارش ذخیره و دانلود شد.",
    cancel: "انصراف",
    reasonAmbiguous: "سؤال یا گزینه‌ها مبهم است",
    reasonTypo: "اشتباه تایپی / نگارشی",
    reasonAnswer: "پاسخ صحیح مشکوک است",
    reasonContent: "توضیح یا محتوای آموزشی مشکل دارد",
    reasonOther: "سایر موارد",
    confirmExit: "از آزمون خارج شوید؟ پاسخ‌های ثبت‌شده محفوظ می‌مانند، اما انتخاب ثبت‌نشده از بین می‌رود.",
    unknownTotal: "تعداد کل سؤال‌ها در این ورود در دسترس نیست",
    submitHint: "Enter",
  } : {
    focus: "Focus mode",
    elapsed: "Time",
    more: "Practice settings",
    hideTimer: "Hide timer",
    showTimer: "Show timer",
    progress: "Test progress",
    answered: "Answered",
    unanswered: "Unanswered",
    marked: "Bookmarked",
    guides: "Guides",
    relatedRule: "Related rule",
    explanation: "Explanation",
    misconception: "Misconception",
    keyboard: "Keyboard shortcuts",
    chooseWith: "Choose an option",
    submitWith: "Submit answer",
    nextWith: "Next question",
    bookmark: "Bookmark",
    bookmarked: "Bookmarked",
    report: "Report issue",
    reportTitle: "Report a question issue",
    reportIntro: "The current API contract has no learner-report submission endpoint. This form creates a structured report draft you can send to the content team.",
    reason: "Issue type",
    note: "Additional note",
    saveReport: "Save report draft",
    savedReport: "Report draft saved and downloaded.",
    cancel: "Cancel",
    reasonAmbiguous: "Question or options are ambiguous",
    reasonTypo: "Typo or language issue",
    reasonAnswer: "The keyed answer looks wrong",
    reasonContent: "Explanation or learning content issue",
    reasonOther: "Other",
    confirmExit: "Exit this test? Submitted answers are safe, but an unsubmitted selection will be lost.",
    unknownTotal: "Total question count is not available in this entry context",
    submitHint: "Enter",
  }, [isFa]);

  useEffect(() => {
    if (!expectedTotal || expectedTotal < 1) {
      try {
        const raw = window.sessionStorage.getItem(`gmp-attempt-meta:${attemptId}`);
        if (raw) {
          const meta = JSON.parse(raw) as AttemptMeta;
          if (typeof meta.question_count === "number" && meta.question_count > 0) setTotalQuestions(meta.question_count);
        }
      } catch {
        // Optional enhancement only; runner remains valid without this metadata.
      }
    }

    try {
      const stored = safeReadJson<Record<string, string[]>>(BOOKMARK_KEY, {});
      setBookmarks(Array.isArray(stored[attemptId]) ? stored[attemptId] : []);
    } catch {
      setBookmarks([]);
    }

    const startKey = `gmp-runner-start:${attemptId}`;
    let epoch = Date.now();
    try {
      const stored = Number(window.sessionStorage.getItem(startKey));
      if (Number.isFinite(stored) && stored > 0) epoch = stored;
      else window.sessionStorage.setItem(startKey, String(epoch));
    } catch {
      // Timer can still run for this page lifecycle.
    }
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - epoch) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [attemptId, expectedTotal]);

  const completeAttempt = useCallback(async () => {
    try {
      completionKeyRef.current ||= crypto.randomUUID();
      await apiRequest(`/api/backend/attempts/${attemptId}/complete`, {
        method: "POST",
        headers: {"Idempotency-Key": completionKeyRef.current},
      });
      try { window.sessionStorage.removeItem(`gmp-runner-start:${attemptId}`); } catch {}
      router.replace(`/${locale}/attempts/${attemptId}/result`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Completion failed."}));
      setPhase("error");
    }
  }, [attemptId, locale, router]);

  const loadQuestion = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const envelope = await apiRequest<NextQuestionEnvelope>(`/api/backend/attempts/${attemptId}/next`);
      if (!envelope) {
        await completeAttempt();
        return;
      }
      setQuestion(envelope.data);
      setSelectedOptionId(null);
      setFeedback(null);
      setReportSaved(false);
      startedAtRef.current = performance.now();
      const pending = await getPendingAnswer(attemptId, envelope.data.test_question_id);
      if (pending) {
        pendingRef.current = pending;
        setSelectedOptionId(pending.selected_option_id);
        setPhase("offline");
      } else {
        pendingRef.current = null;
        setPhase("ready");
      }
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Question loading failed."}));
      setPhase("error");
    }
  }, [attemptId, completeAttempt]);

  useEffect(() => { void loadQuestion(); }, [loadQuestion]);

  const acceptReceipt = useCallback(async (envelope: AnswerReceiptEnvelope, record: PendingAnswerRecord) => {
    await removePendingAnswer(record.attempt_id, record.test_question_id);
    pendingRef.current = null;
    setFeedback(envelope.data.feedback);
    setPhase("feedback");
  }, []);

  const sendRecord = useCallback(async (record: PendingAnswerRecord) => {
    setPhase("submitting");
    setError(null);
    try {
      const envelope = await apiRequest<AnswerReceiptEnvelope>(`/api/backend/attempts/${attemptId}/answers`, {
        method: "POST",
        headers: {"Idempotency-Key": record.idempotency_key},
        body: JSON.stringify({
          test_question_id: record.test_question_id,
          selected_option_id: record.selected_option_id,
          response_ms: record.response_ms,
        }),
      });
      if (!envelope) throw new ApiError({status: 502, code: "EMPTY_ANSWER_RECEIPT", message: "The answer receipt was empty."});
      await acceptReceipt(envelope, record);
    } catch (caught) {
      if (isTransient(caught)) {
        await putPendingAnswer(record);
        pendingRef.current = record;
        setError(caught);
        setPhase("offline");
        return;
      }
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Answer submission failed."}));
      setPhase("error");
    }
  }, [acceptReceipt, attemptId]);

  const submit = useCallback(() => {
    if (!question || !selectedOptionId || phase === "submitting") return;
    const record: PendingAnswerRecord = {
      key: pendingAnswerKey(attemptId, question.test_question_id),
      attempt_id: attemptId,
      test_question_id: question.test_question_id,
      selected_option_id: selectedOptionId,
      response_ms: Math.min(86400000, Math.max(0, Math.round(performance.now() - startedAtRef.current))),
      idempotency_key: pendingRef.current?.idempotency_key ?? crypto.randomUUID(),
      queued_at: pendingRef.current?.queued_at ?? new Date().toISOString(),
    };
    pendingRef.current = record;
    void sendRecord(record);
  }, [attemptId, phase, question, selectedOptionId, sendRecord]);

  const retry = useCallback(() => {
    if (pendingRef.current) void sendRecord(pendingRef.current);
    else void loadQuestion();
  }, [loadQuestion, sendRecord]);

  useEffect(() => {
    const onOnline = () => { if (pendingRef.current) void sendRecord(pendingRef.current); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sendRecord]);

  const toggleBookmark = useCallback(() => {
    if (!question) return;
    const id = question.question_revision_id;
    setBookmarks((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      try {
        const all = safeReadJson<Record<string, string[]>>(BOOKMARK_KEY, {});
        all[attemptId] = next;
        window.localStorage.setItem(BOOKMARK_KEY, JSON.stringify(all));
      } catch {
        // Local bookmarking is a convenience; question answering must never fail because storage is blocked.
      }
      return next;
    });
  }, [attemptId, question]);

  const saveReportDraft = useCallback(() => {
    if (!question) return;
    const draft: ReportDraft = {
      schema_version: "runner-report-draft-v1",
      created_at: new Date().toISOString(),
      attempt_id: attemptId,
      test_question_id: question.test_question_id,
      question_revision_id: question.question_revision_id,
      position: question.position,
      reason: reportReason,
      note: reportNote.trim(),
      selected_option_id: selectedOptionId,
      stem: question.stem,
      locale,
    };
    try {
      const existing = safeReadJson<ReportDraft[]>(REPORT_DRAFT_KEY, []);
      window.localStorage.setItem(REPORT_DRAFT_KEY, JSON.stringify([draft, ...existing].slice(0, 50)));
    } catch {
      // Download below still makes the action useful when localStorage is unavailable.
    }
    const blob = new Blob([JSON.stringify(draft, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `question-report-${question.position}-${question.question_revision_id.slice(0, 8)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    void navigator.clipboard?.writeText(JSON.stringify(draft, null, 2)).catch(() => undefined);
    setReportSaved(true);
  }, [attemptId, locale, question, reportNote, reportReason, selectedOptionId]);

  const exitRunner = useCallback(() => {
    const hasUnsavedSelection = phase === "ready" && Boolean(selectedOptionId);
    if (hasUnsavedSelection && !window.confirm(copy.confirmExit)) return;
    router.push(`/${locale}/dashboard`);
  }, [copy.confirmExit, locale, phase, router, selectedOptionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.isContentEditable)) return;
      if (!question || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") {
        setMenuOpen(false);
        setReportOpen(false);
        return;
      }
      if (phase === "ready" && /^[1-4]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const option = question.options[index];
        if (option) {
          event.preventDefault();
          setSelectedOptionId(option.id);
        }
      } else if (phase === "ready" && event.key === "Enter" && selectedOptionId) {
        event.preventDefault();
        submit();
      } else if (phase === "feedback" && ["n", "Enter"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        void loadQuestion();
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleBookmark();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setReportOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loadQuestion, phase, question, selectedOptionId, submit, toggleBookmark]);

  if (phase === "loading" && !question) {
    return (
      <div className={`${styles.page} question-runner-page`} dir={isFa ? "rtl" : "ltr"}>
        <div className={styles.loadingWrap}><LoadingCard label={labels.loading} /></div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className={`${styles.page} question-runner-page`} dir={isFa ? "rtl" : "ltr"}>
        <div className={styles.loadingWrap}>
          <StatusPanel title={error?.message ?? "Question unavailable"} tone="danger" requestId={error?.requestId} action={{label: labels.retry, onClick: retry}}>
            <p>{error?.code ?? "UNKNOWN_ERROR"}</p>
          </StatusPanel>
        </div>
      </div>
    );
  }

  const offline = phase === "offline";
  const primaryLabel = offline ? labels.retry : phase === "feedback" ? labels.next : labels.submit;
  const onPrimary = offline ? retry : phase === "feedback" ? () => { void loadQuestion(); } : submit;
  const bookmarked = bookmarks.includes(question.question_revision_id);
  const answeredCount = Math.max(0, question.position - 1 + (phase === "feedback" ? 1 : 0));
  const remainingCount = totalQuestions ? Math.max(0, totalQuestions - answeredCount) : undefined;
  const percent = totalQuestions ? Math.min(100, Math.round((answeredCount / totalQuestions) * 100)) : undefined;
  const hasMisconception = Boolean(feedback && !feedback.is_correct && feedback.selected_option_explanation);
  const hasRelatedRule = Boolean(feedback?.correct_option_explanation || feedback?.full_explanation);

  return (
    <div className={`${styles.page} question-runner-page`} dir={isFa ? "rtl" : "ltr"}>
      <header className={styles.focusHeader}>
        <div className={styles.exitArea}>
          <button className={styles.exitButton} type="button" onClick={exitRunner}>
            <span aria-hidden="true">‹</span><span>{labels.exit}</span>
          </button>
        </div>

        <div className={styles.progressArea}>
          <Progress current={question.position} total={totalQuestions} completed={answeredCount} label={labels.question} />
        </div>

        <div className={styles.utilityArea}>
          {showTimer ? (
            <div className={styles.timerBox} aria-label={`${copy.elapsed} ${formatElapsed(elapsedSeconds)}`}>
              <span className={styles.timerIcon} aria-hidden="true">◷</span>
              <span><small>{copy.elapsed}</small><strong dir="ltr">{formatElapsed(elapsedSeconds)}</strong></span>
            </div>
          ) : null}
          <div className={styles.menuWrap}>
            <button className={styles.moreButton} type="button" aria-label={copy.more} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>•••</button>
            {menuOpen ? (
              <div className={styles.menuPopover}>
                <ThemeToggle locale={locale} />
                <button type="button" className={styles.menuAction} onClick={() => setShowTimer((value) => !value)}>{showTimer ? copy.hideTimer : copy.showTimer}</button>
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.brandArea} aria-label={labels.productName}>
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 48 48" role="img"><path d="M7 12.5c7.2 0 12.8 2.2 17 6.5 4.2-4.3 9.8-6.5 17-6.5v24.2c-6.8 0-12.5 1.9-17 5.8-4.5-3.9-10.2-5.8-17-5.8V12.5Z" fill="none" stroke="currentColor" strokeWidth="2.4"/><path d="M24 19v23M18.5 8.5 24 4l5.5 4.5M24 4v10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span><strong>GRAMMAR</strong><small>MASTERY</small></span>
        </div>
      </header>

      <div className={styles.workspace}>
        <main className={styles.mainColumn}>
          <QuestionCard
            ref={headingRef}
            question={question}
            selectedOptionId={selectedOptionId}
            feedback={feedback}
            locked={phase === "loading" || phase === "submitting" || phase === "feedback" || offline}
            onSelect={setSelectedOptionId}
            labels={{correct: labels.correct, incorrect: labels.incorrect, selectAnswer: labels.selectAnswer}}
            uiLocale={locale}
            actions={{
              bookmarked,
              bookmarkLabel: bookmarked ? copy.bookmarked : copy.bookmark,
              reportLabel: copy.report,
              onBookmark: toggleBookmark,
              onReport: () => { setReportSaved(false); setReportOpen(true); },
            }}
          />

          {feedback ? (
            <Explanation
              feedback={feedback}
              locale={locale}
              labels={{
                correct: labels.correct,
                incorrect: labels.incorrect,
                explanation: labels.explanation,
                misconception: copy.misconception,
                relatedRule: copy.relatedRule,
              }}
            />
          ) : null}

          {offline ? (
            <StatusPanel title={labels.queued} tone="warning" requestId={error?.requestId}><p>{error?.message}</p></StatusPanel>
          ) : phase === "error" && error ? (
            <StatusPanel title={error.message} tone="danger" requestId={error.requestId}><p>{error.code}</p></StatusPanel>
          ) : null}
        </main>

        <aside className={styles.sideRail} aria-label={copy.progress}>
          <section className={styles.sideCard}>
            <h2>{copy.progress}</h2>
            <div className={styles.progressSummary}>
              <div className={styles.progressRing} style={{"--runner-progress": `${percent ?? 0}%`} as CSSProperties}>
                <span>{percent === undefined ? question.position : `${percent}%`}</span>
              </div>
              <dl>
                <div><dt>{copy.answered}</dt><dd>{answeredCount}</dd></div>
                <div><dt>{copy.unanswered}</dt><dd>{remainingCount ?? "—"}</dd></div>
                <div><dt>{copy.marked}</dt><dd>{bookmarks.length}</dd></div>
              </dl>
            </div>
            {!totalQuestions ? <p className={styles.sideNote}>{copy.unknownTotal}</p> : null}
          </section>

          <section className={styles.sideCard}>
            <h2>{copy.guides}</h2>
            <div className={styles.guideList}>
              <a href="#runner-related-rule" aria-disabled={!hasRelatedRule} className={!hasRelatedRule ? styles.guideDisabled : undefined}><span aria-hidden="true">▣</span>{copy.relatedRule}</a>
              <a href="#runner-explanation" aria-disabled={!feedback} className={!feedback ? styles.guideDisabled : undefined}><span aria-hidden="true">◉</span>{copy.explanation}</a>
              <a href="#runner-misconception" aria-disabled={!hasMisconception} className={!hasMisconception ? styles.guideDisabled : undefined}><span aria-hidden="true">△</span>{copy.misconception}</a>
            </div>
          </section>

          <section className={styles.sideCard}>
            <h2>{copy.keyboard}</h2>
            <div className={styles.keyRow} aria-label="1 2 3 4"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd></div>
            <p>{copy.chooseWith}</p>
            <div className={styles.shortcutLine}><kbd>Enter</kbd><span>{phase === "feedback" ? copy.nextWith : copy.submitWith}</span></div>
            <div className={styles.shortcutLine}><kbd>B</kbd><span>{copy.bookmark}</span></div>
            <div className={styles.shortcutLine}><kbd>R</kbd><span>{copy.report}</span></div>
          </section>
        </aside>
      </div>

      <div className={styles.bottomBar}>
        <div className={styles.bottomInner}>
          <button className={styles.mobileBookmark} type="button" aria-pressed={bookmarked} onClick={toggleBookmark}>{bookmarked ? "★" : "☆"}<span>{bookmarked ? copy.bookmarked : copy.bookmark}</span></button>
          <span className={styles.enterHint}><kbd>{copy.submitHint}</kbd><span>{phase === "feedback" ? copy.nextWith : copy.submitWith}</span></span>
          <button className={styles.primaryAction} type="button" disabled={(!selectedOptionId && phase === "ready") || phase === "submitting"} aria-busy={phase === "submitting"} onClick={onPrimary}>
            <span>{primaryLabel}</span><span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      {reportOpen ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setReportOpen(false)}>
          <section className={styles.reportDialog} role="dialog" aria-modal="true" aria-labelledby="runner-report-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.dialogHeading}>
              <div><p>{copy.report}</p><h2 id="runner-report-title">{copy.reportTitle}</h2></div>
              <button type="button" aria-label={copy.cancel} onClick={() => setReportOpen(false)}>×</button>
            </div>
            <p className={styles.reportIntro}>{copy.reportIntro}</p>
            <label className={styles.reportField}><span>{copy.reason}</span><select value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)}>
              <option value="AMBIGUOUS">{copy.reasonAmbiguous}</option>
              <option value="TYPO">{copy.reasonTypo}</option>
              <option value="ANSWER">{copy.reasonAnswer}</option>
              <option value="CONTENT">{copy.reasonContent}</option>
              <option value="OTHER">{copy.reasonOther}</option>
            </select></label>
            <label className={styles.reportField}><span>{copy.note}</span><textarea value={reportNote} rows={4} maxLength={1000} onChange={(event) => setReportNote(event.target.value)} /></label>
            {reportSaved ? <p className={styles.reportSuccess} role="status">✓ {copy.savedReport}</p> : null}
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondaryAction} onClick={() => setReportOpen(false)}>{copy.cancel}</button>
              <button type="button" className={styles.primaryDialogAction} onClick={saveReportDraft}>{copy.saveReport}</button>
            </div>
          </section>
        </div>
      ) : null}

      <p className="visually-hidden" aria-live="polite">
        {phase === "submitting" ? labels.loading : phase === "offline" ? labels.queued : feedback ? (feedback.is_correct ? labels.correct : labels.incorrect) : ""}
      </p>
    </div>
  );
}

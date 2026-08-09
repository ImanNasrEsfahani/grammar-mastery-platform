"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnswerFeedback, AnswerReceiptEnvelope, AttemptQuestion, NextQuestionEnvelope } from "@/lib/api/types";
import { ApiError, apiRequest, isTransient } from "@/lib/api/client";
import {
  getPendingAnswer,
  pendingAnswerKey,
  putPendingAnswer,
  removePendingAnswer,
  type PendingAnswerRecord,
} from "@/lib/offline/pending-answer-store";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { LoadingCard } from "@/components/ui/LoadingCard";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { Progress } from "./Progress";
import { QuestionCard } from "./QuestionCard";
import { Explanation } from "./Explanation";
import { Navigation } from "./Navigation";

type RunnerPhase = "loading" | "ready" | "submitting" | "feedback" | "offline" | "error";

export function AttemptRunner({attemptId, locale}: {attemptId: string; locale: Locale}) {
  const labels = t(locale);
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

  const completeAttempt = useCallback(async () => {
    try {
      completionKeyRef.current ||= crypto.randomUUID();
      await apiRequest(`/api/backend/attempts/${attemptId}/complete`, {
        method: "POST",
        headers: {"Idempotency-Key": completionKeyRef.current},
      });
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

  // Initial fetch synchronizes this client runner with the authenticated server attempt.
  // eslint-disable-next-line react-hooks/set-state-in-effect
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!question || event.altKey || event.ctrlKey || event.metaKey) return;
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
      } else if (phase === "feedback" && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void loadQuestion();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loadQuestion, phase, question, selectedOptionId, submit]);

  if (phase === "loading" && !question) return <div className="runner-shell"><LoadingCard label={labels.loading} /></div>;
  if (!question) {
    return (
      <div className="runner-shell">
        <StatusPanel
          title={error?.message ?? "Question unavailable"}
          tone="danger"
          requestId={error?.requestId}
          action={{label: labels.retry, onClick: retry}}
        >
          <p>{error?.code ?? "UNKNOWN_ERROR"}</p>
        </StatusPanel>
      </div>
    );
  }

  const offline = phase === "offline";
  const primaryLabel = offline ? labels.retry : phase === "feedback" ? labels.next : labels.submit;
  const onPrimary = offline ? retry : phase === "feedback" ? () => { void loadQuestion(); } : submit;

  return (
    <div className="runner-shell stack">
      <Progress current={question.position} label={labels.question} />
      <QuestionCard
        ref={headingRef}
        question={question}
        selectedOptionId={selectedOptionId}
        feedback={feedback}
        locked={phase === "loading" || phase === "submitting" || phase === "feedback" || offline}
        onSelect={setSelectedOptionId}
        labels={{correct: labels.correct, incorrect: labels.incorrect, selectAnswer: labels.selectAnswer}}
      />
      {feedback ? <Explanation feedback={feedback} labels={{correct: labels.correct, incorrect: labels.incorrect, explanation: labels.explanation}} /> : null}
      {offline ? (
        <StatusPanel title={labels.queued} tone="warning" requestId={error?.requestId}>
          <p>{error?.message}</p>
        </StatusPanel>
      ) : phase === "error" && error ? (
        <StatusPanel title={error.message} tone="danger" requestId={error.requestId}>
          <p>{error.code}</p>
        </StatusPanel>
      ) : null}
      <Navigation
        exitHref={`/${locale}/dashboard`}
        exitLabel={labels.exit}
        primaryLabel={primaryLabel}
        primaryDisabled={!selectedOptionId && phase === "ready"}
        busy={phase === "submitting"}
        onPrimary={onPrimary}
      />
      <p className="visually-hidden" aria-live="polite">
        {phase === "submitting" ? labels.loading : phase === "offline" ? labels.queued : feedback ? (feedback.is_correct ? labels.correct : labels.incorrect) : ""}
      </p>
    </div>
  );
}

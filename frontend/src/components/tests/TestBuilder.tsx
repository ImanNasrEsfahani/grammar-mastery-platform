"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { StartedAttemptEnvelope, TestCreateRequest, TestEnvelope } from "@/lib/api/types";
import type { Locale } from "@/lib/i18n";
import { StatusPanel } from "@/components/ui/StatusPanel";

export function TestBuilder({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const router = useRouter();
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<TestCreateRequest["mode"]>("adaptive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const config: TestCreateRequest = {
      schema_version: mode === "adaptive" ? "adaptive-selection-config-v0.9.0" : "test-config-schema-v0.9.0",
      mode,
      question_count: count,
      scope: {all_active_lessons: true},
      difficulty_mix_pct: {EASY: 20, MEDIUM: 40, HARD: 30, VERY_HARD: 10},
    };
    let testCreated = false;
    try {
      const test = await apiRequest<TestEnvelope>("/api/backend/tests", {
        method: "POST",
        headers: {"Idempotency-Key": crypto.randomUUID()},
        body: JSON.stringify(config),
      });
      if (!test) throw new ApiError({status: 502, code: "EMPTY_TEST", message: "Test creation returned no resource."});
      testCreated = true;
      const attempt = await apiRequest<StartedAttemptEnvelope>(`/api/backend/tests/${test.data.id}/attempts`, {
        method: "POST",
        headers: {"Idempotency-Key": crypto.randomUUID()},
      });
      if (!attempt) throw new ApiError({status: 502, code: "EMPTY_ATTEMPT", message: "Attempt creation returned no resource."});
      router.push(`/${locale}/attempts/${attempt.data.id}`);
    } catch (caught) {
      if (testCreated && caught instanceof ApiError) {
        setError(new ApiError({
          status: caught.status,
          code: caught.code,
          message: isFa ? "آزمون ساخته شد، اما شروع اجرای آن ناموفق بود." : "The test was created, but its attempt could not be started.",
          fields: caught.fields,
          requestId: caught.requestId,
          retryAfter: caught.retryAfter,
        }));
      } else {
        setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Test creation failed."}));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface form-surface stack">
      {error ? (
        <StatusPanel title={error.code === "NO_ELIGIBLE_QUESTIONS" ? (isFa ? "هنوز سؤال منتشرشده‌ای وجود ندارد" : "No published questions are available yet") : error.message} tone={error.code === "NO_ELIGIBLE_QUESTIONS" ? "warning" : "danger"} requestId={error.requestId}>
          <p>{error.code === "NO_ELIGIBLE_QUESTIONS" ? (isFa ? "پس از بازبینی مستقل و انتشار بانک سؤال، تمرین فعال می‌شود." : "Practice will activate after independent review and publication of the question bank.") : error.code}</p>
        </StatusPanel>
      ) : null}
      <form className="stack" onSubmit={create}>
        <div className="form-field">
          <label htmlFor="mode">{isFa ? "نوع تمرین" : "Practice mode"}</label>
          <select id="mode" value={mode} onChange={(event) => setMode(event.target.value as TestCreateRequest["mode"])}>
            <option value="adaptive">{isFa ? "تطبیقی" : "Adaptive"}</option>
            <option value="tcf">TCF</option>
            <option value="custom">{isFa ? "سفارشی" : "Custom"}</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="question-count">{isFa ? "تعداد سؤال" : "Question count"}</label>
          <input id="question-count" type="number" min={1} max={100} inputMode="numeric" value={count} onChange={(event) => setCount(Math.min(100, Math.max(1, Number(event.target.value))))} />
        </div>
        <button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>{busy ? (isFa ? "در حال آماده‌سازی…" : "Preparing…") : (isFa ? "شروع تمرین" : "Start practice")}</button>
      </form>
    </div>
  );
}

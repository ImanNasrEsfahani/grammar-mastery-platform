import { describe, expect, it } from "vitest";
import { getPendingAnswer, pendingAnswerKey, putPendingAnswer, removePendingAnswer } from "./pending-answer-store";

describe("pending answer storage", () => {
  it("round-trips only the retry-safe answer record", async () => {
    const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const questionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const record = {
      key: pendingAnswerKey(attemptId, questionId),
      attempt_id: attemptId,
      test_question_id: questionId,
      selected_option_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      response_ms: 1400,
      idempotency_key: "99999999-9999-4999-8999-999999999999",
      queued_at: "2026-08-09T05:00:00Z",
    };
    await putPendingAnswer(record);
    await expect(getPendingAnswer(attemptId, questionId)).resolves.toEqual(record);
    await removePendingAnswer(attemptId, questionId);
    await expect(getPendingAnswer(attemptId, questionId)).resolves.toBeNull();
    expect(JSON.stringify(record)).not.toContain("access_token");
    expect(JSON.stringify(record)).not.toContain("correct_option_id");
  });
});

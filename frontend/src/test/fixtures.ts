import type { AnswerReceiptEnvelope, AttemptQuestion, NextQuestionEnvelope } from "@/lib/api/types";

export const ids = {
  attempt: "11111111-1111-4111-8111-111111111111",
  question: "22222222-2222-4222-8222-222222222222",
  revision: "33333333-3333-4333-8333-333333333333",
  optionA: "44444444-4444-4444-8444-444444444444",
  optionB: "55555555-5555-4555-8555-555555555555",
  optionC: "66666666-6666-4666-8666-666666666666",
  optionD: "77777777-7777-4777-8777-777777777777",
  answer: "88888888-8888-4888-8888-888888888888",
};

export const question: AttemptQuestion = {
  test_question_id: ids.question,
  question_revision_id: ids.revision,
  position: 7,
  stem: "Il faut que tu ___ à l'heure.",
  stem_locale: "fr-FR",
  question_type: "MCQ_SINGLE",
  difficulty: "MEDIUM",
  options: [
    {id: ids.optionA, position: "A", text: "viens"},
    {id: ids.optionB, position: "B", text: "viennes"},
    {id: ids.optionC, position: "C", text: "viendras"},
    {id: ids.optionD, position: "D", text: "venir"},
  ],
};

export const nextEnvelope: NextQuestionEnvelope = {
  data: question,
  meta: {request_id: "request-next-123", api_version: "v1"},
};

export const receiptEnvelope: AnswerReceiptEnvelope = {
  data: {
    answer_id: ids.answer,
    attempt_id: ids.attempt,
    test_question_id: ids.question,
    answered_at: "2026-08-09T05:00:00Z",
    feedback: {
      is_correct: true,
      selected_option_id: ids.optionB,
      correct_option_id: ids.optionB,
      selected_option_explanation: "The subjunctive follows il faut que.",
      correct_option_explanation: "Use viennes, the present subjunctive.",
      full_explanation: "Il faut que requires the present subjunctive: tu viennes.",
    },
    mastery: {
      scope_type: "SUBTOPIC",
      scope_id: ids.revision,
      mastery_score_pct: 64,
      confidence: 0.56,
      coverage_ratio: 0.43,
      evidence_count: 6,
      mastery_band: "DEVELOPING",
      model_version: "mastery-provider-contract-v0.9.0",
    },
    review_item_id: null,
    review_schedule: {},
  },
  meta: {request_id: "request-answer-123", api_version: "v1"},
};

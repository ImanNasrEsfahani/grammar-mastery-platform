import {render, screen} from "@testing-library/react";
import {afterEach, expect, test, vi} from "vitest";
import {apiRequest} from "@/lib/api/client";
import {AttemptResultClient} from "./AttemptResultClient";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const LESSON_ID = "22222222-2222-4222-8222-222222222222";
const SUBTOPIC_A = "33333333-3333-4333-8333-333333333333";
const SUBTOPIC_B = "44444444-4444-4444-8444-444444444444";
const REVIEW_ID = "55555555-5555-4555-8555-555555555555";

function envelope() {
  const common = {
    lesson_id: LESSON_ID,
    lesson_no: 32,
    lesson_title_fr: "LES RELATIFS",
    total: 2,
    correct: 1,
    incorrect: 1,
    accuracy_pct: 50,
    mastery_before_pct: 58,
    mastery_after_pct: 61,
    mastery_delta_pct: 3,
    mastery_confidence_after: .62,
    mastery_coverage_after: 1,
    mastery_band_after: "DEVELOPING" as const,
    new_evidence: false,
  };
  return {
    data: {
      attempt_id: ATTEMPT_ID,
      test_id: "66666666-6666-4666-8666-666666666666",
      status: "COMPLETED" as const,
      mode: "adaptive",
      test_title: null,
      score_raw: 3,
      score_pct: 75,
      question_count: 4,
      correct_count: 3,
      incorrect_count: 1,
      accuracy_pct: 75,
      started_at: "2026-08-24T18:00:00Z",
      completed_at: "2026-08-24T18:12:24Z",
      duration_seconds: 744,
      average_response_ms: 18600,
      lessons: [{id: LESSON_ID, lesson_no: 32, title_fr: "LES RELATIFS", short_title: "Relatifs"}],
      difficulty_analysis: [
        {difficulty: "EASY" as const, total: 1, correct: 1, incorrect: 0, accuracy_pct: 100},
        {difficulty: "MEDIUM" as const, total: 2, correct: 1, incorrect: 1, accuracy_pct: 50},
        {difficulty: "HARD" as const, total: 1, correct: 1, incorrect: 0, accuracy_pct: 100},
        {difficulty: "VERY_HARD" as const, total: 0, correct: 0, incorrect: 0, accuracy_pct: null},
      ],
      subtopic_analysis: [
        {...common, subtopic_id: SUBTOPIC_A, subtopic_title_fr: "Relatif « qui »", subtopic_title_fa: "ضمیر موصولی qui"},
        {...common, subtopic_id: SUBTOPIC_B, subtopic_title_fr: "Relatif « dont »", subtopic_title_fa: "ضمیر موصولی dont", mastery_before_pct: null, mastery_delta_pct: null, new_evidence: true},
      ],
      question_type_analysis: [{question_type: "PRONOUN_CHOICE", total: 4, correct: 3, incorrect: 1, accuracy_pct: 75}],
      strengths: [{...common, subtopic_id: SUBTOPIC_A, subtopic_title_fr: "Relatif « qui »", subtopic_title_fa: "ضمیر موصولی qui"}],
      weaknesses: [{...common, subtopic_id: SUBTOPIC_B, subtopic_title_fr: "Relatif « dont »", subtopic_title_fa: "ضمیر موصولی dont", mastery_before_pct: null, mastery_delta_pct: null, new_evidence: true}],
      misconceptions: [{
        id: "77777777-7777-4777-8777-777777777777",
        family: "RELATIVE_PRONOUN",
        name_fa: "que / dont",
        statement_fa: "انتخاب ضمیر موصولی نامناسب",
        subtopic_id: SUBTOPIC_B,
        subtopic_title_fr: "Relatif « dont »",
        subtopic_title_fa: "ضمیر موصولی dont",
        repeat_count: 1,
        last_wrong_at: "2026-08-24T18:10:00Z",
      }],
      unmapped_wrong_count: 0,
      mastery_impact: {
        affected_subtopic_count: 2,
        new_evidence_subtopic_count: 1,
        improved_subtopic_count: 1,
        declined_subtopic_count: 0,
        unchanged_subtopic_count: 0,
        average_delta_pct: 3,
      },
      review_item_ids: [REVIEW_ID],
      breakdown: [{
        test_question_id: "88888888-8888-4888-8888-888888888888",
        position: 1,
        answer_id: "99999999-9999-4999-8999-999999999999",
        feedback: {is_correct: false, selected_option_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", correct_option_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", full_explanation: "On emploie dont avec de."},
        lesson_id: LESSON_ID,
        lesson_no: 32,
        lesson_title_fr: "LES RELATIFS",
        subtopic_id: SUBTOPIC_B,
        subtopic_title_fr: "Relatif « dont »",
        subtopic_title_fa: "ضمیر موصولی dont",
        question_type: "PRONOUN_CHOICE",
        difficulty: "MEDIUM" as const,
        response_ms: 18000,
        answered_at: "2026-08-24T18:10:00Z",
        stem: "Choisissez le pronom relatif correct.",
        stem_locale: "fr-FR" as const,
        selected_misconception_id: "77777777-7777-4777-8777-777777777777",
      }],
      insights_version: "attempt-result-insights-v1.0.0",
    },
    meta: {request_id: "result-test-request", api_version: "v1" as const},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders educational result insights from the enriched attempt contract", async () => {
  vi.mocked(apiRequest).mockResolvedValue(envelope());
  render(<AttemptResultClient attemptId={ATTEMPT_ID} locale="fa" />);

  expect(await screen.findByRole("heading", {name: "LES RELATIFS"})).toBeInTheDocument();
  expect(screen.getAllByText("75%").length).toBeGreaterThan(0);
  expect(screen.getByText("Difficulty Analysis")).toBeInTheDocument();
  expect(screen.getByText("Mastery Impact")).toBeInTheDocument();
  expect(screen.getByText("que / dont")).toBeInTheDocument();
  expect(screen.getAllByText("اولین شواهد").length).toBeGreaterThan(0);
  expect(screen.getByRole("link", {name: /مرور اشتباهات/})).toHaveAttribute("href", `/fa/review/${REVIEW_ID}`);
  expect(screen.getByRole("link", {name: /تمرین ضعف‌ها/})).toHaveAttribute("href", expect.stringContaining(`lessons=${LESSON_ID}`));
});

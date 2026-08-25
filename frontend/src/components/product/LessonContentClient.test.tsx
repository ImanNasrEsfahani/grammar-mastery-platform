import {render, screen} from "@testing-library/react";
import {afterEach, expect, test, vi} from "vitest";
import {apiRequest} from "@/lib/api/client";
import {LessonContentClient} from "./LessonContentClient";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const LESSON_ID = "22222222-2222-4222-8222-222222222222";
const SUBTOPIC_ID = "33333333-3333-4333-8333-333333333333";
const REVIEW_ID = "55555555-5555-4555-8555-555555555555";

function lessonEnvelope() {
  return {
    data: {
      id: LESSON_ID,
      lesson_no: 32,
      title_fr: "LES RELATIFS",
      short_title: "Relatifs",
      category_id: "66666666-6666-4666-8666-666666666666",
      subcategory_id: "77777777-7777-4777-8777-777777777777",
      category_title_fr: "Pronoms et référence",
      category_title_fa: "ضمیرها و ارجاع",
      subcategory_title_fr: "Pronoms relatifs",
      subcategory_title_fa: "ضمیرهای موصولی",
      tcf_weight: 1,
      active: true,
      question_count: 42,
      subtopics: [
        {
          id: SUBTOPIC_ID,
          code: "L32-ST01",
          title_fr: "Relatif « qui »",
          title_fa: "ضمیر موصولی qui",
          short_definition_fa: "qui جای فاعل را می‌گیرد.",
          active: true,
        },
      ],
      book_reference: {book_pages: "140-147", pdf_pages: "152-159"},
      learning: {
        overview: {
          mastery_score_pct: 63,
          confidence: 0.52,
          coverage_ratio: 0.71,
          evidence_count: 18,
          mastery_band: "DEVELOPING",
          model_version: "mastery-evidence-v0.9.0",
          source: "AGGREGATED_SUBTOPICS",
        },
        subtopics: [
          {
            id: SUBTOPIC_ID,
            question_count: 42,
            mistake_count: 3,
            mastery: {
              mastery_score_pct: 78,
              confidence: 0.72,
              coverage_ratio: 1,
              evidence_count: 8,
              mastery_band: "DEVELOPING",
              model_version: "mastery-evidence-v0.9.0",
              source: "PERSISTED_SUBTOPIC",
            },
          },
        ],
        unresolved_mistake_count: 12,
        review_item_id: REVIEW_ID,
        misconceptions: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            family: "RELATIVE_PRONOUN",
            name_fa: "que / dont",
            statement_fa: "انتخاب ضمیر موصولی نادرست",
            diagnostic_interpretation_fa: null,
            subtopic_id: SUBTOPIC_ID,
            subtopic_title_fr: "Relatif « qui »",
            subtopic_title_fa: "ضمیر موصولی qui",
            repeat_count: 5,
            last_wrong_at: "2026-08-24T18:00:00Z",
          },
        ],
        recent_activity: [
          {
            attempt_id: "99999999-9999-4999-8999-999999999999",
            test_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            mode: "adaptive",
            question_count: 18,
            answered_count: 18,
            correct_count: 14,
            accuracy_pct: 77.8,
            duration_seconds: 660,
            completed_at: "2026-08-24T18:00:00Z",
          },
        ],
      },
    },
    meta: {request_id: "test-request", api_version: "v1"},
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("renders the designed lesson dashboard from real lesson insight fields", async () => {
  vi.mocked(apiRequest).mockResolvedValue(lessonEnvelope());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({status: 200, ok: true}));

  render(
    <LessonContentClient
      locale="fa"
      lessonId={LESSON_ID}
      bookSlug="grammaire-progressive-francais-intermediaire-3e"
    />,
  );

  expect(await screen.findByRole("heading", {name: "LES RELATIFS"})).toBeInTheDocument();
  expect(screen.getByText("63%")).toBeInTheDocument();
  expect(screen.getByText("52%")).toBeInTheDocument();
  expect(screen.getByText("71%")).toBeInTheDocument();
  expect(screen.getByText("Relatif « qui »")).toBeInTheDocument();
  expect(screen.getByText("que / dont")).toBeInTheDocument();
  expect(screen.getByRole("link", {name: "شروع تمرین درس"})).toHaveAttribute(
    "href",
    `/fa/tests/new?lesson=${LESSON_ID}`,
  );
  expect(screen.getByRole("link", {name: /مرور اشتباهات/})).toHaveAttribute(
    "href",
    `/fa/review/${REVIEW_ID}`,
  );
});

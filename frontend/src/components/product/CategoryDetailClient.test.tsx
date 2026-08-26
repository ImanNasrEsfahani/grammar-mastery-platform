import {render, screen} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {CategoryDetailClient} from "./CategoryDetailClient";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const CATEGORY_ID = "7516a18a-919c-5431-8ef2-1bfe2a33500a";
const SUB_A = "fd24e474-a076-5170-8f15-c238444265da";
const SUB_B = "0a5bb842-ecf6-5cb4-85d7-07c9ac173f2f";

const lessons = {
  data: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      lesson_no: 20,
      title_fr: "LES PRONOMS COMPLÉMENTS",
      short_title: "pronoms_complements",
      category_id: CATEGORY_ID,
      subcategory_id: SUB_A,
      category_title_fr: "Pronoms et référence",
      category_title_fa: "ضمیرها و ارجاع",
      subcategory_title_fr: "Pronoms adverbiaux et compléments",
      subcategory_title_fa: "ضمیرهای قیدی و متممی",
      active: true,
      question_count: 140,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      lesson_no: 32,
      title_fr: "LES PRONOMS RELATIFS",
      short_title: "pronoms_relatifs",
      category_id: CATEGORY_ID,
      subcategory_id: SUB_B,
      category_title_fr: "Pronoms et référence",
      category_title_fa: "ضمیرها و ارجاع",
      subcategory_title_fr: "Pronoms relatifs",
      subcategory_title_fa: "ضمیرهای موصولی",
      active: true,
      question_count: 160,
    },
  ],
  page: {page_size: 100, has_more: false, next_cursor: null},
  meta: {request_id: "category-lessons", api_version: "v1"},
};

const categoryMastery = {
  data: [{
    scope_type: "CATEGORY",
    scope_id: CATEGORY_ID,
    scope_title: "Pronoms et référence",
    mastery_score_pct: 58,
    confidence: .63,
    coverage_ratio: .71,
    evidence_count: 184,
    mastery_band: "DEVELOPING",
    model_version: "mastery-v1",
  }],
  meta: {request_id: "category-mastery", api_version: "v1"},
};

const lessonMastery = {
  data: [
    {scope_type: "LESSON", scope_id: lessons.data[0].id, mastery_score_pct: 72, confidence: .82, coverage_ratio: .74, evidence_count: 80, mastery_band: "DEVELOPING", model_version: "mastery-v1"},
    {scope_type: "LESSON", scope_id: lessons.data[1].id, mastery_score_pct: 55, confidence: .75, coverage_ratio: .68, evidence_count: 64, mastery_band: "DEVELOPING", model_version: "mastery-v1"},
  ],
  meta: {request_id: "lesson-mastery", api_version: "v1"},
};

const subtopicMastery = {
  data: [
    {scope_type: "SUBTOPIC", scope_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mastery_score_pct: 78, confidence: .85, coverage_ratio: .8, evidence_count: 20, mastery_band: "STRONG", model_version: "mastery-v1"},
    {scope_type: "SUBTOPIC", scope_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", mastery_score_pct: 42, confidence: .72, coverage_ratio: .62, evidence_count: 16, mastery_band: "WEAK", model_version: "mastery-v1"},
  ],
  meta: {request_id: "subtopic-mastery", api_version: "v1"},
};

const progress = {
  data: {
    points: [
      {scope_type: "CATEGORY", scope_id: CATEGORY_ID, mastery_score_pct: 47, confidence: .55, coverage_ratio: .48, evidence_count: 80, mastery_band: "WEAK", model_version: "mastery-v1", captured_at: "2026-07-01T12:00:00Z"},
      {scope_type: "CATEGORY", scope_id: CATEGORY_ID, mastery_score_pct: 53, confidence: .59, coverage_ratio: .61, evidence_count: 130, mastery_band: "DEVELOPING", model_version: "mastery-v1", captured_at: "2026-07-15T12:00:00Z"},
      {scope_type: "CATEGORY", scope_id: CATEGORY_ID, mastery_score_pct: 58, confidence: .63, coverage_ratio: .71, evidence_count: 184, mastery_band: "DEVELOPING", model_version: "mastery-v1", captured_at: "2026-08-01T12:00:00Z"},
    ],
    incomplete_data: false,
    warning: null,
  },
  meta: {request_id: "progress", api_version: "v1"},
};

const details = [
  {
    data: {...lessons.data[0], subtopics: [{id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "L20-S01", title_fr: "Pronoms compléments directs", title_fa: "ضمیرهای مفعولی مستقیم", short_definition_fa: null, active: true}]},
    meta: {request_id: "detail-1", api_version: "v1"},
  },
  {
    data: {...lessons.data[1], subtopics: [{id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "L32-S04", title_fr: "Relatif dont", title_fa: "موصولی dont", short_definition_fa: null, active: true}]},
    meta: {request_id: "detail-2", api_version: "v1"},
  },
];

test("renders category detail from real taxonomy/mastery/progress contracts", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(lessons)
    .mockResolvedValueOnce(categoryMastery)
    .mockResolvedValueOnce(lessonMastery)
    .mockResolvedValueOnce(subtopicMastery)
    .mockResolvedValueOnce(progress)
    .mockResolvedValueOnce(details[0])
    .mockResolvedValueOnce(details[1]);

  render(<CategoryDetailClient locale="fa" categoryId={CATEGORY_ID} />);

  expect((await screen.findAllByText("Pronoms et référence")).length).toBeGreaterThan(0);
  expect(screen.getByText("ضمیرها و ارجاع")).toBeInTheDocument();
  expect(screen.getAllByText("Pronoms relatifs").length).toBeGreaterThan(0);
  expect(screen.getByText("Relatif dont")).toBeInTheDocument();
  expect(screen.getByText("۴۲%")).toBeInTheDocument();

  const categoryPractice = screen.getAllByRole("link", {name: "تمرین این دسته"})[0];
  expect(categoryPractice?.getAttribute("href") ?? "").toContain("/fa/tests/new?mode=adaptive&scope=lessons");
});

test("keeps taxonomy visible when analytics are unavailable", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(lessons)
    .mockRejectedValueOnce(new Error("mastery down"))
    .mockRejectedValueOnce(new Error("lesson mastery down"))
    .mockRejectedValueOnce(new Error("subtopic mastery down"))
    .mockRejectedValueOnce(new Error("progress down"))
    .mockRejectedValueOnce(new Error("detail down"))
    .mockRejectedValueOnce(new Error("detail down"));

  render(<CategoryDetailClient locale="en" categoryId={CATEGORY_ID} />);

  expect((await screen.findAllByText("Pronoms et référence")).length).toBeGreaterThan(0);
  expect(screen.getByText("Some analytics are temporarily unavailable")).toBeInTheDocument();
  expect(screen.getAllByText("Pronoms relatifs").length).toBeGreaterThan(0);
});

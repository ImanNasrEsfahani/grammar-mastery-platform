import {render, screen} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {SubcategoryDetailClient} from "./SubcategoryDetailClient";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const SUBCATEGORY_ID = "0a5bb842-ecf6-5cb4-85d7-07c9ac173f2f";
const CATEGORY_ID = "7516a18a-919c-5431-8ef2-1bfe2a33500a";
const LESSON_ID = "4ec05ffb-8465-4c5c-9a50-d67136ad0472";
const SUBTOPIC_ID = "11111111-1111-4111-8111-111111111111";

const lessonResponse = {
  data: [{
    id: LESSON_ID,
    lesson_no: 32,
    title_fr: "LES RELATIFS",
    short_title: "relatifs",
    category_id: CATEGORY_ID,
    subcategory_id: SUBCATEGORY_ID,
    category_title_fr: "Pronoms et référence",
    category_title_fa: "ضمیرها و ارجاع",
    subcategory_title_fr: "Pronoms relatifs",
    subcategory_title_fa: "ضمیرهای موصولی",
    tcf_weight: 2.4,
    active: true,
    question_count: 150,
  }],
  page: {page_size: 100, has_more: false, next_cursor: null},
  meta: {request_id: "lessons", api_version: "v1"},
};

const lessonMastery = {
  data: [{scope_type: "LESSON", scope_id: LESSON_ID, scope_title: "LES RELATIFS", mastery_score_pct: 55, confidence: .63, coverage_ratio: .74, evidence_count: 96, mastery_band: "DEVELOPING", model_version: "m1"}],
  meta: {request_id: "lm", api_version: "v1"},
};

const subtopicMastery = {
  data: [{scope_type: "SUBTOPIC", scope_id: SUBTOPIC_ID, scope_title: "dont", mastery_score_pct: 42, confidence: .72, coverage_ratio: .65, evidence_count: 20, mastery_band: "WEAK", model_version: "m1"}],
  meta: {request_id: "sm", api_version: "v1"},
};

const detail = {
  data: {
    ...lessonResponse.data[0],
    subtopics: [{id: SUBTOPIC_ID, code: "L32_ST04", title_fr: "dont", title_fa: "ضمیر موصولی dont", short_definition_fa: "رابطه با de", active: true}],
  },
  meta: {request_id: "detail", api_version: "v1"},
};

const masteryMap = {
  data: {categories: [{
    id: CATEGORY_ID,
    code: "CAT04",
    slug: "pronouns",
    title_fr: "Pronoms et référence",
    title_fa: "ضمیرها و ارجاع",
    display_title: "ضمیرها و ارجاع",
    subcategories: [{
      id: SUBCATEGORY_ID,
      code: "SUB10",
      slug: "relative_pronouns",
      category_id: CATEGORY_ID,
      title_fr: "Pronoms relatifs",
      title_fa: "ضمیرهای موصولی",
      display_order: 3,
      display_title: "ضمیرهای موصولی",
      mastery: {mastery_score_pct: 55, confidence: .63, coverage_ratio: .74, evidence_count: 96, mastery_band: "DEVELOPING"},
      lessons: [{
        id: LESSON_ID,
        lesson_no: 32,
        title_fr: "LES RELATIFS",
        subcategory_id: SUBCATEGORY_ID,
        mastery: {mastery_score_pct: 55, confidence: .63, coverage_ratio: .74, evidence_count: 96, mastery_band: "DEVELOPING"},
        top_misconception: {id: "m1", family: "DONT_DE", name_fa: "dont و de", statement_fa: "کاربر در رابطه‌های دارای de از dont استفاده نمی‌کند.", subtopic_id: SUBTOPIC_ID, subtopic_title_fr: "dont", subtopic_title_fa: "dont", repeat_count: 7, last_wrong_at: "2026-08-20T10:00:00Z"},
        unresolved_review_count: 7,
      }],
    }],
  }]},
  meta: {request_id: "map", api_version: "v1", runtime_version: "runtime"},
};

const progress = {
  data: {points: [
    {scope_type: "LESSON", scope_id: LESSON_ID, mastery_score_pct: 48, confidence: .5, coverage_ratio: .5, evidence_count: 60, mastery_band: "WEAK", model_version: "m1", captured_at: "2026-08-01T00:00:00Z"},
    {scope_type: "LESSON", scope_id: LESSON_ID, mastery_score_pct: 55, confidence: .63, coverage_ratio: .74, evidence_count: 96, mastery_band: "DEVELOPING", model_version: "m1", captured_at: "2026-08-22T00:00:00Z"},
  ], incomplete_data: false, warning: null},
  meta: {request_id: "progress", api_version: "v1"},
};

test("renders the real subcategory hierarchy, mastery, concept and lesson", async () => {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path.startsWith("/api/backend/lessons?page")) return lessonResponse as never;
    if (path === "/api/backend/mastery?filter[scope_type]=LESSON") return lessonMastery as never;
    if (path === "/api/backend/mastery?filter[scope_type]=SUBTOPIC") return subtopicMastery as never;
    if (path.startsWith(`/api/backend/lessons/${LESSON_ID}`)) return detail as never;
    if (path.startsWith("/api/backend/mastery-map")) return masteryMap as never;
    if (path.startsWith("/api/backend/progress")) return progress as never;
    throw new Error(`Unexpected request: ${path}`);
  });

  render(<SubcategoryDetailClient locale="fa" subcategoryId={SUBCATEGORY_ID} />);

  expect(await screen.findByRole("heading", {name: "Pronoms relatifs"})).toBeInTheDocument();
  expect(screen.getByText("dont")).toBeInTheDocument();
  expect(screen.getByText("۴۲%")).toBeInTheDocument();
  expect(screen.getByText("LES RELATIFS")).toBeInTheDocument();
  expect(screen.getByText(/۷ خطای تکرارشونده/)).toBeInTheDocument();
  expect(screen.getByRole("link", {name: "تمرین زیرگروه"})).toHaveAttribute("href", expect.stringContaining(`group=${SUBCATEGORY_ID}`));
});

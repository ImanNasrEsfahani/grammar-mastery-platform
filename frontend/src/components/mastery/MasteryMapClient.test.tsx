import {beforeEach, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {MasteryMapClient} from "./MasteryMapClient";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const mastery = (score: number, band: string, confidence = .63, evidence = 8, coverage = .72, source = "PERSISTED_LESSON") => ({
  mastery_score_pct: score,
  confidence,
  coverage_ratio: coverage,
  evidence_count: evidence,
  mastery_band: band,
  model_version: "mastery-evidence-v0.9.0",
  source,
  canonical_scope: !source.includes("DERIVED"),
  derived_for_ui: source.includes("DERIVED"),
});

const response = {
  data: {
    summary: {
      overall_mastery_pct: 68,
      coverage_pct: 61,
      category_count: 11,
      subcategory_count: 27,
      lesson_count: 52,
      subtopic_count: 304,
      band_counts: {NO_EVIDENCE: 1, UNCERTAIN: 1, WEAK: 1, DEVELOPING: 5, STRONG: 3},
      mastery: mastery(68, "DEVELOPING", .71, 120, .61, "DERIVED_OVERALL_FOR_UI"),
    },
    semantics: {
      canonical_scopes: ["SUBTOPIC", "LESSON", "CATEGORY"],
      display_only_scopes: ["SUBCATEGORY", "OVERALL"],
      bands: ["NO_EVIDENCE", "UNCERTAIN", "WEAK", "DEVELOPING", "STRONG"],
      confidence_gate: .45,
      weak_below: 55,
      strong_at_or_above: 80,
      mastery_model_version: "mastery-evidence-v0.9.0",
    },
    categories: [
      {
        id: "c1111111-1111-4111-8111-111111111111",
        code: "CAT04",
        slug: "pronouns",
        title_fr: "Pronoms et référence",
        title_fa: "ضمیرها و ارجاع",
        display_order: 4,
        display_title: "ضمیرها و ارجاع",
        tcf_weight: 12.4,
        mastery: mastery(64, "DEVELOPING", .7, 34, .69, "PERSISTED_CATEGORY"),
        subcategories: [
          {
            id: "s1111111-1111-4111-8111-111111111111",
            code: "SUB11",
            slug: "relative_pronouns",
            category_id: "c1111111-1111-4111-8111-111111111111",
            title_fr: "Pronoms relatifs",
            title_fa: "ضمیرهای موصولی",
            display_order: 3,
            display_title: "ضمیرهای موصولی",
            mastery: mastery(55, "DEVELOPING", .63, 12, .66, "DERIVED_SUBCATEGORY_FOR_UI"),
            lessons: [
              {
                id: "l1111111-1111-4111-8111-111111111111",
                lesson_no: 32,
                title_fr: "LES RELATIFS",
                short_title: "relatifs",
                category_id: "c1111111-1111-4111-8111-111111111111",
                subcategory_id: "s1111111-1111-4111-8111-111111111111",
                tcf_weight: 4.2,
                display_title: "LES RELATIFS",
                mastery: mastery(55, "DEVELOPING"),
                subtopics: [
                  {id: "t1", lesson_id: "l1111111-1111-4111-8111-111111111111", code: "L32-S01", title_fr: "Qui", title_fa: "qui", short_definition_fa: null, display_title: "qui", mastery: mastery(72, "DEVELOPING", .7, 5, 1, "PERSISTED_SUBTOPIC")},
                  {id: "t2", lesson_id: "l1111111-1111-4111-8111-111111111111", code: "L32-S02", title_fr: "Dont", title_fa: "dont", short_definition_fa: null, display_title: "dont", mastery: mastery(42, "WEAK", .61, 4, 1, "PERSISTED_SUBTOPIC")},
                ],
                top_misconception: {
                  id: "m1",
                  family: "FORM_CONFUSION",
                  name_fa: "اشتباه در انتخاب ضمیر موصولی",
                  statement_fa: "کاربر «dont» و «que» را در نقش مکمل با هم اشتباه می‌گیرد.",
                  diagnostic_interpretation_fa: "Relative pronoun role confusion",
                  subtopic_id: "t2",
                  subtopic_title_fr: "Dont",
                  subtopic_title_fa: "dont",
                  repeat_count: 3,
                  last_wrong_at: "2026-08-24T10:00:00Z",
                },
                unresolved_review_count: 3,
              },
            ],
          },
        ],
      },
    ],
  },
  meta: {request_id: "map-request", api_version: "v1", runtime_version: "mastery-map-runtime-v1.0.0"},
};

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(apiRequest).mockReset();
});

test("renders the canonical taxonomy hierarchy and lesson inspector from real mastery data", async () => {
  vi.mocked(apiRequest).mockResolvedValue(response);
  render(<MasteryMapClient locale="fa" />);

  expect((await screen.findAllByText("LES RELATIFS")).length).toBeGreaterThan(0);
  expect(screen.getByText("اشتباه در انتخاب ضمیر موصولی")).toBeInTheDocument();
  expect(screen.getByText("۱۱")).toBeInTheDocument();
  expect(screen.getByText("۲۷")).toBeInTheDocument();
  expect(screen.getByRole("link", {name: "جزئیات درس"})).toHaveAttribute(
    "href",
    "/fa/lessons/l1111111-1111-4111-8111-111111111111",
  );
  expect(screen.getByRole("link", {name: "تمرین این بخش"})).toHaveAttribute("href", "/fa/tests/new");
  expect(screen.getByRole("link", {name: "مرور خطاهای مرتبط"})).toHaveAttribute("href", "/fa/review");
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith("/api/backend/mastery-map?locale=fa");
});

test("search and status filters work client-side without inventing mastery rows", async () => {
  vi.mocked(apiRequest).mockResolvedValue(response);
  render(<MasteryMapClient locale="fa" />);
  await screen.findAllByText("LES RELATIFS");

  fireEvent.change(screen.getByLabelText("جست‌وجوی نقشه"), {target: {value: "not-present"}});
  expect(screen.getByText("نتیجه‌ای با این فیلترها پیدا نشد")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", {name: "پاک‌کردن فیلترها"}));
  fireEvent.change(screen.getAllByRole("combobox")[0], {target: {value: "WEAK"}});

  await waitFor(() => {
    expect(screen.queryByText("نتیجه‌ای با این فیلترها پیدا نشد")).toBeInTheDocument();
  });
  expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(1);
});

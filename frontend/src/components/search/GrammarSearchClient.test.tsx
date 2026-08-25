import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {GrammarSearchClient} from "./GrammarSearchClient";
import {apiRequest} from "@/lib/api/client";

const replace = vi.fn();
vi.mock("next/navigation", () => ({useRouter: () => ({replace})}));
vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const response = {
  data: {
    query: "dont",
    kind: "ALL",
    locale: "fa",
    total_count: 2,
    counts: {LESSON: 0, SUBTOPIC: 1, RULE: 1, CATEGORY: 0},
    results: [
      {
        key: "SUBTOPIC:11111111-1111-4111-8111-111111111111",
        kind: "SUBTOPIC",
        id: "11111111-1111-4111-8111-111111111111",
        title_fr: "Relatif dont",
        title_fa: "ضمیر نسبی dont",
        code: "L32-S04",
        lesson_id: "22222222-2222-4222-8222-222222222222",
        lesson_no: 32,
        lesson_title_fr: "LES RELATIFS",
        subtopic_id: "11111111-1111-4111-8111-111111111111",
        subtopic_code: "L32-S04",
        category_id: "33333333-3333-4333-8333-333333333333",
        category_title_fr: "Pronoms",
        category_title_fa: "ضمیرها",
        subcategory_id: "44444444-4444-4444-8444-444444444444",
        subcategory_title_fr: "Pronoms relatifs",
        subcategory_title_fa: "ضمیرهای نسبی",
        snippet_fa: "dont زمانی به‌کار می‌رود که رابطه با de ساخته شود.",
        snippet_fr: null,
        practice_lesson_ids: ["22222222-2222-4222-8222-222222222222"],
        mastery: {score_pct: 42, confidence: 0.61, evidence_count: 9, band: "WEAK"},
        common_misconception: {
          id: "55555555-5555-4555-8555-555555555555",
          name_fa: "que ↔ dont",
          statement_fa: "جایگزینی que با dont",
          repeat_count: 3,
        },
      },
      {
        key: "RULE:11111111-1111-4111-8111-111111111111",
        kind: "RULE",
        id: "11111111-1111-4111-8111-111111111111",
        title_fr: "Relatif dont",
        title_fa: "ضمیر نسبی dont",
        code: "RULE:L32-S04",
        lesson_id: "22222222-2222-4222-8222-222222222222",
        lesson_no: 32,
        lesson_title_fr: "LES RELATIFS",
        subtopic_id: "11111111-1111-4111-8111-111111111111",
        subtopic_code: "L32-S04",
        category_id: "33333333-3333-4333-8333-333333333333",
        category_title_fr: "Pronoms",
        category_title_fa: "ضمیرها",
        subcategory_id: "44444444-4444-4444-8444-444444444444",
        subcategory_title_fr: "Pronoms relatifs",
        subcategory_title_fa: "ضمیرهای نسبی",
        snippet_fa: "dont = de + antecedent",
        snippet_fr: null,
        practice_lesson_ids: ["22222222-2222-4222-8222-222222222222"],
        mastery: {score_pct: 42, confidence: 0.61, evidence_count: 9, band: "WEAK"},
        common_misconception: null,
        projection: "CANONICAL_SUBTOPIC_RULE_TEXT",
      },
    ],
    as_of: "2026-08-25T17:00:00Z",
    runtime_version: "grammar-search-runtime-v1.0.0",
  },
  meta: {request_id: "search-request", api_version: "v1"},
};

test("renders canonical search results, learner mastery and real navigation CTAs", async () => {
  vi.mocked(apiRequest).mockResolvedValue(response);
  render(<GrammarSearchClient locale="fa" initialQuery="dont" />);

  expect((await screen.findAllByText(/Relatif/)).length).toBeGreaterThan(0);
  expect(screen.getAllByText("۴۲%").length).toBeGreaterThan(0);
  expect(screen.getByText("que ↔ dont")).toBeInTheDocument();

  const lessonLinks = screen.getAllByRole("link", {name: "باز کردن درس"});
  expect(lessonLinks[0]).toHaveAttribute("href", "/fa/lessons/22222222-2222-4222-8222-222222222222");
  const practiceLinks = screen.getAllByRole("link", {name: "تمرین"});
  expect(practiceLinks[0].getAttribute("href")).toContain("/fa/tests/new?");
  expect(practiceLinks[0].getAttribute("href")).toContain("lesson=22222222-2222-4222-8222-222222222222");
});

test("kind filter calls the additive search endpoint instead of filtering fabricated client data", async () => {
  vi.mocked(apiRequest).mockResolvedValue(response);
  render(<GrammarSearchClient locale="fa" initialQuery="dont" />);
  await screen.findAllByText(/Relatif/);

  fireEvent.click(screen.getByRole("button", {name: /قاعده/}));

  await waitFor(() => {
    expect(vi.mocked(apiRequest).mock.calls.some(([url]) => String(url).includes("kind=RULE"))).toBe(true);
  });
});

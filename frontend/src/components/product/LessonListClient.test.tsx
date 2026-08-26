import {fireEvent, render, screen} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {LessonListClient} from "./LessonListClient";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const lessons = {
  data: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      lesson_no: 1,
      title_fr: "LE VERBE « ÊTRE »",
      short_title: "etre",
      category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subcategory_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      category_title_fr: "Verbes et conjugaison",
      category_title_fa: "افعال و صرف",
      subcategory_title_fr: "Verbes fondamentaux",
      subcategory_title_fa: "افعال بنیادی",
      tcf_weight: 1.6,
      active: true,
      question_count: 180,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      lesson_no: 2,
      title_fr: "L’ADJECTIF (1)",
      short_title: "adjectif_1",
      category_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      subcategory_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      category_title_fr: "Adjectifs, adverbes, accord et comparaison",
      category_title_fa: "صفت، قید، تطابق و مقایسه",
      subcategory_title_fr: "Adjectifs: accord, place et sens",
      subcategory_title_fa: "صفت: تطابق، جایگاه و معنا",
      active: true,
      question_count: 220,
    },
  ],
  page: {page_size: 100, has_more: false, next_cursor: null},
  meta: {request_id: "lessons-request", api_version: "v1"},
};

const mastery = {
  data: [
    {
      scope_type: "LESSON",
      scope_id: "11111111-1111-4111-8111-111111111111",
      scope_title: "LE VERBE « ÊTRE »",
      mastery_score_pct: 88,
      confidence: .9,
      coverage_ratio: .84,
      evidence_count: 34,
      mastery_band: "STRONG",
      model_version: "mastery-v1",
    },
    {
      scope_type: "LESSON",
      scope_id: "22222222-2222-4222-8222-222222222222",
      scope_title: "L’ADJECTIF (1)",
      mastery_score_pct: 54,
      confidence: .7,
      coverage_ratio: .58,
      evidence_count: 18,
      mastery_band: "DEVELOPING",
      model_version: "mastery-v1",
    },
  ],
  meta: {request_id: "mastery-request", api_version: "v1"},
};

test("renders real lesson taxonomy, question count and lesson-level mastery", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(lessons)
    .mockResolvedValueOnce(mastery);

  render(<LessonListClient locale="fa" />);

  expect(await screen.findByText("LE VERBE « ÊTRE »")).toBeInTheDocument();
  expect(screen.getAllByText("افعال و صرف").length).toBeGreaterThan(0);
  expect(screen.getByText("۸۸%")).toBeInTheDocument();
  expect(screen.getByText("۳۴")).toBeInTheDocument();
  expect(screen.getByText("۴۰۰")).toBeInTheDocument();
});

test("search filters the lesson cards without fabricating data", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(lessons)
    .mockResolvedValueOnce(mastery);

  render(<LessonListClient locale="fa" />);
  await screen.findByText("LE VERBE « ÊTRE »");
  fireEvent.change(screen.getByRole("searchbox"), {target: {value: "adjectif"}});

  expect(screen.getByText("L’ADJECTIF (1)")).toBeInTheDocument();
  expect(screen.queryByText("LE VERBE « ÊTRE »")).not.toBeInTheDocument();
});

test("each lesson practice link carries lesson scope and the lesson id", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(lessons)
    .mockResolvedValueOnce(mastery);

  render(<LessonListClient locale="fa" />);
  await screen.findByText("LE VERBE « ÊTRE »");

  const practiceLinks = screen.getAllByRole("link", {name: "ساخت تمرین"});
  expect(practiceLinks[0]).toHaveAttribute(
    "href",
    "/fa/tests/new?scope=lessons&lesson=11111111-1111-4111-8111-111111111111",
  );
  expect(practiceLinks[1]).toHaveAttribute(
    "href",
    "/fa/tests/new?scope=lessons&lesson=22222222-2222-4222-8222-222222222222",
  );
});

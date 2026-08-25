import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, expect, test, vi} from "vitest";
import {ReviewRunnerClient} from "./ReviewRunnerClient";
import {apiRequest} from "@/lib/api/client";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({push}),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const reviewId = "11111111-1111-4111-8111-111111111111";
const optionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const optionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function itemPayload() {
  return {
    data: {
      id: reviewId,
      kind: "SPACED",
      resolution_status: "UNRESOLVED",
      reviewability: "RETRY_ALLOWED",
      marked: false,
      feedback_state: "HIDDEN",
      previous_selected_option_id: optionA,
      schedule: {
        status: "DUE",
        learning_state: "REVIEW",
        due_at: "2026-08-22T17:00:00Z",
        interval_days: 30,
        consecutive_correct_reviews: 2,
        graduated: false,
        scheduler_version: "spaced-review-v0.9.0",
      },
      question: {
        question_revision_id: "22222222-2222-4222-8222-222222222222",
        stem: "Le livre ______ j’ai acheté est très intéressant.",
        stem_locale: "fr-FR",
        question_type: "PRONOUN_CHOICE",
        difficulty: "MEDIUM",
        options: [
          {id: optionA, position: "A", text: "que"},
          {id: optionB, position: "B", text: "dont"},
          {id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", position: "C", text: "où"},
          {id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", position: "D", text: "qui"},
        ],
        media: [],
      },
    },
    meta: {request_id: "r1", api_version: "v1"},
  };
}

function queuePayload() {
  return {
    data: [
      {
        id: reviewId,
        kind: "SPACED",
        status: "DUE",
        title: "Les pronoms relatifs (que/dont)",
        group_key: "que ↔ dont",
        repeat_count: 3,
        due_at: "2026-08-22T17:00:00Z",
        marked: false,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        kind: "MISTAKE",
        status: "DUE",
        title: "Le passé composé",
        group_key: "auxiliary_choice",
        repeat_count: 2,
        due_at: "2026-08-23T17:00:00Z",
        marked: false,
      },
    ],
    page: {page_size: 25, has_more: false, next_cursor: null},
    meta: {request_id: "rq", api_version: "v1"},
  };
}

function gradePayload(isCorrect = true) {
  return {
    data: {
      review_item: {
        ...itemPayload().data,
        resolution_status: isCorrect ? "CORRECTED" : "UNRESOLVED",
        feedback_state: "REVEALED",
        schedule: {
          status: isCorrect ? "COMPLETED" : "SCHEDULED",
          learning_state: isCorrect ? null : "LAPSED",
          due_at: isCorrect ? "2026-10-21T17:00:00Z" : "2026-08-26T17:00:00Z",
          interval_days: isCorrect ? 60 : 1,
          consecutive_correct_reviews: isCorrect ? 3 : 0,
          graduated: isCorrect,
          scheduler_version: "review-practice-policy-v1.0.0",
        },
      },
      feedback: {
        is_correct: isCorrect,
        selected_option_id: optionB,
        correct_option_id: optionB,
        selected_option_explanation: "que cannot replace de + noun here.",
        correct_option_explanation: "dont replaces de + noun.",
        full_explanation: "Use dont when the relative relation contains de.",
      },
      schedule: {
        status: isCorrect ? "COMPLETED" : "SCHEDULED",
        learning_state: isCorrect ? null : "LAPSED",
        due_at: isCorrect ? "2026-10-21T17:00:00Z" : "2026-08-26T17:00:00Z",
        interval_days: isCorrect ? 60 : 1,
        consecutive_correct_reviews: isCorrect ? 3 : 0,
        graduated: isCorrect,
        scheduler_version: "review-practice-policy-v1.0.0",
      },
    },
    meta: {request_id: "r2", api_version: "v1"},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

test("renders the complete review workspace with progress and priority", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(itemPayload())
    .mockResolvedValueOnce(queuePayload());

  render(<ReviewRunnerClient locale="fa" reviewId={reviewId} />);

  expect(await screen.findByText("Le livre ______ j’ai acheté est très intéressant.")).toBeInTheDocument();
  expect(await screen.findByText("Les pronoms relatifs (que/dont)")).toBeInTheDocument();
  expect(screen.getByText(/پاسخ قبلی/)).toHaveTextContent("que");
  expect(screen.getByRole("heading", {name: "پیشرفت جلسه"})).toBeInTheDocument();
  expect(screen.getByRole("heading", {name: "اولویت مرور"})).toBeInTheDocument();
  expect(screen.getAllByText("بالا").length).toBeGreaterThan(0);
  expect(screen.getByText(/3 تکرار ثبت شده/)).toBeInTheDocument();
  expect(screen.getByText(/تحلیل پس از پاسخ/)).toBeInTheDocument();
});

test("reveals misconception, related rule and mastery impact only after grading", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(itemPayload())
    .mockResolvedValueOnce(queuePayload())
    .mockResolvedValueOnce(gradePayload(true));

  const user = userEvent.setup();
  render(<ReviewRunnerClient locale="fa" reviewId={reviewId} />);

  await screen.findByText("Le livre ______ j’ai acheté est très intéressant.");
  expect(screen.queryByRole("heading", {name: "اشتباه محتمل شما"})).not.toBeInTheDocument();

  await user.click(screen.getByText("dont"));
  await user.click(screen.getByRole("button", {name: "ثبت پاسخ"}));

  expect(await screen.findByText("درست پاسخ دادید")).toBeInTheDocument();
  expect(screen.getByText(/از صف مرور فعال خارج شد/)).toBeInTheDocument();
  expect(screen.getByRole("heading", {name: "اشتباه محتمل شما"})).toBeInTheDocument();
  expect(screen.getByText("que ↔ dont")).toBeInTheDocument();
  expect(screen.getByRole("heading", {name: "قاعده مرتبط"})).toBeInTheDocument();
  expect(screen.getByText("dont replaces de + noun.")).toBeInTheDocument();
  expect(screen.getByRole("heading", {name: "اثر بر تسلط"})).toBeInTheDocument();
  expect(screen.getByText(/30/)).toBeInTheDocument();
  expect(screen.getByText(/60/)).toBeInTheDocument();
  expect(screen.getByText(/امتیاز آزمون اصلی بازنویسی نمی‌شود/)).toBeInTheDocument();
});

test("supports keyboard selection and repeat-in-session with visible queue confirmation", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(itemPayload())
    .mockResolvedValueOnce(queuePayload())
    .mockResolvedValueOnce(gradePayload(false));

  const user = userEvent.setup();
  render(<ReviewRunnerClient locale="fa" reviewId={reviewId} />);

  await screen.findByText("Le livre ______ j’ai acheté est très intéressant.");
  await user.keyboard("2");
  await user.keyboard("{Enter}");

  expect(await screen.findByText("نیاز به مرور دوباره")).toBeInTheDocument();
  const repeat = screen.getByRole("button", {name: "تکرار در همین جلسه"});
  await user.click(repeat);

  expect(screen.getByRole("button", {name: "لغو تکرار در همین جلسه"})).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/برای انتهای صف اضافه شد/)).toBeInTheDocument();

  await waitFor(() => {
    const stored = window.sessionStorage.getItem("gmp-review-session-v1:fa");
    expect(stored).toContain(reviewId);
    expect(stored).toContain("repeat_requested_ids");
  });
});

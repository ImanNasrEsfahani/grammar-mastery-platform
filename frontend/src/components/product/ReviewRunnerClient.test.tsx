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
const dueYesterday = new Date(Date.now() - 86_400_000).toISOString();

function itemPayload(id = reviewId) {
  return {
    data: {
      id,
      kind: "SPACED",
      resolution_status: "UNRESOLVED",
      reviewability: "RETRY_ALLOWED",
      marked: false,
      feedback_state: "HIDDEN",
      previous_selected_option_id: optionA,
      schedule: {
        status: "DUE",
        learning_state: "REVIEW",
        due_at: dueYesterday,
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

function summary(id: string, index: number) {
  return {
    id,
    kind: "SPACED" as const,
    status: "DUE",
    title: index === 0 ? "Les pronoms relatifs (que/dont)" : `Review concept ${index + 1}`,
    group_key: index === 0 ? "que ↔ dont" : null,
    repeat_count: index % 4,
    due_at: dueYesterday,
    marked: false,
  };
}

function makeId(index: number) {
  const tail = String(index + 1).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

function queuePages(total = 137) {
  const all = Array.from({length: total}, (_, index) => summary(index === 0 ? reviewId : makeId(index), index));
  return [
    {data: all.slice(0, 100), page: {page_size: 100, has_more: true, next_cursor: "cursor-100"}, meta: {request_id: "q1", api_version: "v1"}},
    {data: all.slice(100), page: {page_size: 100, has_more: false, next_cursor: null}, meta: {request_id: "q2", api_version: "v1"}},
  ];
}

function gradePayload() {
  return {
    data: {
      review_item: {
        ...itemPayload().data,
        resolution_status: "CORRECTED",
        feedback_state: "REVEALED",
        schedule: {
          status: "SCHEDULED",
          learning_state: "REVIEW",
          due_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          interval_days: 7,
          consecutive_correct_reviews: 3,
          graduated: false,
          scheduler_version: "review-practice-policy-v1.0.0",
        },
      },
      feedback: {
        is_correct: true,
        selected_option_id: optionB,
        correct_option_id: optionB,
        correct_option_explanation: "dont replaces de + noun.",
      },
      schedule: {
        status: "SCHEDULED",
        learning_state: "REVIEW",
        due_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        interval_days: 7,
        consecutive_correct_reviews: 3,
        graduated: false,
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

test("a row-level review is strictly a 1-of-1 session and never loads the due queue", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(itemPayload());

  render(<ReviewRunnerClient locale="fa" reviewId={reviewId} sessionMode="single" forceFresh />);

  expect(await screen.findByText("Le livre ______ j’ai acheté est très intéressant.")).toBeInTheDocument();
  expect(screen.getByText("سؤال ۱ از ۱")).toBeInTheDocument();

  await waitFor(() => {
    const reviewListCalls = vi.mocked(apiRequest).mock.calls.filter(([url]) => String(url).startsWith("/api/backend/reviews?"));
    expect(reviewListCalls).toHaveLength(0);
  });

  const stored = window.sessionStorage.getItem(`gmp-review-session-v2:fa:single:${reviewId}`);
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? "{}").order).toEqual([reviewId]);
});

test("due mode walks every API page and builds one logical session containing all 137 due reviews", async () => {
  const [firstPage, secondPage] = queuePages(137);
  vi.mocked(apiRequest).mockImplementation(async (url) => {
    const value = String(url);
    if (value === `/api/backend/reviews/${reviewId}`) return itemPayload() as never;
    if (value.includes("page%5Bafter%5D=cursor-100")) return secondPage as never;
    if (value.startsWith("/api/backend/reviews?")) return firstPage as never;
    throw new Error(`Unexpected API call: ${value}`);
  });

  render(<ReviewRunnerClient locale="fa" reviewId={reviewId} sessionMode="due" forceFresh />);

  expect(await screen.findByText("Les pronoms relatifs (que/dont)")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("(۱۳۷)")).toBeInTheDocument());

  const queueCalls = vi.mocked(apiRequest).mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/backend/reviews?"));
  expect(queueCalls).toHaveLength(2);
  expect(queueCalls[0]).toContain("page%5Bsize%5D=100");
  expect(queueCalls[0]).toContain("filter%5Bkind%5D=SPACED");
  expect(queueCalls.join(" ")).not.toContain("page%5Bsize%5D=25");

  const stored = window.sessionStorage.getItem("gmp-review-session-v2:fa:due");
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? "{}").order).toHaveLength(137);
});

test("due navigation keeps the due-session scope and drops the one-shot fresh flag", async () => {
  const [firstPage, secondPage] = queuePages(101);
  vi.mocked(apiRequest).mockImplementation(async (url) => {
    const value = String(url);
    if (value === `/api/backend/reviews/${reviewId}`) return itemPayload() as never;
    if (value.includes("page%5Bafter%5D=cursor-100")) return secondPage as never;
    if (value.startsWith("/api/backend/reviews?")) return firstPage as never;
    throw new Error(`Unexpected API call: ${value}`);
  });

  const user = userEvent.setup();
  render(<ReviewRunnerClient locale="fa" reviewId={reviewId} sessionMode="due" forceFresh />);
  await screen.findByText("Les pronoms relatifs (que/dont)");
  const second = await screen.findByRole("button", {name: /Review concept 2/i});
  await user.click(second);

  expect(push).toHaveBeenCalledWith(expect.stringMatching(/\/fa\/review\/.+\?mode=due$/));
  expect(push).not.toHaveBeenCalledWith(expect.stringContaining("fresh=1"));
});

test("single-session grading updates only the scoped v2 session", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(itemPayload())
    .mockResolvedValueOnce(gradePayload() as never);

  const user = userEvent.setup();
  render(<ReviewRunnerClient locale="fa" reviewId={reviewId} sessionMode="single" forceFresh />);
  await screen.findByText("Le livre ______ j’ai acheté est très intéressant.");
  await user.click(screen.getByText("dont"));
  await user.click(screen.getByRole("button", {name: "ثبت پاسخ"}));

  await waitFor(() => {
    const stored = window.sessionStorage.getItem(`gmp-review-session-v2:fa:single:${reviewId}`);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? "{}");
    expect(parsed.version).toBe(2);
    expect(parsed.mode).toBe("single");
    expect(parsed.order).toEqual([reviewId]);
    expect(parsed.answers).toHaveLength(1);
  });
  expect(window.sessionStorage.getItem("gmp-review-session-v1:fa")).toBeNull();
});

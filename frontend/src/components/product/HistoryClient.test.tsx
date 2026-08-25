import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {HistoryClient} from "./HistoryClient";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

const response = {
  data: {
    items: [
      {
        attempt_id: "11111111-1111-4111-8111-111111111111",
        test_id: "21111111-1111-4111-8111-111111111111",
        activity_type: "PRACTICE",
        mode: "ADAPTIVE",
        title: "Pronoms relatifs",
        status: "COMPLETED",
        started_at: "2026-08-15T18:02:00Z",
        completed_at: "2026-08-15T18:24:18Z",
        duration_seconds: 1338,
        question_count: 20,
        answered_count: 20,
        correct_count: 16,
        score_raw: 16,
        score_pct: 80,
        accuracy_pct: 80,
        lessons: [{id: "31111111-1111-4111-8111-111111111111", lesson_no: 32, title_fr: "LES PRONOMS RELATIFS"}],
      },
    ],
    pagination: {page: 1, page_size: 5, total_count: 48, total_pages: 10, has_previous: false, has_next: true},
    summary: {total_sessions: 48, average_score_pct: 68, average_duration_seconds: 1296, best_score_pct: 90, today_duration_seconds: 720, daily_goal_minutes: 20},
    trend: [
      {date: "2026-08-12", score_pct: 58},
      {date: "2026-08-13", score_pct: 76},
      {date: "2026-08-14", score_pct: 80},
      {date: "2026-08-15", score_pct: 68},
    ],
    available_lessons: [{id: "31111111-1111-4111-8111-111111111111", lesson_no: 32, title_fr: "LES PRONOMS RELATIFS"}],
    filters: {mode: "ALL", lesson_id: null, score: "ALL", date_from: null, date_to: null},
    as_of: "2026-08-25T16:00:00Z",
    runtime_version: "history-runtime-v1.0.0",
  },
  meta: {request_id: "history-request", api_version: "v1"},
};

test("renders real attempt history with score, duration and result CTA", async () => {
  vi.mocked(apiRequest).mockResolvedValue(response);
  render(<HistoryClient locale="fa" />);

  expect(await screen.findByText("LES PRONOMS RELATIFS")).toBeInTheDocument();
  expect(screen.getAllByText("۸۰%").length).toBeGreaterThan(0);
  expect(screen.getByText("22:18")).toBeInTheDocument();
  expect(screen.getByRole("link", {name: /مشاهده/})).toHaveAttribute(
    "href",
    "/fa/attempts/11111111-1111-4111-8111-111111111111/result",
  );
});

test("filters call the read-only history endpoint instead of fabricating rows", async () => {
  vi.mocked(apiRequest).mockResolvedValue(response);
  render(<HistoryClient locale="fa" />);
  await screen.findByText("LES PRONOMS RELATIFS");

  fireEvent.change(screen.getByLabelText("همه حالت‌ها"), {target: {value: "TCF"}});

  await waitFor(() => {
    expect(vi.mocked(apiRequest).mock.calls.some(([url]) => String(url).includes("mode=TCF"))).toBe(true);
  });
});

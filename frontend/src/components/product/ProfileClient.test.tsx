import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, expect, test, vi} from "vitest";
import {ProfileClient} from "./ProfileClient";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

function dashboardPayload() {
  return {
    data: {
      as_of: "2026-08-25T15:00:00Z",
      next_action: "WEAK_CONFIDENT_LESSON",
      mastery: [
        {scope_type: "LESSON", scope_id: "L01", scope_title: "Les pronoms relatifs", mastery_score_pct: 48, confidence: 0.8, coverage_ratio: 0.75, evidence_count: 20, mastery_band: "WEAK"},
        {scope_type: "LESSON", scope_id: "L02", scope_title: "Le passé composé", mastery_score_pct: 84, confidence: 0.9, coverage_ratio: 0.8, evidence_count: 24, mastery_band: "STRONG"},
        {scope_type: "CATEGORY", scope_id: "C01", scope_title: "Temps verbaux", mastery_score_pct: 68, confidence: 0.7, coverage_ratio: 0.65, evidence_count: 18, mastery_band: "DEVELOPING"},
      ],
      review_queue: {due_count: 4, overdue_count: 1, next_due_at: "2026-08-25T12:00:00Z", suspended_concept_count: 0},
      error_review: {unresolved_group_count: 2, corrected_item_count: 6, top_misconception_groups: []},
      recent_test: {attempt_id: "a1", test_id: "t1", mode: "ADAPTIVE", title: "Adaptive practice", score_raw: 8, score_pct: 80, completed_at: "2026-08-24T18:00:00Z"},
      in_progress_attempt: null,
      trend: {points: [
        {date: "2026-08-20", mastery_score_pct: 56},
        {date: "2026-08-21", mastery_score_pct: 61},
        {date: "2026-08-22", mastery_score_pct: 64},
        {date: "2026-08-23", mastery_score_pct: 68},
      ]},
      activity: {questions_answered: 1248, completed_attempts: 32, current_streak_days: 7, study_minutes: 1296},
      profile_locale: "fa-IR",
    },
    meta: {request_id: "r1", api_version: "v1"},
  };
}

function nextActionPayload() {
  return {
    data: {
      code: "WEAK_CONFIDENT_LESSON",
      destination: "/fa/lessons/L01",
      reason: "این درس به تمرین بیشتری نیاز دارد.",
    },
    meta: {request_id: "r2", api_version: "v1"},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

test("renders the learner-centered profile workspace from dashboard evidence", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(dashboardPayload())
    .mockResolvedValueOnce(nextActionPayload());

  render(<ProfileClient locale="fa" />);

  expect(await screen.findByRole("heading", {name: "زبان‌آموز Grammar Mastery"})).toBeInTheDocument();
  expect(screen.getByText("تسلط کلی")).toBeInTheDocument();
  expect(screen.getByText("سؤال پاسخ‌داده‌شده")).toBeInTheDocument();
  expect(screen.getByText("جلسه کامل‌شده")).toBeInTheDocument();
  expect(screen.getByText("روز متوالی")).toBeInTheDocument();
  expect(screen.getAllByText("Les pronoms relatifs").length).toBeGreaterThan(0);
  expect(screen.getByText("Le passé composé")).toBeInTheDocument();
  expect(screen.getByText(/آخرین حالت استفاده‌شده/)).toHaveTextContent("تطبیقی");
  expect(screen.getByRole("link", {name: "مشاهده پیشرفت"})).toHaveAttribute("href", "/fa/progress");
});

test("uses a cached safe snapshot when the live dashboard fails", async () => {
  window.sessionStorage.setItem("gmp-profile-safe-snapshot-v1", JSON.stringify({
    savedAt: "2026-08-25T14:00:00Z",
    dashboard: dashboardPayload(),
    nextAction: nextActionPayload(),
  }));
  vi.mocked(apiRequest).mockRejectedValue(new Error("offline"));
  const user = userEvent.setup();

  render(<ProfileClient locale="en" />);

  expect(await screen.findByText("Showing the last safe profile snapshot")).toBeInTheDocument();
  expect(screen.getByRole("heading", {name: "Grammar Mastery Learner"})).toBeInTheDocument();
  await user.click(screen.getByRole("button", {name: "Retry"}));
  expect(vi.mocked(apiRequest)).toHaveBeenCalled();
});

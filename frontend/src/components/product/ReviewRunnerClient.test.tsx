import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect, test, vi} from "vitest";
import {ReviewRunnerClient} from "./ReviewRunnerClient";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

test("grades a due review and explains graduation", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "SPACED",
        resolution_status: "UNRESOLVED",
        reviewability: "RETRY_ALLOWED",
        marked: false,
        feedback_state: "HIDDEN",
        previous_selected_option_id: null,
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
          stem: "Choisissez la bonne réponse.",
          stem_locale: "fr-FR",
          question_type: "CLOZE_SINGLE",
          difficulty: "MEDIUM",
          options: [
            {id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: "A", text: "que"},
            {id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: "B", text: "dont"},
            {id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", position: "C", text: "où"},
            {id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", position: "D", text: "qui"},
          ],
          media: [],
        },
      },
      meta: {request_id: "r1", api_version: "v1"},
    })
    .mockResolvedValueOnce({
      data: {
        review_item: {
          id: "11111111-1111-4111-8111-111111111111",
          kind: "SPACED",
          resolution_status: "CORRECTED",
          reviewability: "HISTORY_ONLY",
          marked: false,
          feedback_state: "REVEALED",
          previous_selected_option_id: null,
          schedule: {
            status: "COMPLETED",
            learning_state: null,
            due_at: "2026-10-21T17:00:00Z",
            interval_days: 60,
            consecutive_correct_reviews: 3,
            graduated: true,
            scheduler_version: "review-practice-policy-v1.0.0",
          },
          question: {
            question_revision_id: "22222222-2222-4222-8222-222222222222",
            stem: "Choisissez la bonne réponse.",
            stem_locale: "fr-FR",
            question_type: "CLOZE_SINGLE",
            difficulty: "MEDIUM",
            options: [
              {id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: "A", text: "que"},
              {id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: "B", text: "dont"},
              {id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", position: "C", text: "où"},
              {id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", position: "D", text: "qui"},
            ],
            media: [],
          },
        },
        feedback: {
          is_correct: true,
          selected_option_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          correct_option_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          selected_option_explanation: "Correct.",
          correct_option_explanation: "Correct.",
          full_explanation: "dont replaces de + noun.",
        },
        schedule: {
          status: "COMPLETED",
          learning_state: null,
          due_at: "2026-10-21T17:00:00Z",
          interval_days: 60,
          consecutive_correct_reviews: 3,
          graduated: true,
          scheduler_version: "review-practice-policy-v1.0.0",
        },
      },
      meta: {request_id: "r2", api_version: "v1"},
    });

  const user = userEvent.setup();
  render(<ReviewRunnerClient locale="fa" reviewId="11111111-1111-4111-8111-111111111111" />);

  expect(await screen.findByText("Choisissez la bonne réponse.")).toBeInTheDocument();
  await user.click(screen.getByText("dont"));
  await user.click(screen.getByRole("button", {name: "ثبت پاسخ"}));

  expect(await screen.findByText("درست پاسخ دادید")).toBeInTheDocument();
  expect(screen.getByText(/از صف مرور فعال خارج شد/)).toBeInTheDocument();
});

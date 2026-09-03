import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ReviewInbox} from "./ReviewInbox";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({
  ApiError: class ApiError extends Error {
    status = 0;
    code = "TEST_ERROR";
    requestId?: string;
    constructor(value: {message: string}) { super(value.message); }
  },
  apiRequest: vi.fn(),
}));

const mockedApi = vi.mocked(apiRequest);
const envelope = {
  data: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "MISTAKE" as const,
      status: "UNRESOLVED",
      title: "Le livre que j’achète est intéressant.",
      group_key: "MISCONCEPTION:22222222-2222-4222-8222-222222222222",
      repeat_count: 3,
      due_at: null,
      marked: false,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "SPACED" as const,
      status: "SCHEDULED",
      title: "Le passé composé",
      group_key: null,
      repeat_count: 0,
      due_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      marked: false,
    },
  ],
  page: {page_size: 100, has_more: false, next_cursor: null},
  meta: {request_id: "test", api_version: "v1"},
};

describe("ReviewInbox", () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedApi.mockResolvedValue(envelope as never);
  });

  it("keeps the default inbox on the SRS concept schedule instead of mistake history", async () => {
    render(<ReviewInbox locale="en" />);

    expect(await screen.findByRole("heading", {name: "Review Inbox"})).toBeInTheDocument();

    await waitFor(() => {
      const reviewCall = mockedApi.mock.calls.find(([url]) =>
        typeof url === "string" && url.startsWith("/api/backend/reviews?"),
      );
      expect(reviewCall).toBeDefined();
      const url = String(reviewCall?.[0]);
      expect(url).toContain("filter%5Bkind%5D=SPACED");
      // Keep future SRS schedules available to the Week/Later planning tabs.
      expect(url).not.toContain("filter%5Bdue%5D=true");
    });
  });

  it("renders the real review queue and filters loaded rows by search", async () => {
    const user = userEvent.setup();
    render(<ReviewInbox locale="en" />);

    expect(await screen.findByRole("heading", {name: "Review Inbox"})).toBeInTheDocument();
    expect(screen.getByText("Le livre que j’achète est intéressant.")).toBeInTheDocument();
    expect(screen.getByText("Le passé composé")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", {name: /search question/i}), "passé");
    expect(screen.queryByText("Le livre que j’achète est intéressant.")).not.toBeInTheDocument();
    expect(screen.getByText("Le passé composé")).toBeInTheDocument();
  });

  it("uses the existing mark API only for a mistake item", async () => {
    const user = userEvent.setup();
    render(<ReviewInbox locale="en" />);
    const mark = await screen.findByRole("button", {name: "Mark for review"});
    await user.click(mark);

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      "/api/backend/reviews/11111111-1111-4111-8111-111111111111/mark",
      expect.objectContaining({method: "PUT"}),
    ));
  });
});

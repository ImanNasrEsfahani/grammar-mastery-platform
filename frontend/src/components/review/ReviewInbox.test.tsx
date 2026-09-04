import {render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ReviewInbox} from "./ReviewInbox";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    requestId?: string;
    constructor(value: {status?: number; code?: string; message: string}) {
      super(value.message);
      this.status = value.status ?? 0;
      this.code = value.code ?? "TEST_ERROR";
    }
  },
  apiRequest: vi.fn(),
}));

const mockedApi = vi.mocked(apiRequest);
const firstId = "11111111-1111-4111-8111-111111111111";
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

function makeId(index: number) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function item(index: number, dueAt = yesterday) {
  return {
    id: index === 0 ? firstId : makeId(index),
    kind: "SPACED" as const,
    status: "SCHEDULED",
    title: index === 0 ? "Future after quand" : `Review concept ${index + 1}`,
    group_key: null,
    repeat_count: index % 4,
    due_at: dueAt,
    marked: false,
  };
}

function pages() {
  const all = [
    ...Array.from({length: 137}, (_, index) => item(index)),
    item(137, tomorrow),
  ];
  return [
    {
      data: all.slice(0, 100),
      page: {page_size: 100, has_more: true, next_cursor: "cursor-100"},
      meta: {request_id: "q1", api_version: "v1"},
    },
    {
      data: all.slice(100),
      page: {page_size: 100, has_more: false, next_cursor: null},
      meta: {request_id: "q2", api_version: "v1"},
    },
  ];
}

describe("ReviewInbox review-session entry points", () => {
  beforeEach(() => {
    mockedApi.mockReset();
    const [firstPage, secondPage] = pages();
    mockedApi.mockImplementation(async (url) => {
      const value = String(url);
      if (value.startsWith("/api/backend/mastery-map")) {
        return {data: {categories: []}} as never;
      }
      if (value.includes("page%5Bafter%5D=cursor-100")) return secondPage as never;
      if (value.startsWith("/api/backend/reviews?")) return firstPage as never;
      throw new Error(`Unexpected API call: ${value}`);
    });
  });

  it("loads every review page so All/Today counts are complete instead of capped at 100", async () => {
    render(<ReviewInbox locale="en" />);

    expect(await screen.findByRole("heading", {name: "Review Inbox"})).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tab", {name: "All (138)"})).toBeInTheDocument());
    expect(screen.getByRole("tab", {name: "Today (137)"})).toBeInTheDocument();

    const reviewCalls = mockedApi.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/backend/reviews?"));
    expect(reviewCalls.some((url) => url.includes("page%5Bafter%5D=cursor-100"))).toBe(true);
    expect(reviewCalls.every((url) => !url.includes("page%5Bsize%5D=25"))).toBe(true);
  });

  it("offers one dedicated CTA for the complete due queue with the exact due count", async () => {
    render(<ReviewInbox locale="en" />);

    const startDue = await screen.findByRole("link", {name: /Start all due reviews \(137\)/i});
    expect(startDue).toHaveAttribute("href", `/en/review/${firstId}?mode=due&fresh=1`);
  });

  it("makes each yellow row CTA explicitly single-item and starts a fresh isolated 1-item session", async () => {
    render(<ReviewInbox locale="en" />);

    await screen.findByText("Future after quand");
    const rowLinks = screen.getAllByRole("link", {name: /Review this item/i});
    expect(rowLinks.length).toBeGreaterThan(100);
    expect(rowLinks[0]).toHaveAttribute("href", `/en/review/${firstId}?mode=single&fresh=1`);
  });
});

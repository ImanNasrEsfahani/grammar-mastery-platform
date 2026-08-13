import {render, screen} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {ReviewListClient} from "./ReviewListClient";
import {apiRequest} from "@/lib/api/client";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

test("renders the review item's real title", async () => {
  vi.mocked(apiRequest).mockResolvedValue({
    data: [{id: "11111111-1111-4111-8111-111111111111", kind: "MISTAKE", status: "UNRESOLVED", title: "Choisissez la bonne préposition.", marked: false}],
    page: {page_size: 25, has_more: false, next_cursor: null},
    meta: {request_id: "test-request", api_version: "v1"},
  });
  render(<ReviewListClient locale="fa" />);
  expect(await screen.findByText("Choisissez la bonne préposition.")).toBeInTheDocument();
  expect(screen.getByText("مرور خطا")).toBeInTheDocument();
});

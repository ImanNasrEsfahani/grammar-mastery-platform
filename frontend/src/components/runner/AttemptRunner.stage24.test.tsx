import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptRunner } from "./AttemptRunner";
import { ids, nextEnvelope, receiptEnvelope } from "@/test/fixtures";

const replace = vi.fn();
const push = vi.fn();
const router = {replace, push};
vi.mock("next/navigation", () => ({useRouter: () => router}));

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {"Content-Type": "application/json"},
  });
}

describe("Stage24 full attempt runner lifecycle", () => {
  beforeEach(() => {
    replace.mockReset();
    push.mockReset();
  });

  it("keeps the answer hidden, submits once, completes, and routes to results", async () => {
    let nextCalls = 0;
    const requestOrder: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/next")) {
        requestOrder.push("next");
        nextCalls += 1;
        return nextCalls === 1 ? jsonResponse(nextEnvelope) : new Response(null, {status: 204});
      }
      if (url.endsWith("/answers") && init?.method === "POST") {
        requestOrder.push("answer");
        return jsonResponse(receiptEnvelope);
      }
      if (url.endsWith("/complete") && init?.method === "POST") {
        requestOrder.push("complete");
        return jsonResponse({data: {status: "COMPLETED"}});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AttemptRunner attemptId={ids.attempt} locale="en" />);
    const option = await screen.findByRole("button", {name: /viennes/i});
    await waitFor(() => expect(option).not.toBeDisabled());
    expect(document.body.textContent).not.toContain("Il faut que requires the present subjunctive");

    await userEvent.click(option);
    await userEvent.click(screen.getByRole("button", {name: "Submit answer"}));
    expect(await screen.findByRole("heading", {name: "Correct answer"})).toBeInTheDocument();
    expect(document.body.textContent).toContain("Il faut que requires the present subjunctive");

    await userEvent.click(screen.getByRole("button", {name: "Next question"}));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/${"en"}/attempts/${ids.attempt}/result`),
    );
    expect(requestOrder).toEqual(["next", "answer", "next", "complete"]);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/answers"))).toHaveLength(1);
  });
});

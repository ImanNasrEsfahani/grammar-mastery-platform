import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptRunner } from "./AttemptRunner";
import { getPendingAnswer } from "@/lib/offline/pending-answer-store";
import { ids, nextEnvelope, receiptEnvelope } from "@/test/fixtures";

const replace = vi.fn();
const push = vi.fn();
const router = {replace, push};
vi.mock("next/navigation", () => ({useRouter: () => router}));

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {status, headers: {"Content-Type": "application/json"}});
}

describe("AttemptRunner", () => {
  beforeEach(() => { replace.mockReset(); });

  it("supports numeric keys and sends one idempotent answer without page reload", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/next")) return jsonResponse(nextEnvelope);
      if (url.endsWith("/answers") && init?.method === "POST") return jsonResponse(receiptEnvelope);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AttemptRunner attemptId={ids.attempt} locale="en" />);

    const secondOption = await screen.findByRole("button", {name: /viennes/i});
    await waitFor(() => expect(secondOption).not.toBeDisabled());
    await userEvent.keyboard("2");
    await waitFor(() => expect(secondOption).toHaveAttribute("aria-pressed", "true"));
    fireEvent.keyDown(window, {key: "Enter"});
    expect(await screen.findByRole("heading", {name: "Correct answer"})).toBeInTheDocument();

    const answerCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/answers"));
    expect(answerCall).toBeDefined();
    const headers = new Headers(answerCall?.[1]?.headers);
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(answerCall?.[1]?.body)).toContain(ids.optionB);
    expect(document.body.textContent).toContain("Il faut que requires");
  });

  it("preserves a temporarily failed answer and replays the exact key when online", async () => {
    let answerAttempts = 0;
    const seenKeys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/next")) return jsonResponse(nextEnvelope);
      if (url.endsWith("/answers")) {
        answerAttempts += 1;
        seenKeys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
        if (answerAttempts === 1) throw new TypeError("offline");
        return jsonResponse(receiptEnvelope);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    render(<AttemptRunner attemptId={ids.attempt} locale="en" />);
    const option = await screen.findByRole("button", {name: /viennes/i});
    await waitFor(() => expect(option).not.toBeDisabled());
    await userEvent.click(option);
    await userEvent.click(screen.getByRole("button", {name: "Submit answer"}));
    expect(await screen.findByRole("heading", {name: /answer is safe/i})).toBeInTheDocument();
    const pending = await getPendingAnswer(ids.attempt, ids.question);
    expect(pending?.selected_option_id).toBe(ids.optionB);
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByRole("heading", {name: "Correct answer"})).toBeInTheDocument();
    await waitFor(() => expect(answerAttempts).toBe(2));
    expect(seenKeys[0]).toBe(seenKeys[1]);
    await expect(getPendingAnswer(ids.attempt, ids.question)).resolves.toBeNull();
  });
});

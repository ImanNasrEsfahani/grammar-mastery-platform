import "@testing-library/jest-dom/vitest";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {PasswordRecoveryClient} from "./PasswordRecoveryClient";

const apiRequest = vi.fn();
vi.mock("@/lib/api/client", async () => {
  class ApiError extends Error {
    status: number; code: string; fields: Record<string, string[]>; requestId: string;
    constructor(input: {status: number; code: string; message: string; fields?: Record<string, string[]>; requestId?: string}) {
      super(input.message); this.status = input.status; this.code = input.code; this.fields = input.fields ?? {}; this.requestId = input.requestId ?? "test-request";
    }
  }
  return {ApiError, apiRequest: (...args: unknown[]) => apiRequest(...args)};
});

describe("PasswordRecoveryClient", () => {
  beforeEach(() => apiRequest.mockReset());

  it("shows generic check-email state after a recovery request", async () => {
    apiRequest.mockResolvedValue({data: {status: "ACCEPTED"}, meta: {request_id: "req-1", api_version: "v1"}});
    const user = userEvent.setup();
    render(<PasswordRecoveryClient locale="en" mode="request" />);
    await user.type(screen.getByLabelText("Account email"), "learner@example.com");
    await user.click(screen.getByRole("button", {name: "Send recovery link"}));
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText(/do not confirm whether an account exists/i)).toBeInTheDocument();
  });

  it("renders expired state when reset token is missing", () => {
    render(<PasswordRecoveryClient locale="en" mode="reset" token={null} />);
    expect(screen.getByText("This link is invalid or expired")).toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Request a new link"})).toHaveAttribute("href", "/en/forgot-password");
  });

  it("submits matching 12+ character passwords and reaches success", async () => {
    apiRequest.mockResolvedValue({data: {status: "PASSWORD_RESET"}, meta: {request_id: "req-2", api_version: "v1"}});
    const user = userEvent.setup();
    render(<PasswordRecoveryClient locale="en" mode="reset" token={"a".repeat(43)} />);
    await user.type(screen.getByLabelText("New password"), "Longer!Password123");
    await user.type(screen.getByLabelText("Confirm new password"), "Longer!Password123");
    await user.click(screen.getByRole("button", {name: "Save new password"}));
    await waitFor(() => expect(screen.getByText("Password updated")).toBeInTheDocument());
    expect(screen.getByRole("link", {name: "Log in with new password"})).toHaveAttribute("href", "/en/login?reset=1");
  });
});

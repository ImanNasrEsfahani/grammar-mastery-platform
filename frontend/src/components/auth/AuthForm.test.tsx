import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, expect, test, vi} from "vitest";
import {AuthForm} from "./AuthForm";
import {apiRequest} from "@/lib/api/client";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({replace, refresh}),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiRequest).mockResolvedValue({data: {authenticated: true}, meta: {request_id: "login-test"}} as never);
});

test("login renders the missing design controls", () => {
  render(<AuthForm mode="login" locale="en" />);
  expect(screen.getByRole("checkbox", {name: "Remember me"})).toBeInTheDocument();
  expect(screen.getByRole("link", {name: "Forgot password?"})).toHaveAttribute("href", "/en/forgot-password");
  expect(screen.getByRole("link", {name: "Create one"})).toHaveAttribute("href", "/en/register");
  expect(screen.getByRole("button", {name: "Show password"})).toBeInTheDocument();
});

test("show hide password is functional", () => {
  render(<AuthForm mode="login" locale="en" />);
  const password = screen.getByLabelText("Password");
  expect(password).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", {name: "Show password"}));
  expect(password).toHaveAttribute("type", "text");
  expect(screen.getByRole("button", {name: "Hide password"})).toBeInTheDocument();
});

test("remember me is forwarded only to the frontend session endpoint", async () => {
  render(<AuthForm mode="login" locale="en" />);
  fireEvent.change(screen.getByLabelText("Email"), {target: {value: "user@example.com"}});
  fireEvent.change(screen.getByLabelText("Password"), {target: {value: "secret-pass"}});
  fireEvent.click(screen.getByRole("checkbox", {name: "Remember me"}));
  fireEvent.click(screen.getByRole("button", {name: "Sign in"}));

  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
  const [path, init] = vi.mocked(apiRequest).mock.calls[0];
  expect(path).toBe("/api/session/login");
  expect(JSON.parse(String(init?.body))).toEqual({
    email: "user@example.com",
    password: "secret-pass",
    remember_me: true,
  });
  expect(replace).toHaveBeenCalledWith("/en/dashboard");
  expect(refresh).toHaveBeenCalled();
});

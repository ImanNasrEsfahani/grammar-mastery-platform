import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, expect, test, vi} from "vitest";
import {apiRequest} from "@/lib/api/client";
import {RegisterExperience} from "./RegisterExperience";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({replace, refresh}),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {...original, apiRequest: vi.fn()};
});

afterEach(() => {
  vi.clearAllMocks();
});

test("requires confirmation and terms before sending registration", async () => {
  const user = userEvent.setup();
  render(<RegisterExperience locale="en" />);

  await user.type(screen.getByLabelText("Full name"), "Ada Learner");
  await user.type(screen.getByLabelText("Email address"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "ExamplePassword1!");
  await user.type(screen.getByLabelText("Confirm password"), "DifferentPassword1!");
  await user.click(screen.getByRole("button", {name: "Create my account"}));

  expect(screen.getByText("The confirmation does not match the password.")).toBeInTheDocument();
  expect(screen.getByText("Accept the Terms of Use and Privacy Policy to continue.")).toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

test("toggles password visibility and creates an authenticated session", async () => {
  const user = userEvent.setup();
  vi.mocked(apiRequest).mockResolvedValue({});
  render(<RegisterExperience locale="en" />);

  const password = screen.getByLabelText("Password") as HTMLInputElement;
  await user.type(screen.getByLabelText("Full name"), "Ada Learner");
  await user.type(screen.getByLabelText("Email address"), "Ada@Example.com");
  await user.type(password, "ExamplePassword1!");
  await user.click(screen.getAllByRole("button", {name: "Show password"})[0]!);
  expect(password.type).toBe("text");
  await user.type(screen.getByLabelText("Confirm password"), "ExamplePassword1!");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", {name: "Create my account"}));

  expect(apiRequest).toHaveBeenNthCalledWith(1, "/api/backend/auth/register", expect.objectContaining({method: "POST"}));
  expect(apiRequest).toHaveBeenNthCalledWith(2, "/api/session/login", expect.objectContaining({method: "POST"}));
  const firstBody = JSON.parse(String(vi.mocked(apiRequest).mock.calls[0]?.[1]?.body));
  expect(firstBody.email).toBe("ada@example.com");
  expect(firstBody).not.toHaveProperty("confirm_password");
  expect(firstBody).not.toHaveProperty("terms");
  expect(replace).toHaveBeenCalledWith("/en/dashboard");
  expect(refresh).toHaveBeenCalled();
});

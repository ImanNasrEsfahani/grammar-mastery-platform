import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, expect, test, vi} from "vitest";
import {UserMenu} from "./UserMenu";
import {apiRequest} from "@/lib/api/client";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({replace, refresh}),
}));

vi.mock("@/lib/api/client", () => ({
  apiRequest: vi.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
  replace.mockReset();
  refresh.mockReset();
  vi.mocked(apiRequest).mockResolvedValue(null);
});

test("opens the account menu with real product destinations and closes with Escape", async () => {
  render(<UserMenu locale="fa" displayName="Iman" unreadCount={2} />);
  const trigger = screen.getByRole("button", {name: /باز کردن منوی حساب کاربری/});
  expect(trigger).toHaveAttribute("data-unread", "true");

  fireEvent.click(trigger);
  expect(screen.getByRole("menu", {name: "منوی حساب کاربری"})).toBeInTheDocument();
  expect(screen.getByRole("menuitem", {name: /پروفایل/})).toHaveAttribute("href", "/fa/profile");
  expect(screen.getByRole("menuitem", {name: /تاریخچه/})).toHaveAttribute("href", "/fa/history");
  expect(screen.getByRole("menuitem", {name: /تنظیمات/})).toHaveAttribute("href", "/fa/settings");
  expect(screen.getByRole("menuitem", {name: /اعلان‌ها/})).toHaveAttribute("href", "/fa/notifications");

  fireEvent.keyDown(document, {key: "Escape"});
  await waitFor(() => expect(screen.queryByRole("menu", {name: "منوی حساب کاربری"})).not.toBeInTheDocument());
  expect(screen.getByRole("button", {name: /باز کردن منوی حساب کاربری/})).toHaveFocus();
});

test("synchronizes the avatar unread state with the existing notification storage key", async () => {
  window.localStorage.setItem("gmp-notifications-unread-v1", "3");
  render(<UserMenu locale="en" displayName="Learner" />);
  await waitFor(() => {
    expect(screen.getByRole("button", {name: /Open user account menu/})).toHaveAttribute("data-unread", "true");
  });
});

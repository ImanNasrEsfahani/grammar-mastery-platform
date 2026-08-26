import {fireEvent, render, screen, within} from "@testing-library/react";
import {beforeEach, expect, test, vi} from "vitest";
import {AppHeader} from "./AppHeader";

const navigationState = vi.hoisted(() => ({pathname: "/fa/dashboard"}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({replace: vi.fn(), refresh: vi.fn()}),
}));

vi.mock("@/lib/api/client", () => ({
  apiRequest: vi.fn(async () => ({data: {review_queue: {due_count: 3}}})),
}));

beforeEach(() => {
  navigationState.pathname = "/fa/dashboard";
  window.localStorage.clear();
});

test("mobile chrome uses the five-item bottom navigation instead of a hamburger panel", async () => {
  render(<AppHeader locale="fa" authenticated />);

  const nav = screen.getByRole("navigation", {name: "ناوبری پایین موبایل"});
  expect(within(nav).getAllByRole("link")).toHaveLength(5);
  expect(within(nav).getByRole("link", {name: "داشبورد"})).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("button", {name: "باز کردن منو"})).not.toBeInTheDocument();
  expect(await within(nav).findByText("3")).toBeInTheDocument();
});

test("mobile top header keeps notifications and opens the account drawer from the avatar", () => {
  window.localStorage.setItem("gmp-notifications-unread-v1", "2");
  render(<AppHeader locale="fa" authenticated />);

  const notificationLinks = screen.getAllByRole("link", {name: "اعلان‌ها"});
  expect(notificationLinks.length).toBeGreaterThan(0);
  expect(notificationLinks[0]!).toHaveAttribute("href", "/fa/notifications");

  fireEvent.click(screen.getByRole("button", {name: "باز کردن منوی حساب"}));
  const drawer = screen.getByRole("dialog", {name: "Grammar Mastery"});
  expect(within(drawer).getByRole("link", {name: "پروفایل"})).toHaveAttribute("href", "/fa/profile");
  expect(within(drawer).getByRole("link", {name: "تنظیمات"})).toHaveAttribute("href", "/fa/settings");
  expect(within(drawer).getByRole("link", {name: "اعلان‌ها"})).toHaveAttribute("href", "/fa/notifications");

  fireEvent.keyDown(document, {key: "Escape"});
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("question runner keeps focus mode by hiding both header and bottom navigation", () => {
  navigationState.pathname = "/fa/attempts/attempt-1";
  const {container} = render(<AppHeader locale="fa" authenticated />);
  expect(container).toBeEmptyDOMElement();
});

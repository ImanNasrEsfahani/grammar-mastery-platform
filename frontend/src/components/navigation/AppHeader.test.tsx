import {fireEvent, render, screen} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {AppHeader} from "./AppHeader";

vi.mock("next/navigation", () => ({usePathname: () => "/fa/dashboard", useRouter: () => ({replace: vi.fn(), refresh: vi.fn()})}));

test("mobile menu exposes navigation and toggles accessibly", () => {
  render(<AppHeader locale="fa" authenticated />);
  const toggle = screen.getByRole("button", {name: "باز کردن منو"});
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(screen.getByRole("button", {name: "بستن منو"})).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("navigation", {name: "ناوبری موبایل"})).toHaveTextContent("داشبورد");
  expect(screen.getByRole("navigation", {name: "ناوبری موبایل"})).toHaveTextContent("پیشرفت");
  fireEvent.keyDown(document, {key: "Escape"});
  expect(screen.getByRole("button", {name: "باز کردن منو"})).toHaveAttribute("aria-expanded", "false");
});

test("header preserves notification access to the notification center", () => {
  window.localStorage.setItem("gmp-notifications-unread-v1", "3");
  render(<AppHeader locale="fa" authenticated />);
  const notificationLinks = screen.getAllByRole("link", {name: "اعلان‌ها"});
  expect(notificationLinks.length).toBeGreaterThan(0);
  expect(notificationLinks[0]!).toHaveAttribute("href", "/fa/notifications");
});

test("authenticated header exposes the designed avatar account trigger", () => {
  render(<AppHeader locale="fa" authenticated />);
  expect(screen.getAllByRole("button", {name: /باز کردن منوی حساب کاربری/}).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", {name: "خروج"})).not.toBeInTheDocument();
});

import {beforeEach, fireEvent, render, screen} from "@testing-library/react";
import {expect, test} from "vitest";
import {NotificationsClient} from "./NotificationsClient";

beforeEach(() => {
  window.localStorage.clear();
});

test("renders the complete notification center and real route CTAs", () => {
  render(<NotificationsClient locale="fa" />);

  expect(screen.getByRole("heading", {name: "اعلان‌ها"})).toBeInTheDocument();
  expect(screen.getByRole("button", {name: /همه اعلان‌ها/})).toHaveTextContent("8");
  expect(screen.getByRole("button", {name: /خوانده‌نشده/})).toHaveTextContent("3");
  expect(screen.getByRole("button", {name: /یادگیری/})).toHaveTextContent("5");
  expect(screen.getByRole("button", {name: /سیستم/})).toHaveTextContent("2");
  expect(screen.getByRole("link", {name: "Review Inbox"})).toHaveAttribute("href", "/fa/review");
  expect(screen.getByRole("link", {name: "Practice Builder"})).toHaveAttribute("href", "/fa/tests/new");
});

test("filters unread notifications and mark-all-read persists the state", () => {
  render(<NotificationsClient locale="fa" />);

  fireEvent.click(screen.getByRole("button", {name: /خوانده‌نشده/}));
  expect(screen.getByRole("heading", {name: "اعلان‌های خوانده‌نشده"})).toBeInTheDocument();
  expect(screen.getAllByText("جدید")).toHaveLength(3);

  fireEvent.click(screen.getByRole("button", {name: "خواندن همه"}));
  expect(screen.queryByText("جدید")).not.toBeInTheDocument();
  expect(window.localStorage.getItem("gmp-notifications-unread-v1")).toBe("0");
});

test("can toggle one notification through its options menu", () => {
  render(<NotificationsClient locale="en" />);

  const menus = screen.getAllByRole("button", {name: "Notification options"});
  fireEvent.click(menus[0]!);
  fireEvent.click(screen.getByRole("menuitem", {name: "Mark as read"}));

  expect(window.localStorage.getItem("gmp-notifications-unread-v1")).toBe("2");
});

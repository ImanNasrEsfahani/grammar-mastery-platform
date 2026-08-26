import {render, screen, within} from "@testing-library/react";
import {expect, test} from "vitest";
import {MobileBottomNavigation} from "./MobileBottomNavigation";

test("renders the five mobile destinations and marks nested lesson routes active", () => {
  render(
    <MobileBottomNavigation
      locale="en"
      pathname="/en/lessons/lesson-12"
      authenticated
      reviewDueCount={3}
    />,
  );

  const nav = screen.getByRole("navigation", {name: "Mobile bottom navigation"});
  expect(within(nav).getAllByRole("link")).toHaveLength(5);
  expect(within(nav).getByRole("link", {name: "Lessons"})).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByText("3")).toBeInTheDocument();
});

test("caps large review badges without changing the accessible due count", () => {
  render(
    <MobileBottomNavigation
      locale="fa"
      pathname="/fa/review"
      authenticated
      reviewDueCount={125}
    />,
  );

  const nav = screen.getByRole("navigation", {name: "ناوبری پایین موبایل"});
  expect(within(nav).getByText("99+")).toBeInTheDocument();
  expect(within(nav).getByRole("link", {name: /۱۲۵ مرور سررسیدشده|125 مرور سررسیدشده/})).toHaveAttribute("aria-current", "page");
});

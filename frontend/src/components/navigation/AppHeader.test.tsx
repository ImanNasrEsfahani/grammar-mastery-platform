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
  fireEvent.keyDown(document, {key: "Escape"});
  expect(screen.getByRole("button", {name: "باز کردن منو"})).toHaveAttribute("aria-expanded", "false");
});

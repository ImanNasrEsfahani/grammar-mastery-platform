import {render, screen} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {NotFoundContent} from "./NotFoundContent";

vi.mock("next/navigation", () => ({usePathname: () => "/fa/missing-route"}));

test("404 recovery page exposes real dashboard, lessons and review destinations", () => {
  render(<NotFoundContent />);
  expect(screen.getByRole("heading", {name: "این صفحه پیدا نشد"})).toBeInTheDocument();
  expect(screen.getByRole("link", {name: "بازگشت به داشبورد"})).toHaveAttribute("href", "/fa/dashboard");
  expect(screen.getByRole("link", {name: "رفتن به درس‌ها"})).toHaveAttribute("href", "/fa/lessons");
  expect(screen.getByRole("link", {name: "صندوق بازبینی"})).toHaveAttribute("href", "/fa/review");
});

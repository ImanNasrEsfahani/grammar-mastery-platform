import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {ServiceUnavailable} from "./ServiceUnavailable";

describe("ServiceUnavailable", () => {
  it("renders real recovery destinations and support details", () => {
    render(<ServiceUnavailable locale="en" retryHref="/en/lessons?retry=1" referenceCode="req-503-abc" />);

    expect(screen.getByRole("heading", {name: "We’re improving your experience"})).toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Try again"})).toHaveAttribute("href", "/en/lessons?retry=1");
    expect(screen.getByRole("link", {name: /Return to dashboard/})).toHaveAttribute("href", "/en/dashboard");
    expect(screen.getByRole("link", {name: /View lessons/})).toHaveAttribute("href", "/en/lessons");
    expect(screen.getByRole("link", {name: "Contact support"})).toHaveAttribute("href", "mailto:support@grammar-mastery.com");
    expect(screen.getByText("req-503-abc")).toBeInTheDocument();
  });

  it("keeps the explicit maintenance page useful when no retry target exists", () => {
    render(<ServiceUnavailable locale="fa" />);
    expect(screen.queryByRole("link", {name: "تلاش دوباره"})).not.toBeInTheDocument();
    expect(screen.getByRole("link", {name: /بازگشت به داشبورد/})).toHaveAttribute("href", "/fa/dashboard");
  });
});

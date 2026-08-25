import {fireEvent, render, screen} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {EmptyState} from "./EmptyState";

const variants = [
  ["review", "Nothing is due for review"],
  ["search", "No results found"],
  ["history", "No history yet"],
  ["weakness", "No active weakness detected"],
  ["achievement", "No achievements yet"],
  ["filtered", "This list is empty"],
] as const;

test.each(variants)("renders the %s empty-state contract", (kind, title) => {
  render(
    <EmptyState
      kind={kind}
      locale="en"
      action={{type: "link", href: "/en/tests/new"}}
    />,
  );
  expect(screen.getByRole("heading", {name: title})).toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/en/tests/new");
});

test("supports contextual button actions for filtered empty states", () => {
  const clear = vi.fn();
  render(
    <EmptyState
      kind="filtered"
      locale="fa"
      action={{type: "button", label: "نمایش همه", onClick: clear}}
    />,
  );
  fireEvent.click(screen.getByRole("button", {name: "نمایش همه"}));
  expect(clear).toHaveBeenCalledTimes(1);
});

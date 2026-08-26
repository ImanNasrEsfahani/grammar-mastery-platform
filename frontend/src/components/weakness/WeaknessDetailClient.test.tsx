import {render, screen} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {WeaknessDetailClient} from "./WeaknessDetailClient";

vi.mock("@/lib/api/client", () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: vi.fn(),
}));

test("renders the complete que/dont misconception reference surface", () => {
  render(<WeaknessDetailClient locale="fa" weaknessKey="que-dont" query={{demo: "1"}} />);
  expect(screen.getByRole("heading", {name: "جزئیات نقطه ضعف"})).toBeInTheDocument();
  expect(screen.getByText("que ↔ dont")).toBeInTheDocument();
  expect(screen.getByText("dont = de + nom / de + personne / de + chose")).toBeInTheDocument();
  expect(screen.getByText("Le livre dont je parle est utile.")).toBeInTheDocument();
  expect(screen.getByText("Le livre que je parle est utile.")).toBeInTheDocument();
  expect(screen.getByRole("link", {name: "شروع تمرین هدفمند"})).toHaveAttribute("href", expect.stringContaining("/fa/tests/new"));
});

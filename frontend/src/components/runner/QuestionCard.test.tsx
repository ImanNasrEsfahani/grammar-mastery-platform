import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./QuestionCard";
import { ids, question } from "@/test/fixtures";

describe("QuestionCard", () => {
  it("renders a mixed-direction question without pre-submit answer leakage", async () => {
    const onSelect = vi.fn();
    render(
      <QuestionCard
        ref={createRef<HTMLHeadingElement>()}
        question={question}
        selectedOptionId={null}
        feedback={null}
        locked={false}
        onSelect={onSelect}
        labels={{correct: "Correct answer", incorrect: "Incorrect answer", selectAnswer: "Choose one option."}}
      />,
    );
    expect(screen.getByRole("heading", {name: question.stem})).toHaveAttribute("dir", "ltr");
    expect(screen.queryByText("Correct answer")).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect answer")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", {name: /viennes/i}));
    expect(onSelect).toHaveBeenCalledWith(ids.optionB);
  });
});

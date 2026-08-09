import { memo } from "react";
import type { AttemptOption } from "@/lib/api/types";

export type OptionState = "idle" | "selected" | "correct" | "incorrect" | "muted";

export const Option = memo(function Option({
  option,
  index,
  state,
  disabled,
  onSelect,
  correctLabel,
  incorrectLabel,
}: {
  option: AttemptOption;
  index: number;
  state: OptionState;
  disabled: boolean;
  onSelect: (optionId: string) => void;
  correctLabel: string;
  incorrectLabel: string;
}) {
  const status = state === "correct" ? correctLabel : state === "incorrect" ? incorrectLabel : null;
  return (
    <button
      type="button"
      className={`answer-option option-${state}`}
      aria-pressed={state === "selected"}
      disabled={disabled}
      onClick={() => onSelect(option.id)}
      data-option-index={index + 1}
    >
      <span className="option-key" aria-hidden="true">{index + 1}</span>
      <bdi dir="auto" className="option-text">{option.text}</bdi>
      {status ? <span className="option-status"><span aria-hidden="true">{state === "correct" ? "✓" : "×"}</span>{status}</span> : null}
    </button>
  );
});

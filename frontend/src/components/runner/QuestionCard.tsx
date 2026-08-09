import { forwardRef, memo } from "react";
import type { AnswerFeedback, AttemptQuestion } from "@/lib/api/types";
import { Option, type OptionState } from "./Option";

export const QuestionCard = memo(forwardRef<HTMLHeadingElement, {
  question: AttemptQuestion;
  selectedOptionId: string | null;
  feedback: AnswerFeedback | null;
  locked: boolean;
  onSelect: (optionId: string) => void;
  labels: {correct: string; incorrect: string; selectAnswer: string};
}>(function QuestionCard({question, selectedOptionId, feedback, locked, onSelect, labels}, headingRef) {
  function optionState(optionId: string): OptionState {
    if (feedback) {
      if (optionId === feedback.correct_option_id) return "correct";
      if (optionId === feedback.selected_option_id && !feedback.is_correct) return "incorrect";
      return "muted";
    }
    return optionId === selectedOptionId ? "selected" : "idle";
  }

  const stemDirection = question.stem_locale === "fa-IR" ? "rtl" : "ltr";
  const stemLanguage = question.stem_locale === "fa-IR" ? "fa" : "fr";

  return (
    <section className="surface question-card" aria-labelledby="question-heading">
      <div className="question-meta">
        <span>{question.question_type}</span>
        <span aria-hidden="true">·</span>
        <span>{question.difficulty.replaceAll("_", " ")}</span>
      </div>
      <h1 id="question-heading" ref={headingRef} tabIndex={-1} dir={stemDirection} lang={stemLanguage} className="question-stem">
        {question.stem}
      </h1>
      <p className="option-instruction" id="option-instruction">{labels.selectAnswer}</p>
      <div className="option-list" role="group" aria-describedby="option-instruction">
        {question.options.map((option, index) => (
          <Option
            key={option.id}
            option={option}
            index={index}
            state={optionState(option.id)}
            disabled={locked}
            onSelect={onSelect}
            correctLabel={labels.correct}
            incorrectLabel={labels.incorrect}
          />
        ))}
      </div>
    </section>
  );
}));

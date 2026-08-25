import {forwardRef, memo} from "react";
import type {AnswerFeedback, AttemptQuestion} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import {Option, type OptionState} from "./Option";

type QuestionActions = {
  bookmarked: boolean;
  bookmarkLabel: string;
  reportLabel: string;
  onBookmark: () => void;
  onReport: () => void;
};

const difficultyCopy = {
  fa: {EASY: "آسان", MEDIUM: "متوسط", HARD: "سخت", VERY_HARD: "خیلی سخت"},
  en: {EASY: "Easy", MEDIUM: "Medium", HARD: "Hard", VERY_HARD: "Very hard"},
} as const;

export const QuestionCard = memo(forwardRef<HTMLHeadingElement, {
  question: AttemptQuestion;
  selectedOptionId: string | null;
  feedback: AnswerFeedback | null;
  locked: boolean;
  onSelect: (optionId: string) => void;
  labels: {correct: string; incorrect: string; selectAnswer: string};
  uiLocale?: Locale;
  actions?: QuestionActions;
}>(function QuestionCard({question, selectedOptionId, feedback, locked, onSelect, labels, uiLocale = "en", actions}, headingRef) {
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
  const difficulty = difficultyCopy[uiLocale][question.difficulty];
  const readableType = question.question_type.replaceAll("_", " ").toLowerCase();
  const questionId = question.question_revision_id.slice(0, 8).toUpperCase();

  return (
    <section className="surface question-card" aria-labelledby="question-heading">
      <div className="question-meta">
        <span className="difficulty-pill"><span className="difficulty-dot" aria-hidden="true" />{difficulty}</span>
        <span>{readableType}</span>
        <span className="question-id" dir="ltr">ID: {questionId}</span>
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
            textDirection={stemDirection}
            textLanguage={stemLanguage}
          />
        ))}
      </div>
      {actions ? (
        <div className="question-actions">
          <button className="question-action-button" type="button" aria-pressed={actions.bookmarked} onClick={actions.onBookmark}>
            <span className="question-action-icon" aria-hidden="true">{actions.bookmarked ? "★" : "☆"}</span>
            <span>{actions.bookmarkLabel}</span>
          </button>
          <button className="question-action-button" type="button" onClick={actions.onReport}>
            <span className="question-action-icon" aria-hidden="true">⚑</span>
            <span>{actions.reportLabel}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}));

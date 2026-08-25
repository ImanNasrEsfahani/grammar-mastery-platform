import {memo} from "react";
import type {AnswerFeedback} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";

export const Explanation = memo(function Explanation({
  feedback,
  labels,
  locale = "en",
}: {
  feedback: AnswerFeedback;
  labels: {
    correct: string;
    incorrect: string;
    explanation: string;
    misconception?: string;
    relatedRule?: string;
  };
  locale?: Locale;
}) {
  const message = feedback.is_correct ? labels.correct : labels.incorrect;
  const explanation = feedback.full_explanation ?? feedback.correct_option_explanation ?? feedback.selected_option_explanation;
  const misconception = !feedback.is_correct ? feedback.selected_option_explanation : null;
  const relatedRule = feedback.correct_option_explanation;
  const misconceptionLabel = labels.misconception ?? (locale === "fa" ? "اشتباه رایج" : "Misconception");
  const relatedRuleLabel = labels.relatedRule ?? (locale === "fa" ? "قاعده مرتبط" : "Related rule");

  const showExplanation = Boolean(explanation);
  const showMisconception = Boolean(misconception && misconception !== explanation);
  const showRelatedRule = Boolean(relatedRule && relatedRule !== explanation && relatedRule !== misconception);

  return (
    <section className={`feedback-card ${feedback.is_correct ? "feedback-correct" : "feedback-incorrect"}`} aria-labelledby="feedback-title">
      <div className="feedback-result" role="status" aria-live="polite">
        <span className="feedback-icon" aria-hidden="true">{feedback.is_correct ? "✓" : "×"}</span>
        <h2 id="feedback-title">{message}</h2>
      </div>
      {showExplanation || showMisconception || showRelatedRule ? (
        <div className="learning-insights">
          {showExplanation ? (
            <article className="insight-card insight-explanation" id="runner-explanation">
              <h3>{labels.explanation}</h3>
              <p><bdi dir="auto">{explanation}</bdi></p>
            </article>
          ) : null}
          {showMisconception ? (
            <article className="insight-card insight-misconception" id="runner-misconception">
              <h3>{misconceptionLabel}</h3>
              <p><bdi dir="auto">{misconception}</bdi></p>
            </article>
          ) : null}
          {showRelatedRule ? (
            <article className="insight-card insight-rule" id="runner-related-rule">
              <h3>{relatedRuleLabel}</h3>
              <p><bdi dir="auto">{relatedRule}</bdi></p>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

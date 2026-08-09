import { memo } from "react";
import type { AnswerFeedback } from "@/lib/api/types";

export const Explanation = memo(function Explanation({
  feedback,
  labels,
}: {
  feedback: AnswerFeedback;
  labels: {correct: string; incorrect: string; explanation: string};
}) {
  const message = feedback.is_correct ? labels.correct : labels.incorrect;
  const explanation = feedback.full_explanation ?? feedback.correct_option_explanation ?? feedback.selected_option_explanation;

  return (
    <section className={`feedback-card ${feedback.is_correct ? "feedback-correct" : "feedback-incorrect"}`} aria-labelledby="feedback-title">
      <div className="feedback-result" role="status" aria-live="polite">
        <span className="feedback-icon" aria-hidden="true">{feedback.is_correct ? "✓" : "×"}</span>
        <h2 id="feedback-title">{message}</h2>
      </div>
      {explanation ? (
        <div className="explanation-copy">
          <h3>{labels.explanation}</h3>
          <p><bdi dir="auto">{explanation}</bdi></p>
        </div>
      ) : null}
    </section>
  );
});

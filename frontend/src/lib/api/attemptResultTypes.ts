import type {AnswerFeedback} from "./types";

/**
 * Additive runtime contract for the enriched completed-attempt result.
 *
 * `generated.ts` is intentionally generated from the frozen Stage 21 core
 * OpenAPI contract, whose AttemptResult schema is still the original minimal
 * payload. The Django runtime provider now returns
 * `attempt-result-insights-v1.0.0`; this file models that additive response
 * without mutating the frozen core contract.
 *
 * When a versioned OpenAPI revision formally includes these fields, replace
 * this bridge with the generated type again.
 */

export type AttemptResultDifficulty = "EASY" | "MEDIUM" | "HARD" | "VERY_HARD";

export type AttemptResultMasteryBand =
  | "NO_EVIDENCE"
  | "UNCERTAIN"
  | "WEAK"
  | "DEVELOPING"
  | "STRONG";

export type AttemptResultLesson = {
  id: string;
  lesson_no: number;
  title_fr: string;
  short_title: string;
};

export type AttemptResultAnalysisRow = {
  total: number;
  correct: number;
  incorrect: number;
  accuracy_pct: number | null;
};

export type AttemptResultDifficultyRow = AttemptResultAnalysisRow & {
  difficulty: AttemptResultDifficulty;
};

export type AttemptResultQuestionTypeRow = AttemptResultAnalysisRow & {
  question_type: string;
};

export type AttemptResultSubtopicRow = AttemptResultAnalysisRow & {
  subtopic_id: string;
  subtopic_title_fr: string | null;
  subtopic_title_fa: string | null;
  lesson_id: string | null;
  lesson_no: number | null;
  lesson_title_fr: string | null;
  mastery_before_pct: number | null;
  mastery_after_pct: number;
  mastery_delta_pct: number | null;
  mastery_confidence_after: number;
  mastery_coverage_after: number;
  mastery_band_after: AttemptResultMasteryBand;
  new_evidence: boolean;
};

export type AttemptResultMisconception = {
  id: string;
  family: string;
  name_fa: string | null;
  statement_fa: string;
  subtopic_id: string;
  subtopic_title_fr: string;
  subtopic_title_fa: string | null;
  repeat_count: number;
  last_wrong_at: string;
};

export type AttemptResultMasteryImpact = {
  affected_subtopic_count: number;
  new_evidence_subtopic_count: number;
  improved_subtopic_count: number;
  declined_subtopic_count: number;
  unchanged_subtopic_count: number;
  average_delta_pct: number | null;
};

export type AttemptResultBreakdownItem = {
  test_question_id: string;
  position: number;
  answer_id: string;
  feedback: AnswerFeedback;
  lesson_id: string;
  lesson_no: number | null;
  lesson_title_fr: string | null;
  subtopic_id: string;
  subtopic_title_fr: string | null;
  subtopic_title_fa: string | null;
  question_type: string;
  difficulty: AttemptResultDifficulty;
  response_ms: number | null;
  answered_at: string;
  stem: string;
  stem_locale: string;
  selected_misconception_id: string | null;
};

export type AttemptResultData = {
  attempt_id: string;
  test_id: string;
  status: "COMPLETED";
  mode: string;
  test_title: string | null;
  score_raw: number;
  score_pct: number;
  question_count: number;
  correct_count: number;
  incorrect_count: number;
  accuracy_pct: number;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  average_response_ms: number | null;
  lessons: AttemptResultLesson[];
  difficulty_analysis: AttemptResultDifficultyRow[];
  subtopic_analysis: AttemptResultSubtopicRow[];
  question_type_analysis: AttemptResultQuestionTypeRow[];
  strengths: AttemptResultSubtopicRow[];
  weaknesses: AttemptResultSubtopicRow[];
  misconceptions: AttemptResultMisconception[];
  unmapped_wrong_count: number;
  mastery_impact: AttemptResultMasteryImpact;
  review_item_ids: string[];
  breakdown: AttemptResultBreakdownItem[];
  insights_version: string;
};

export type AttemptResultEnvelope = {
  data: AttemptResultData;
  meta: {
    request_id: string;
    api_version: string;
  };
};

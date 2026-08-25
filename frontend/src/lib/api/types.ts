import type { components, paths } from "./generated";

export type AttemptQuestion = components["schemas"]["AttemptQuestion"];
export type AttemptOption = components["schemas"]["AttemptOption"];
export type AnswerRequest = components["schemas"]["AnswerRequest"];
export type AnswerFeedback = components["schemas"]["AnswerFeedback"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type RegisterRequest = components["schemas"]["RegisterRequest"];
export type TestCreateRequest = components["schemas"]["TestCreateRequest"];

export type NextQuestionEnvelope =
  paths["/attempts/{attemptId}/next"]["get"]["responses"][200]["content"]["application/json"];
export type AnswerReceiptEnvelope =
  paths["/attempts/{attemptId}/answers"]["post"]["responses"][200]["content"]["application/json"];
export type AttemptEnvelope =
  paths["/attempts/{attemptId}/complete"]["post"]["responses"][200]["content"]["application/json"];

type GeneratedAttemptResultEnvelope =
  paths["/attempts/{attemptId}/result"]["get"]["responses"][200]["content"]["application/json"];

type AttemptResultMasteryBand =
  | "NO_EVIDENCE"
  | "UNCERTAIN"
  | "WEAK"
  | "DEVELOPING"
  | "STRONG";

type AttemptResultAnalysisRow = {
  total: number;
  correct: number;
  incorrect: number;
  accuracy_pct: number | null;
};

type AttemptResultSubtopicRow = AttemptResultAnalysisRow & {
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

type AttemptResultRuntimeData = {
  test_id: string;
  mode: string;
  test_title: string | null;
  question_count: number;
  correct_count: number;
  incorrect_count: number;
  accuracy_pct: number;
  started_at: string;
  duration_seconds: number;
  average_response_ms: number | null;
  lessons: Array<{
    id: string;
    lesson_no: number;
    title_fr: string;
    short_title: string;
  }>;
  difficulty_analysis: Array<AttemptResultAnalysisRow & { difficulty: string }>;
  subtopic_analysis: AttemptResultSubtopicRow[];
  question_type_analysis: Array<AttemptResultAnalysisRow & { question_type: string }>;
  strengths: AttemptResultSubtopicRow[];
  weaknesses: AttemptResultSubtopicRow[];
  misconceptions: Array<{
    id: string;
    family: string;
    name_fa: string | null;
    statement_fa: string;
    subtopic_id: string;
    subtopic_title_fr: string;
    subtopic_title_fa: string | null;
    repeat_count: number;
    last_wrong_at: string;
  }>;
  unmapped_wrong_count: number;
  mastery_impact: {
    affected_subtopic_count: number;
    new_evidence_subtopic_count: number;
    improved_subtopic_count: number;
    declined_subtopic_count: number;
    unchanged_subtopic_count: number;
    average_delta_pct: number | null;
  };
  review_item_ids: string[];
  breakdown: Array<{
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
    difficulty: string;
    response_ms: number | null;
    answered_at: string;
    stem: string;
    stem_locale: string;
    selected_misconception_id: string | null;
  }>;
  insights_version: string;
};

/**
 * The Django runtime enriches completed-attempt results with read-only analytics
 * from runtime_attempt_result.py. The Stage 21 generated OpenAPI type still
 * describes the smaller base result, so keep the generated base contract and
 * add the runtime enrichment explicitly until the OpenAPI contract is revised.
 */
export type AttemptResultEnvelope = Omit<GeneratedAttemptResultEnvelope, "data"> & {
  data: Omit<GeneratedAttemptResultEnvelope["data"], "breakdown"> & AttemptResultRuntimeData;
};

export type DashboardEnvelope =
  paths["/dashboard"]["get"]["responses"][200]["content"]["application/json"];
export type NextActionEnvelope =
  paths["/next-actions/current"]["get"]["responses"][200]["content"]["application/json"];
export type LessonCollectionEnvelope =
  paths["/lessons"]["get"]["responses"][200]["content"]["application/json"];
export type ReviewCollectionEnvelope =
  paths["/reviews"]["get"]["responses"][200]["content"]["application/json"];
export type TestEnvelope =
  paths["/tests"]["post"]["responses"][201]["content"]["application/json"];
export type StartedAttemptEnvelope =
  paths["/tests/{testId}/attempts"]["post"]["responses"][201]["content"]["application/json"];

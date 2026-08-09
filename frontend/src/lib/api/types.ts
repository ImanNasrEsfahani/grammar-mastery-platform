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
export type AttemptResultEnvelope =
  paths["/attempts/{attemptId}/result"]["get"]["responses"][200]["content"]["application/json"];
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

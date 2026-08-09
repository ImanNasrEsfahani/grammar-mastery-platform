import type { ErrorResponse } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string[]>;
  readonly requestId: string;
  readonly retryAfter: string | null;

  constructor({
    status,
    code,
    message,
    fields = {},
    requestId = "client-network-error",
    retryAfter = null,
  }: {
    status: number;
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    requestId?: string;
    retryAfter?: string | null;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as {error?: unknown}).error;
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error && typeof (error as {code: unknown}).code === "string" &&
    "message" in error && typeof (error as {message: unknown}).message === "string" &&
    "request_id" in error && typeof (error as {request_id: unknown}).request_id === "string",
  );
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  if (!path.startsWith("/")) throw new Error("API path must be same-origin and absolute.");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Request-ID", headers.get("X-Request-ID") ?? crypto.randomUUID());
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(path, {...init, headers, cache: "no-store"});
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "The service could not be reached.",
    });
  }

  if (response.status === 204) return null;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isErrorResponse(payload)) {
      throw new ApiError({
        status: response.status,
        code: payload.error.code,
        message: payload.error.message,
        fields: payload.error.fields,
        requestId: payload.error.request_id,
        retryAfter: response.headers.get("Retry-After"),
      });
    }
    throw new ApiError({
      status: response.status,
      code: "INVALID_ERROR_RESPONSE",
      message: "The server returned an unreadable error.",
      requestId: response.headers.get("X-Request-ID") ?? "missing-request-id",
    });
  }
  return payload as T;
}

export function isTransient(error: unknown): error is ApiError {
  return error instanceof ApiError && [0, 429, 502, 503, 504].includes(error.status);
}

import { describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./client";

describe("apiRequest", () => {
  it("normalizes the frozen Stage 21 error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {code: "VALIDATION_ERROR", message: "Invalid answer", fields: {selected_option_id: ["Unknown option"]}, request_id: "request-error-123"},
    }), {status: 422, headers: {"Content-Type": "application/json"}})));

    await expect(apiRequest("/api/backend/attempts/example/answers", {method: "POST", body: "{}"})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      requestId: "request-error-123",
    } satisfies Partial<ApiError>);
  });

  it("rejects cross-origin or relative API paths", async () => {
    await expect(apiRequest("https://evil.example/api")).rejects.toThrow("same-origin");
  });

  it("maps fetch failure to a retryable network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(apiRequest("/api/backend/dashboard")).rejects.toMatchObject({status: 0, code: "NETWORK_ERROR"});
  });
});

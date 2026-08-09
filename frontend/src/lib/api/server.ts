import type { NextRequest } from "next/server";

const DEFAULT_API_BASE = "http://127.0.0.1:8000/api/v1";
const FORWARDED_REQUEST_HEADERS = ["accept", "accept-language", "content-type", "idempotency-key", "x-request-id"] as const;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "x-request-id", "retry-after", "idempotent-replayed"] as const;

export function djangoApiBaseUrl(): URL {
  const configured = process.env.DJANGO_API_BASE_URL ?? DEFAULT_API_BASE;
  const url = new URL(configured);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function backendUrl(pathSegments: string[], search = ""): URL {
  const base = djangoApiBaseUrl();
  const safePath = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(safePath, base);
  url.search = search;
  return url;
}

export function upstreamHeaders(request: NextRequest, token?: string): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Accept", headers.get("Accept") ?? "application/json");
  headers.set("X-Request-ID", headers.get("X-Request-ID") ?? crypto.randomUUID());
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export function clientResponseHeaders(upstream: Response): Headers {
  const headers = new Headers({"Cache-Control": "no-store"});
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export function unavailableResponse(requestId: string): Response {
  return Response.json(
    {
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "The learning service is temporarily unavailable.",
        fields: {},
        request_id: requestId,
      },
    },
    {status: 503, headers: {"Cache-Control": "no-store", "X-Request-ID": requestId}},
  );
}

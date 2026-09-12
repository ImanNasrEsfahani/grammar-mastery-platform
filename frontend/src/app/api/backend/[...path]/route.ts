import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { backendUrl, clientResponseHeaders, unavailableResponse, upstreamHeaders } from "@/lib/api/server";

const methodsWithNoBody = new Set(["GET", "HEAD"]);
const UPSTREAM_TIMEOUT_MS = 35_000;

function upstreamTimeoutResponse(requestId: string): Response {
  return Response.json(
    {
      error: {
        code: "UPSTREAM_TIMEOUT",
        message: "The learning service took too long to respond. Please retry.",
        fields: {},
        request_id: requestId,
      },
    },
    {
      status: 504,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
        "Retry-After": "2",
      },
    },
  );
}

async function proxy(request: NextRequest, context: {params: Promise<{path: string[]}>}) {
  const {path} = await context.params;
  const token = (await cookies()).get("gmp_access_token")?.value;
  const headers = upstreamHeaders(request, token);
  const requestId = headers.get("X-Request-ID") ?? crypto.randomUUID();
  const body = methodsWithNoBody.has(request.method) ? undefined : await request.arrayBuffer();
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(backendUrl(path, request.nextUrl.search), {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
    const responseBody = upstream.status === 204 ? null : await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      headers: clientResponseHeaders(upstream),
    });
  } catch (caught) {
    if (controller.signal.aborted) return upstreamTimeoutResponse(requestId);
    return unavailableResponse(requestId);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

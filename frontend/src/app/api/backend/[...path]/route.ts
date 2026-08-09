import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { backendUrl, clientResponseHeaders, unavailableResponse, upstreamHeaders } from "@/lib/api/server";

const methodsWithNoBody = new Set(["GET", "HEAD"]);

async function proxy(request: NextRequest, context: {params: Promise<{path: string[]}>}) {
  const {path} = await context.params;
  const token = (await cookies()).get("gmp_access_token")?.value;
  const headers = upstreamHeaders(request, token);
  const requestId = headers.get("X-Request-ID") ?? crypto.randomUUID();
  const body = methodsWithNoBody.has(request.method) ? undefined : await request.arrayBuffer();

  try {
    const upstream = await fetch(backendUrl(path, request.nextUrl.search), {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
    });
    const responseBody = upstream.status === 204 ? null : await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      headers: clientResponseHeaders(upstream),
    });
  } catch {
    return unavailableResponse(requestId);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

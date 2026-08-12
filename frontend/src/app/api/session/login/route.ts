import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { backendUrl, clientResponseHeaders, unavailableResponse, upstreamHeaders } from "@/lib/api/server";
import type { components } from "@/lib/api/generated";
import { sessionCookieIsSecure } from "@/lib/auth/session-cookie";

type AuthTokenEnvelope = components["schemas"]["AuthTokenEnvelope"];

export async function POST(request: NextRequest) {
  const headers = upstreamHeaders(request);
  const requestId = headers.get("X-Request-ID") ?? crypto.randomUUID();
  let upstream: Response;
  try {
    upstream = await fetch(backendUrl(["auth", "login"]), {
      method: "POST",
      headers,
      body: await request.arrayBuffer(),
      cache: "no-store",
    });
  } catch {
    return unavailableResponse(requestId);
  }

  if (!upstream.ok) {
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: clientResponseHeaders(upstream),
    });
  }

  const payload = (await upstream.json()) as AuthTokenEnvelope;
  const response = NextResponse.json(
    {data: {authenticated: true, expires_in: payload.data.expires_in}, meta: payload.meta},
    {headers: {"Cache-Control": "no-store", "X-Request-ID": requestId}},
  );
  response.cookies.set("gmp_access_token", payload.data.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieIsSecure(request),
    path: "/",
    maxAge: payload.data.expires_in,
  });

  return response;
}

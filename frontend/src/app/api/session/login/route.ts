import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {backendUrl, clientResponseHeaders, unavailableResponse, upstreamHeaders} from "@/lib/api/server";
import type {components} from "@/lib/api/generated";
import {sessionCookieIsSecure} from "@/lib/auth/session-cookie";

type AuthTokenEnvelope = components["schemas"]["AuthTokenEnvelope"];

type SessionLoginBody = {
  email?: unknown;
  password?: unknown;
  remember_me?: unknown;
  [key: string]: unknown;
};

function extractRememberPreference(rawBody: string): {rememberMe: boolean; upstreamBody: string} {
  if (!rawBody) return {rememberMe: false, upstreamBody: rawBody};
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {rememberMe: false, upstreamBody: rawBody};
    }
    const body = {...(parsed as SessionLoginBody)};
    const rememberMe = body.remember_me === true;
    delete body.remember_me;
    return {rememberMe, upstreamBody: JSON.stringify(body)};
  } catch {
    return {rememberMe: false, upstreamBody: rawBody};
  }
}

export async function POST(request: NextRequest) {
  const headers = upstreamHeaders(request);
  const requestId = headers.get("X-Request-ID") ?? crypto.randomUUID();
  const {rememberMe, upstreamBody} = extractRememberPreference(await request.text());
  let upstream: Response;
  try {
    upstream = await fetch(backendUrl(["auth", "login"]), {
      method: "POST",
      headers,
      body: upstreamBody,
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
  const baseCookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: sessionCookieIsSecure(request),
    path: "/",
  };
  if (rememberMe) {
    response.cookies.set("gmp_access_token", payload.data.access_token, {
      ...baseCookie,
      maxAge: payload.data.expires_in,
    });
  } else {
    // Session cookie: closing the browser forgets the login, while the server-side
    // token keeps its existing security TTL and revocation semantics unchanged.
    response.cookies.set("gmp_access_token", payload.data.access_token, baseCookie);
  }

  return response;
}

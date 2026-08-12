import type {NextRequest} from "next/server";
import {cookies} from "next/headers";
import {backendUrl, clientResponseHeaders, unavailableResponse, upstreamHeaders} from "@/lib/api/server";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("gmp_access_token")?.value;

  // Local logout must always invalidate the browser session first, even if the
  // backend is temporarily unavailable. The upstream logout is still attempted
  // to revoke/close the server-side session when possible.
  cookieStore.delete("gmp_access_token");

  const headers = upstreamHeaders(request, token);
  const requestId = headers.get("X-Request-ID") ?? crypto.randomUUID();

  if (!token) {
    return new Response(null, {
      status: 204,
      headers: {"Cache-Control": "no-store", "X-Request-ID": requestId},
    });
  }

  try {
    const upstream = await fetch(backendUrl(["auth", "logout"]), {
      method: "POST",
      headers,
      cache: "no-store",
    });
    if (!upstream.ok && upstream.status !== 401) {
      return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers: clientResponseHeaders(upstream),
      });
    }
  } catch {
    return unavailableResponse(requestId);
  }

  return new Response(null, {
    status: 204,
    headers: {"Cache-Control": "no-store", "X-Request-ID": requestId},
  });
}

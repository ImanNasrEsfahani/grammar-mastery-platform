import {NextResponse} from "next/server";
import type {NextRequest} from "next/server";

const PROTECTED_SECTIONS = new Set([
  "dashboard",
  "tests",
  "review",
  "lessons",
  "attempts",
  "history",
  "profile",
  "progress",
  "settings",
  "notifications",
]);

/**
 * Reads only the JWT expiry claim so the UI can decide whether a stale browser
 * cookie should be treated as authenticated.
 *
 * This is deliberately NOT an authorization/security verification. The Django
 * backend still verifies the signature, session state, user state and roles on
 * every authenticated API request. Here we only prevent an expired token that
 * is still present in a session cookie from letting the user into a protected
 * page shell and then showing a 401 error.
 */
function accessTokenIsUsable(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return false;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {exp?: unknown};

    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return false;

    // Small clock-skew buffer avoids allowing a token that will expire while
    // the protected page is starting its first API request.
    const nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp > nowSeconds + 5;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const parts = request.nextUrl.pathname.split("/").filter(Boolean);
  const [locale, section] = parts;

  if ((locale !== "fa" && locale !== "en") || !section || !PROTECTED_SECTIONS.has(section)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("gmp_access_token")?.value;
  if (token && accessTokenIsUsable(token)) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = `/${locale}/login`;
  loginUrl.search = "";

  const response = NextResponse.redirect(loginUrl);

  // If an expired/malformed token is still stored as a browser session cookie,
  // remove it while redirecting so subsequent requests start from a clean state.
  if (token) response.cookies.delete("gmp_access_token");

  return response;
}

export const config = {
  matcher: ["/fa/:path*", "/en/:path*"],
};

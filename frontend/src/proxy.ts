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
]);

export function proxy(request: NextRequest) {
  const parts = request.nextUrl.pathname.split("/").filter(Boolean);
  const [locale, section] = parts;

  if ((locale !== "fa" && locale !== "en") || !section || !PROTECTED_SECTIONS.has(section)) {
    return NextResponse.next();
  }

  const authenticated = Boolean(request.cookies.get("gmp_access_token")?.value);
  if (authenticated) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = `/${locale}/login`;
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/fa/:path*", "/en/:path*"],
};

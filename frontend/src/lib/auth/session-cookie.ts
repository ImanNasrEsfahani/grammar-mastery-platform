type SessionCookieRequest = {
  nextUrl: {protocol: string};
  headers: {get(name: string): string | null};
};

export function sessionCookieIsSecure(request: SessionCookieRequest): boolean {
  const override = process.env.GMP_SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (["1", "true", "yes"].includes(override ?? "")) return true;
  if (["0", "false", "no"].includes(override ?? "")) return false;

  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();

  if (forwardedProtocol) return forwardedProtocol === "https";
  return request.nextUrl.protocol === "https:";
}

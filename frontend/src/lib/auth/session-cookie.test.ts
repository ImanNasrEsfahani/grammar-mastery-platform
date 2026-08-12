import {afterEach, describe, expect, it} from "vitest";
import {sessionCookieIsSecure} from "./session-cookie";

function request(protocol: string, forwardedProtocol: string | null = null) {
  return {
    nextUrl: {protocol},
    headers: new Headers(forwardedProtocol ? {"x-forwarded-proto": forwardedProtocol} : undefined),
  };
}

describe("sessionCookieIsSecure", () => {
  afterEach(() => {
    delete process.env.GMP_SESSION_COOKIE_SECURE;
  });

  it("allows the session cookie on local HTTP even in a production build", () => {
    expect(sessionCookieIsSecure(request("http:"))).toBe(false);
  });

  it("keeps the session cookie secure for direct or proxied HTTPS", () => {
    expect(sessionCookieIsSecure(request("https:"))).toBe(true);
    expect(sessionCookieIsSecure(request("http:", "https"))).toBe(true);
  });

  it("supports an explicit deployment override", () => {
    process.env.GMP_SESSION_COOKIE_SECURE = "false";
    expect(sessionCookieIsSecure(request("https:"))).toBe(false);

    process.env.GMP_SESSION_COOKIE_SECURE = "true";
    expect(sessionCookieIsSecure(request("http:"))).toBe(true);
  });
});

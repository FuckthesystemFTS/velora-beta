import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";

const csp = [
  "default-src 'self'",
  "img-src 'self' data: https://res.cloudinary.com https://images.unsplash.com",
  "media-src 'self' https://res.cloudinary.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://api.cloudinary.com",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
].join("; ");

export function proxy(request: NextRequest) {
  const canonicalUrl = new URL(env.APP_URL);
  const requestHost = request.headers.get("host");
  const pathname = request.nextUrl.pathname;

  if (
    env.NODE_ENV === "production" &&
    requestHost &&
    request.method !== "POST" &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/.well-known") &&
    requestHost !== canonicalUrl.host
  ) {
    const redirectUrl = new URL(request.nextUrl);
    redirectUrl.protocol = canonicalUrl.protocol;
    redirectUrl.host = canonicalUrl.host;
    return NextResponse.redirect(redirectUrl, 301);
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-site");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  if (request.nextUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/team") || pathname.startsWith("/moderation")) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

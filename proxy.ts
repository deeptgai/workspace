import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATH_PREFIXES = [
  "/s/",
  "/share/snapshots/",
  "/api/s/",
  "/api/telegram/",
  "/media/",
  "/_next/",
];

const PUBLIC_PATHS = new Set([
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="DeepTG"',
    },
  });
}

function authUnavailable() {
  return new NextResponse("Admin auth is not configured", {
    status: 503,
  });
}

export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    return process.env.NODE_ENV === "development" ? NextResponse.next() : authUnavailable();
  }

  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Basic ")) {
    return unauthorized();
  }

  let credentials = "";

  try {
    credentials = atob(authHeader.slice("Basic ".length));
  } catch {
    return unauthorized();
  }

  const separatorIndex = credentials.indexOf(":");

  if (separatorIndex === -1) {
    return unauthorized();
  }

  const providedUsername = credentials.slice(0, separatorIndex);
  const providedPassword = credentials.slice(separatorIndex + 1);

  if (providedUsername !== username || providedPassword !== password) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
};

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./app/lib/auth";

const publicPaths = new Set(["/login", "/api/auth/login"]);

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAuthenticated = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (path === "/login" && isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (publicPaths.has(path)) return NextResponse.next();
  if (isAuthenticated) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return NextResponse.json(
      { error: "認証が必要です。" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", path);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192x192.png|icon-512x512.png|apple-icon.png|manifest.webmanifest|og.png|sw.js).*)"],
};

import { NextResponse } from "next/server";
import { sessionCookieOptions } from "../../../lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json(
    { authenticated: false },
    { headers: { "Cache-Control": "private, no-store" } },
  );
  response.cookies.set({ ...sessionCookieOptions(), value: "", maxAge: 0 });
  return response;
}

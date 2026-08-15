import { NextResponse, type NextRequest } from "next/server";
import { createSessionToken, sessionCookieOptions, verifyPassword } from "../../../lib/auth";
import { canAttemptLogin, clearLoginAttempts, loginRateLimitKey, recordFailedLogin } from "../../../lib/login-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}

export async function POST(request: NextRequest) {
  if (!process.env.APP_PASSWORD_HASH || !process.env.SESSION_SECRET) {
    return json({ error: "ログイン設定が完了していません。" }, 503);
  }

  const key = loginRateLimitKey(request);
  const limit = canAttemptLogin(key);
  if (!limit.allowed) {
    return json(
      { error: "試行回数が多すぎます。時間を置いて再試行してください。" },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    return json({ error: "入力を確認してください。" }, 400);
  }

  if (!await verifyPassword(password)) {
    recordFailedLogin(key);
    return json({ error: "パスワードが違います。" }, 401);
  }

  clearLoginAttempts(key);
  const response = json({ authenticated: true });
  response.cookies.set({ ...sessionCookieOptions(), value: await createSessionToken() });
  return response;
}

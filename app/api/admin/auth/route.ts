import { NextResponse, type NextRequest } from "next/server";
import {
  adminSessionCookieOptions,
  createAdminSessionToken,
  verifyPassword,
} from "../../../lib/auth";
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
  if (!process.env.ADMIN_PASSWORD_HASH || !process.env.SESSION_SECRET) {
    return json({ error: "個人資産の管理者パスワードが設定されていません。" }, 503);
  }

  const key = `admin:${loginRateLimitKey(request)}`;
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

  if (!await verifyPassword(password, process.env.ADMIN_PASSWORD_HASH)) {
    recordFailedLogin(key);
    return json({ error: "個人資産用パスワードが違います。" }, 401);
  }

  clearLoginAttempts(key);
  const response = json({ authenticated: true });
  response.cookies.set({ ...adminSessionCookieOptions(), value: await createAdminSessionToken() });
  return response;
}

export async function DELETE() {
  const response = json({ authenticated: false });
  response.cookies.set({ ...adminSessionCookieOptions(), value: "", maxAge: 0 });
  return response;
}

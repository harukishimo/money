import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/auth";
import {
  readPersonalAssets,
  SheetsConfigurationError,
  SheetsConflictError,
  writePersonalAssets,
} from "../../../lib/sheets";
import {
  createDefaultPersonalAssetsState,
  parsePersonalAssetsState,
} from "../../../lib/personal-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function authenticated(request: NextRequest) {
  return verifyAdminSessionToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}

function handleError(error: unknown) {
  if (error instanceof SheetsConfigurationError) {
    return json({ error: "Google Sheetsの環境変数が設定されていません。" }, 503);
  }
  if (error instanceof SheetsConflictError) {
    return json({ error: "個人資産が別の端末で更新されています。再読み込みしてください。", code: "revision_conflict" }, 409);
  }
  return json({ error: "個人資産データの保存・読込に失敗しました。" }, 502);
}

export async function GET(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "個人資産用の認証が必要です。" }, 401);
  try {
    const envelope = await readPersonalAssets();
    return json({
      state: envelope?.state ?? createDefaultPersonalAssetsState(),
      revision: envelope?.revision ?? null,
      updatedAt: envelope?.updatedAt ?? null,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "個人資産用の認証が必要です。" }, 401);
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 500_000) return json({ error: "個人資産データが大きすぎます。" }, 413);
    let body: { state?: unknown; expectedRevision?: unknown };
    try {
      body = JSON.parse(rawBody) as { state?: unknown; expectedRevision?: unknown };
    } catch {
      return json({ error: "保存内容がJSONではありません。" }, 400);
    }
    const state = parsePersonalAssetsState(body.state);
    const expectedRevision = body.expectedRevision === null || typeof body.expectedRevision === "string"
      ? body.expectedRevision
      : undefined;
    if (!state || expectedRevision === undefined) return json({ error: "個人資産の保存内容が不正です。" }, 400);
    const saved = await writePersonalAssets(state, expectedRevision);
    return json({ state: saved.state, revision: saved.revision, updatedAt: saved.updatedAt });
  } catch (error) {
    return handleError(error);
  }
}

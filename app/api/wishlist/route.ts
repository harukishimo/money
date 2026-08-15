import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "../../lib/auth";
import {
  readWishlist,
  SheetsConfigurationError,
  SheetsConflictError,
  writeWishlist,
} from "../../lib/sheets";
import { parseWishlistItems } from "../../lib/wishlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function handleError(error: unknown) {
  if (error instanceof SheetsConfigurationError) {
    return json({ error: "Google Sheetsの環境変数が設定されていません。" }, 503);
  }
  if (error instanceof SheetsConflictError) {
    return json({ error: "欲しいものリストが別の端末で更新されています。再読み込みしてください。", code: "revision_conflict" }, 409);
  }
  return json({ error: "欲しいものリストの保存に失敗しました。" }, 502);
}

async function authenticated(request: NextRequest) {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "認証が必要です。" }, 401);
  try {
    const wishlist = await readWishlist();
    return json(wishlist);
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "認証が必要です。" }, 401);
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 500_000) return json({ error: "欲しいものリストが大きすぎます。" }, 413);
    let body: { items?: unknown; expectedRevision?: unknown };
    try {
      body = JSON.parse(rawBody) as { items?: unknown; expectedRevision?: unknown };
    } catch {
      return json({ error: "保存内容がJSONではありません。" }, 400);
    }
    const items = parseWishlistItems(body.items);
    const expectedRevision = body.expectedRevision === null || typeof body.expectedRevision === "string"
      ? body.expectedRevision
      : undefined;
    if (!items || expectedRevision === undefined) return json({ error: "欲しいものリストの保存内容が不正です。" }, 400);
    const saved = await writeWishlist(items, expectedRevision);
    return json({ revision: saved.revision, updatedAt: saved.updatedAt, items: saved.items });
  } catch (error) {
    return handleError(error);
  }
}

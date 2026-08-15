import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "../../lib/auth";
import {
  deleteHouseholdState,
  readHouseholdState,
  SheetsConfigurationError,
  SheetsConflictError,
  writeHouseholdState,
} from "../../lib/sheets";
import { closingMonthKey, isMonthKey, parseHouseholdState } from "../../lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function authenticated(request: NextRequest) {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

function requestedMonth(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("month");
  if (value === null) return closingMonthKey();
  return isMonthKey(value) ? value : null;
}

function handleError(error: unknown) {
  if (error instanceof SheetsConfigurationError) {
    return json({ error: "Google Sheetsの環境変数が設定されていません。" }, 503);
  }
  if (error instanceof SheetsConflictError) {
    return json({ error: "別の端末で更新されています。再読み込みしてください。", code: "revision_conflict" }, 409);
  }
  return json({ error: "Google Sheetsとの通信に失敗しました。" }, 502);
}

export async function GET(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "認証が必要です。" }, 401);
  const monthKey = requestedMonth(request);
  if (!monthKey) return json({ error: "monthはYYYY-MM形式で指定してください。" }, 400);
  try {
    let envelope = await readHouseholdState(monthKey);
    let source: "month" | "legacy" = "month";
    if (!envelope && monthKey === closingMonthKey()) {
      envelope = await readHouseholdState();
      source = envelope ? "legacy" : "month";
    }
    if (!envelope) return json({ state: null, revision: null, updatedAt: null, monthKey, source });
    const state = parseHouseholdState(envelope.state);
    if (!state) return json({ error: "保存データの形式が不正です。" }, 502);
    return json({
      state,
      revision: source === "legacy" ? null : envelope.revision,
      updatedAt: envelope.updatedAt,
      closedAt: envelope.closedAt ?? null,
      monthKey,
      source,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "認証が必要です。" }, 401);
  const monthKey = requestedMonth(request);
  if (!monthKey) return json({ error: "monthはYYYY-MM形式で指定してください。" }, 400);
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 4_000_000) return json({ error: "保存データが大きすぎます。" }, 413);
    let body: { state?: unknown; expectedRevision?: unknown; closedAt?: unknown };
    try {
      body = JSON.parse(rawBody) as { state?: unknown; expectedRevision?: unknown };
    } catch {
      return json({ error: "保存内容がJSONではありません。" }, 400);
    }
    const state = parseHouseholdState(body.state);
    const expectedRevision = body.expectedRevision === null || typeof body.expectedRevision === "string"
      ? body.expectedRevision
      : undefined;
    const closedAt = body.closedAt === null || typeof body.closedAt === "string" ? body.closedAt : undefined;
    if (!state || expectedRevision === undefined || (body.closedAt !== undefined && closedAt === undefined)) {
      return json({ error: "保存内容が不正です。" }, 400);
    }
    const envelope = await writeHouseholdState(state, expectedRevision, monthKey, closedAt);
    return json({ revision: envelope.revision, updatedAt: envelope.updatedAt, closedAt: envelope.closedAt ?? null, monthKey });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "認証が必要です。" }, 401);
  const monthKey = requestedMonth(request);
  if (!monthKey) return json({ error: "monthはYYYY-MM形式で指定してください。" }, 400);
  try {
    const body = await request.json() as { expectedRevision?: unknown };
    const expectedRevision = body.expectedRevision === null || typeof body.expectedRevision === "string"
      ? body.expectedRevision
      : undefined;
    if (expectedRevision === undefined) return json({ error: "revisionが必要です。" }, 400);
    await deleteHouseholdState(expectedRevision, monthKey);
    return json({ deleted: true, monthKey });
  } catch (error) {
    return handleError(error);
  }
}

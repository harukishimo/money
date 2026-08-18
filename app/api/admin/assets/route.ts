import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/auth";
import { closingMonthKey, isMonthKey } from "../../../lib/state";
import {
  readLegacyPersonalAssets,
  readPersonalAssets,
  readPersonalAssetMonthKeys,
  SheetsConfigurationError,
  SheetsConflictError,
  writePersonalAssets,
} from "../../../lib/sheets";
import {
  createDefaultPersonalAssetsState,
  parsePersonalAssetsState,
  parsePersonalCalculationSnapshot,
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
    return json({ error: "個人資産が別の端末で更新されています。再読み込みしてください。", code: "revision_conflict" }, 409);
  }
  return json({ error: "個人資産データの保存・読込に失敗しました。" }, 502);
}

export async function GET(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "個人資産用の認証が必要です。" }, 401);
  const monthKey = requestedMonth(request);
  if (!monthKey) return json({ error: "monthはYYYY-MM形式で指定してください。" }, 400);
  try {
    const monthlyEnvelope = await readPersonalAssets(monthKey);
    const legacyEnvelope = monthlyEnvelope || monthKey !== closingMonthKey() ? null : await readLegacyPersonalAssets();
    const envelope = monthlyEnvelope ?? legacyEnvelope;
    return json({
      state: envelope?.state ?? createDefaultPersonalAssetsState(),
      revision: monthlyEnvelope?.revision ?? null,
      updatedAt: envelope?.updatedAt ?? null,
      calculation: envelope?.calculation ?? null,
      monthKey,
      source: monthlyEnvelope ? "month" : legacyEnvelope ? "legacy" : "empty",
      months: await readPersonalAssetMonthKeys(),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest) {
  if (!await authenticated(request)) return json({ error: "個人資産用の認証が必要です。" }, 401);
  const monthKey = requestedMonth(request);
  if (!monthKey) return json({ error: "monthはYYYY-MM形式で指定してください。" }, 400);
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 500_000) return json({ error: "個人資産データが大きすぎます。" }, 413);
    let body: { state?: unknown; expectedRevision?: unknown; calculation?: unknown };
    try {
      body = JSON.parse(rawBody) as { state?: unknown; expectedRevision?: unknown; calculation?: unknown };
    } catch {
      return json({ error: "保存内容がJSONではありません。" }, 400);
    }
    const state = parsePersonalAssetsState(body.state);
    const expectedRevision = body.expectedRevision === null || typeof body.expectedRevision === "string"
      ? body.expectedRevision
      : undefined;
    const calculation = parsePersonalCalculationSnapshot(body.calculation);
    if (!state || expectedRevision === undefined || !calculation || calculation.monthKey !== monthKey) {
      return json({ error: "個人資産の保存内容が不正です。" }, 400);
    }
    const saved = await writePersonalAssets(state, monthKey, calculation, expectedRevision);
    return json({ state: saved.state, revision: saved.revision, updatedAt: saved.updatedAt, monthKey, calculation: saved.calculation });
  } catch (error) {
    return handleError(error);
  }
}

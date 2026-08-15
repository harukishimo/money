import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "../../lib/auth";
import { buildHistoryEntry } from "../../lib/history";
import {
  readHouseholdHistory,
  SheetsConfigurationError,
} from "../../lib/sheets";
import { parseHouseholdState } from "../../lib/state";

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
  return json({ error: "Google Sheetsとの通信に失敗しました。" }, 502);
}

export async function GET(request: NextRequest) {
  if (!await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return json({ error: "認証が必要です。" }, 401);
  }
  try {
    const envelopes = await readHouseholdHistory();
    const entries = envelopes.flatMap((envelope) => {
      const state = parseHouseholdState(envelope.state);
      const entry = state ? buildHistoryEntry(envelope, state) : null;
      return entry ? [entry] : [];
    });
    return json({ entries });
  } catch (error) {
    return handleError(error);
  }
}

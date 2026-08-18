import { randomUUID } from "node:crypto";
import { google, type sheets_v4 } from "googleapis";
import { closingMonthKey, isMonthKey, type HouseholdState } from "./state.ts";
import {
  parsePersonalAssetsState,
  parsePersonalCalculationSnapshot,
  parsePersonalInvestments,
  parsePersonalReserveTarget,
  type PersonalAssetsState,
  type PersonalInvestment,
  type PersonalCalculationSnapshot,
} from "./personal-assets.ts";
import { parseWishlistItems, type WishlistItem } from "./wishlist.ts";

const LEGACY_SHEET_NAME = "app_state";
const MONTHLY_SHEET_PREFIX = "state_";
const WISHLIST_SHEET_NAME = "wishlist";
const PERSONAL_ASSETS_SHEET_NAME = "personal_assets";
const PERSONAL_ASSETS_SHEET_PREFIX = "personal_assets_";
const PERSONAL_SETTINGS_SHEET_NAME = "personal_settings";
const PERSONAL_SETTINGS_KEY = "personal_settings";
const STATE_KEY = "household";
const WISHLIST_META_KEY = "__meta__";
const CHUNK_SIZE = 30_000;
const HEADER = ["key", "chunk_index", "payload_chunk", "updated_at", "revision"];
const WISHLIST_HEADER = ["id", "name", "category", "amount", "url", "updated_at", "revision"];

export class SheetsConfigurationError extends Error {}
export class SheetsConflictError extends Error {}

export interface StateEnvelope {
  version: 1 | 2;
  monthKey?: string;
  closedAt?: string | null;
  revision: string;
  updatedAt: string;
  state: HouseholdState;
}

export interface WishlistEnvelope {
  version: 1;
  revision: string | null;
  updatedAt: string | null;
  items: WishlistItem[];
}

export interface PersonalAssetsEnvelope {
  version: 1;
  monthKey?: string;
  revision: string;
  updatedAt: string;
  state: PersonalAssetsState;
  calculation: PersonalCalculationSnapshot | null;
}

export interface PersonalSettingsEnvelope {
  version: 1;
  revision: string;
  updatedAt: string;
  reserveTarget: number;
  investments?: PersonalInvestment[];
}

let cachedService: sheets_v4.Sheets | null = null;

export function splitPayload(payload: string, chunkSize = CHUNK_SIZE) {
  if (chunkSize < 1) throw new Error("chunkSize must be positive.");
  const chunks: string[] = [];
  for (let index = 0; index < payload.length; index += chunkSize) {
    chunks.push(payload.slice(index, index + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}

export function monthlySheetName(monthKey: string) {
  if (!isMonthKey(monthKey)) throw new Error("Invalid month key.");
  return `${MONTHLY_SHEET_PREFIX}${monthKey}`;
}

export function personalAssetsSheetName(monthKey: string) {
  if (!isMonthKey(monthKey)) throw new Error("Invalid month key.");
  return `${PERSONAL_ASSETS_SHEET_PREFIX}${monthKey}`;
}

export function personalSettingsSheetName() {
  return PERSONAL_SETTINGS_SHEET_NAME;
}

export function joinPayloadRows(rows: unknown[][], key = STATE_KEY) {
  const chunks = rows
    .filter((row) => row[0] === key)
    .map((row) => ({ index: Number(row[1]), value: String(row[2] ?? "") }))
    .filter((row) => Number.isInteger(row.index) && row.index >= 0)
    .sort((left, right) => left.index - right.index);

  if (chunks.length === 0 || chunks.some((chunk, index) => chunk.index !== index)) return null;
  return chunks.map((chunk) => chunk.value).join("");
}

export function serviceAccountCredentialsFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  const clientEmail = environment.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = environment.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    .trim();
  if (!clientEmail || !privateKey) {
    throw new SheetsConfigurationError("Google Sheets credentials are not configured.");
  }
  if (!clientEmail.includes("@") || !privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new SheetsConfigurationError("Google Sheets credentials are invalid.");
  }
  return { client_email: clientEmail, private_key: privateKey };
}

function spreadsheetId() {
  const value = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!value) throw new SheetsConfigurationError("Google Sheets spreadsheet ID is not configured.");
  return value;
}

function sheetsService() {
  if (cachedService) return cachedService;
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountCredentialsFromEnvironment(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cachedService = google.sheets({ version: "v4", auth });
  return cachedService;
}

async function ensureStateSheet(service: sheets_v4.Sheets, id: string, sheetName: string) {
  const metadata = await service.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  const exists = metadata.data.sheets?.some((sheet) => sheet.properties?.title === sheetName);
  if (!exists) {
    try {
      await service.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.toLowerCase().includes("already exists")) throw error;
    }
  }

  await service.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${sheetName}'!A1:E1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}

async function ensureWishlistSheet(service: sheets_v4.Sheets, id: string) {
  const metadata = await service.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  const exists = metadata.data.sheets?.some((sheet) => sheet.properties?.title === WISHLIST_SHEET_NAME);
  if (!exists) {
    try {
      await service.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: [{ addSheet: { properties: { title: WISHLIST_SHEET_NAME } } }] },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.toLowerCase().includes("already exists")) throw error;
    }
  }

  await service.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${WISHLIST_SHEET_NAME}'!A1:G1`,
    valueInputOption: "RAW",
    requestBody: { values: [WISHLIST_HEADER] },
  });
}

function parseStatePayload(payload: string) {
  const parsed = JSON.parse(payload) as StateEnvelope;
  if ((parsed.version !== 1 && parsed.version !== 2)
    || typeof parsed.revision !== "string"
    || typeof parsed.updatedAt !== "string"
    || (parsed.closedAt !== undefined && parsed.closedAt !== null && typeof parsed.closedAt !== "string")
    || (parsed.version === 2 && !isMonthKey(parsed.monthKey))) {
    throw new Error("Stored state has an unsupported format.");
  }
  return parsed;
}

async function readStatePayloadFromSheet(service: sheets_v4.Sheets, id: string, sheetName: string) {
  const response = await service.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${sheetName}'!A2:E`,
  });
  const rows = response.data.values ?? [];
  const payload = joinPayloadRows(rows);
  if (payload === null) return null;
  return parseStatePayload(payload);
}

async function readStateFromSheet(service: sheets_v4.Sheets, id: string, sheetName: string) {
  await ensureStateSheet(service, id, sheetName);
  return readStatePayloadFromSheet(service, id, sheetName);
}

export async function readHouseholdState(monthKey?: string): Promise<StateEnvelope | null> {
  const service = sheetsService();
  const id = spreadsheetId();
  return readStateFromSheet(service, id, monthKey ? monthlySheetName(monthKey) : LEGACY_SHEET_NAME);
}

export async function readHouseholdHistory(): Promise<StateEnvelope[]> {
  const service = sheetsService();
  const id = spreadsheetId();
  const metadata = await service.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  const sheetNames = (metadata.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => typeof title === "string"
      && title.startsWith(MONTHLY_SHEET_PREFIX)
      && isMonthKey(title.slice(MONTHLY_SHEET_PREFIX.length)));
  const envelopes = await Promise.all(sheetNames.map((sheetName) => readStatePayloadFromSheet(service, id, sheetName)));
  return envelopes
    .filter((envelope): envelope is StateEnvelope => Boolean(envelope?.closedAt && envelope.monthKey))
    .sort((left, right) => (right.monthKey ?? "").localeCompare(left.monthKey ?? ""));
}

async function readPersonalAssetsFromSheet(
  service: sheets_v4.Sheets,
  id: string,
  sheetName: string,
  monthKey?: string,
): Promise<PersonalAssetsEnvelope | null> {
  await ensureStateSheet(service, id, sheetName);
  const response = await service.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${sheetName}'!A2:E`,
  });
  const payload = joinPayloadRows(response.data.values ?? [], "personal");
  if (payload === null) return null;
  const parsed = JSON.parse(payload) as Partial<PersonalAssetsEnvelope>;
  const state = parsePersonalAssetsState(parsed.state);
  const calculation = parsed.calculation === undefined
    ? null
    : parsePersonalCalculationSnapshot(parsed.calculation);
  const storedMonthKey = parsed.monthKey ?? monthKey;
  if (parsed.version !== 1
    || (storedMonthKey !== undefined && !isMonthKey(storedMonthKey))
    || typeof parsed.revision !== "string"
    || typeof parsed.updatedAt !== "string"
    || !state
    || (parsed.calculation !== undefined && !calculation)) {
    throw new Error("保存された個人資産データの形式が不正です。");
  }
  return {
    version: 1,
    monthKey: storedMonthKey,
    revision: parsed.revision,
    updatedAt: parsed.updatedAt,
    state,
    calculation,
  };
}

export async function readPersonalAssets(monthKey: string): Promise<PersonalAssetsEnvelope | null> {
  const service = sheetsService();
  const id = spreadsheetId();
  return readPersonalAssetsFromSheet(service, id, personalAssetsSheetName(monthKey), monthKey);
}

export async function readLegacyPersonalAssets(): Promise<PersonalAssetsEnvelope | null> {
  const service = sheetsService();
  const id = spreadsheetId();
  return readPersonalAssetsFromSheet(service, id, PERSONAL_ASSETS_SHEET_NAME);
}

async function readPersonalSettingsFromSheet(service: sheets_v4.Sheets, id: string) {
  await ensureStateSheet(service, id, PERSONAL_SETTINGS_SHEET_NAME);
  const response = await service.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${PERSONAL_SETTINGS_SHEET_NAME}'!A2:E`,
  });
  const payload = joinPayloadRows(response.data.values ?? [], PERSONAL_SETTINGS_KEY);
  if (payload === null) return null;
  const parsed = JSON.parse(payload) as Partial<PersonalSettingsEnvelope>;
  const reserveTarget = parsePersonalReserveTarget(parsed.reserveTarget);
  const investments = parsed.investments === undefined ? undefined : parsePersonalInvestments(parsed.investments);
  if (parsed.version !== 1
    || typeof parsed.revision !== "string"
    || typeof parsed.updatedAt !== "string"
    || reserveTarget === null
    || (parsed.investments !== undefined && investments === null)) {
    throw new Error("保存された個人資産設定の形式が不正です。");
  }
  if (investments === null) throw new Error("保存された個人資産設定の形式が不正です。");
  return {
    version: 1 as const,
    revision: parsed.revision,
    updatedAt: parsed.updatedAt,
    reserveTarget,
    ...(investments === undefined ? {} : { investments }),
  };
}

export async function readPersonalSettings(): Promise<PersonalSettingsEnvelope | null> {
  const service = sheetsService();
  const id = spreadsheetId();
  return readPersonalSettingsFromSheet(service, id);
}

export async function readPersonalAssetMonthKeys(): Promise<string[]> {
  const service = sheetsService();
  const id = spreadsheetId();
  const metadata = await service.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  return (metadata.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => typeof title === "string"
      && title.startsWith(PERSONAL_ASSETS_SHEET_PREFIX)
      && isMonthKey(title.slice(PERSONAL_ASSETS_SHEET_PREFIX.length)))
    .map((title) => title.slice(PERSONAL_ASSETS_SHEET_PREFIX.length))
    .sort((left, right) => right.localeCompare(left));
}

export async function writePersonalAssets(
  state: PersonalAssetsState,
  monthKey: string,
  calculation: PersonalCalculationSnapshot,
  expectedRevision: string | null,
  expectedSettingsRevision: string | null,
) {
  const service = sheetsService();
  const id = spreadsheetId();
  const sheetName = personalAssetsSheetName(monthKey);
  await ensureStateSheet(service, id, sheetName);
  const current = await readPersonalAssets(monthKey);
  const currentSettings = await readPersonalSettingsFromSheet(service, id);
  if ((current?.revision ?? null) !== expectedRevision) {
    throw new SheetsConflictError("The personal assets spreadsheet was updated by another session.");
  }
  if ((currentSettings?.revision ?? null) !== expectedSettingsRevision) {
    throw new SheetsConflictError("The personal reserve setting was updated by another session.");
  }

  const envelope: PersonalAssetsEnvelope = {
    version: 1,
    monthKey,
    revision: randomUUID(),
    updatedAt: new Date().toISOString(),
    state,
    calculation,
  };
  const settingsEnvelope: PersonalSettingsEnvelope = {
    version: 1,
    revision: randomUUID(),
    updatedAt: envelope.updatedAt,
    reserveTarget: state.reserveTarget,
    investments: state.investments,
  };
  const chunks = splitPayload(JSON.stringify(envelope));
  const rows = chunks.map((chunk, index) => ["personal", index, chunk, envelope.updatedAt, envelope.revision]);
  const settingsChunks = splitPayload(JSON.stringify(settingsEnvelope));
  const settingsRows = settingsChunks.map((chunk, index) => [PERSONAL_SETTINGS_KEY, index, chunk, settingsEnvelope.updatedAt, settingsEnvelope.revision]);
  await service.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `'${PERSONAL_SETTINGS_SHEET_NAME}'!A2:E`,
  });
  await service.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${PERSONAL_SETTINGS_SHEET_NAME}'!A2:E${settingsRows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: settingsRows },
  });
  await service.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `'${sheetName}'!A2:E`,
  });
  await service.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${sheetName}'!A2:E${rows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
  return { ...envelope, settingsRevision: settingsEnvelope.revision };
}

export async function readWishlist(): Promise<WishlistEnvelope> {
  const service = sheetsService();
  const id = spreadsheetId();
  await ensureWishlistSheet(service, id);
  const response = await service.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${WISHLIST_SHEET_NAME}'!A2:G`,
  });
  const rows = response.data.values ?? [];
  const metadataRow = rows.find((row) => row[0] === WISHLIST_META_KEY);
  const revision = metadataRow?.[6] ? String(metadataRow[6]) : null;
  const updatedAt = metadataRow?.[5] ? String(metadataRow[5]) : null;
  const items = parseWishlistItems(rows
    .filter((row) => row[0] !== WISHLIST_META_KEY && row.some((value) => String(value ?? "").trim() !== ""))
    .map((row) => ({
      id: String(row[0] ?? ""),
      name: String(row[1] ?? ""),
      category: String(row[2] ?? ""),
      amount: Number(row[3]),
      url: String(row[4] ?? ""),
    })));
  if (items === null) throw new Error("保存された欲しいものリストの形式が不正です。");
  return { version: 1, revision, updatedAt, items };
}

export async function writeWishlist(items: WishlistItem[], expectedRevision: string | null) {
  const service = sheetsService();
  const id = spreadsheetId();
  await ensureWishlistSheet(service, id);
  const current = await readWishlist();
  if (current.revision !== expectedRevision) {
    throw new SheetsConflictError("The spreadsheet was updated by another session.");
  }

  const revision = randomUUID();
  const updatedAt = new Date().toISOString();
  const rows = [
    [WISHLIST_META_KEY, "", "", "", "", updatedAt, revision],
    ...items.map((item) => [item.id, item.name, item.category, item.amount, item.url, updatedAt, revision]),
  ];
  await service.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `'${WISHLIST_SHEET_NAME}'!A2:G`,
  });
  await service.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${WISHLIST_SHEET_NAME}'!A2:G${rows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
  return { version: 1 as const, revision, updatedAt, items };
}

export async function writeHouseholdState(
  state: HouseholdState,
  expectedRevision: string | null,
  monthKey = closingMonthKey(),
  closedAt?: string | null,
) {
  const service = sheetsService();
  const id = spreadsheetId();
  const sheetName = monthlySheetName(monthKey);
  const current = await readHouseholdState(monthKey);
  if ((current?.revision ?? null) !== expectedRevision) {
    throw new SheetsConflictError("The spreadsheet was updated by another session.");
  }

  const envelope: StateEnvelope = {
    version: 2,
    monthKey,
    closedAt: closedAt === undefined ? (current?.closedAt ?? null) : closedAt,
    revision: randomUUID(),
    updatedAt: new Date().toISOString(),
    state,
  };
  const chunks = splitPayload(JSON.stringify(envelope));
  const rows = chunks.map((chunk, index) => [STATE_KEY, index, chunk, envelope.updatedAt, envelope.revision]);

  await service.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `'${sheetName}'!A2:E`,
  });
  await service.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${sheetName}'!A2:E${rows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
  return envelope;
}

export async function deleteHouseholdState(expectedRevision: string | null, monthKey = closingMonthKey()) {
  const service = sheetsService();
  const id = spreadsheetId();
  const sheetName = monthlySheetName(monthKey);
  const current = await readHouseholdState(monthKey);
  if ((current?.revision ?? null) !== expectedRevision) {
    throw new SheetsConflictError("The spreadsheet was updated by another session.");
  }
  await service.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `'${sheetName}'!A2:E`,
  });
}

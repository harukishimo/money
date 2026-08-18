import assert from "node:assert/strict";
import test from "node:test";
import { extractStatementMonth, parseAmexRows } from "../app/lib/finance.ts";
import {
  joinPayloadRows,
  monthlySheetName,
  personalAssetsSheetName,
  serviceAccountCredentialsFromEnvironment,
  SheetsConfigurationError,
  splitPayload,
} from "../app/lib/sheets.ts";
import { closingMonthKey, currentMonthKey, nextMonthKey, parseHouseholdState } from "../app/lib/state.ts";
import { buildHistoryEntry } from "../app/lib/history.ts";

const state = {
  records: parseAmexRows([
    ...Array.from({ length: 7 }, () => []),
    ["2026/08/01", "", "SHOP", "CHIHARU SATO", "", 1200, "", null],
  ]),
  manualExpenses: [{
    id: "rent-1",
    label: "家賃",
    category: "rent",
    amount: 120000,
    shareRate: 50,
    recurring: true,
  }],
  simulation: {
    months: 24,
    amexMonthly: 1200,
    rentMonthly: 60000,
    fixedMonthly: 0,
    otherMonthly: 0,
    annualGrowthRate: 2,
    scenarioSwing: 15,
    oneOffLabel: "旅行",
    oneOffAmount: 100000,
    oneOffMonth: 6,
  },
  fileName: "statement.xlsx",
};

test("household state validates persisted financial inputs", () => {
  const parsed = parseHouseholdState(state);
  assert.ok(parsed);
  assert.deepEqual({
    records: parsed.records,
    manualExpenses: parsed.manualExpenses,
    simulation: parsed.simulation,
    fileName: parsed.fileName,
  }, state);
  assert.equal(parsed.lifePlan.people.length, 2);
  assert.equal(parseHouseholdState({ ...state, manualExpenses: [{ ...state.manualExpenses[0], shareRate: 101 }] }), null);
  assert.equal(parseHouseholdState({ ...state, lifePlan: { ...parsed.lifePlan, months: 601 } }), null);
});

test("sheet payload chunks round-trip in row order", () => {
  const payload = JSON.stringify({ state, note: "長期保存".repeat(50) });
  const chunks = splitPayload(payload, 37);
  const rows = chunks.map((chunk, index) => ["household", index, chunk, "2026-08-15", "rev-1"]);
  rows.reverse();
  assert.equal(joinPayloadRows(rows), payload);
});

test("sheet payload rejects missing chunk indexes", () => {
  assert.equal(joinPayloadRows([
    ["household", 0, "first"],
    ["household", 2, "third"],
  ]), null);
});

test("personal asset payloads use a separate monthly sheet and key", () => {
  assert.equal(personalAssetsSheetName("2026-08"), "personal_assets_2026-08");
  assert.equal(joinPayloadRows([["personal", 0, "first"]], "personal"), "first");
  assert.equal(joinPayloadRows([["household", 0, "household"]], "personal"), null);
});

test("service account credentials use email and private key environment variables", () => {
  assert.deepEqual(serviceAccountCredentialsFromEnvironment({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "household@example.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----\\n",
  }), {
    client_email: "household@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  });
  assert.throws(
    () => serviceAccountCredentialsFromEnvironment({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "household@example.com" }),
    SheetsConfigurationError,
  );
});

test("monthly storage uses the statement month and Tokyo calendar", () => {
  assert.equal(extractStatementMonth([["ご請求月", "2026年8月"]]), "2026-08");
  assert.equal(extractStatementMonth([["Billing month", "2026/09"]]), "2026-09");
  assert.equal(monthlySheetName("2026-08"), "state_2026-08");
  assert.equal(currentMonthKey(new Date("2026-08-31T15:00:00.000Z")), "2026-09");
  assert.equal(closingMonthKey(new Date("2026-08-15T03:00:00.000Z")), "2026-07");
  assert.equal(nextMonthKey("2026-07"), "2026-08");
});

test("history entry summarizes a closed monthly state", () => {
  const parsed = parseHouseholdState(state);
  assert.ok(parsed);
  const entry = buildHistoryEntry({
    version: 2,
    monthKey: "2026-08",
    closedAt: "2026-08-15T00:00:00.000Z",
    revision: "rev-1",
    updatedAt: "2026-08-15T00:00:00.000Z",
    state: parsed,
  }, parsed);
  assert.ok(entry);
  assert.equal(entry.amexAmount, 1200);
  assert.equal(entry.manualAmount, 60000);
  assert.equal(entry.total, 61200);
  assert.equal(entry.perPerson, 30600);
});

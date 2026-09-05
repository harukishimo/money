import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjection,
  filterTransactionsByIsoDate,
  parseAmexRows,
  parseMoney,
  sumAmexStatementAmount,
  sumIncludedSettlementAmount,
  toIsoDateKey,
} from "../app/lib/finance.ts";

const meta = Array.from({ length: 7 }, () => []);

test("Amex rules include target name and ETC, exclude previous transfer, and prefer H", () => {
  const rows = [
    ...meta,
    ["2026/08/01", "", "SHOP", "CHIHARU SATO", "", 1000, "", null],
    ["2026/08/02", "", "CAFE", "CHIHARU SATO", "", 1000, "", 800],
    ["2026/08/03", "", "前回分口座振替金額", "CHIHARU SATO", "", 99000, "", null],
    ["2026/08/04", "", "ETC TOKYO", "OTHER USER", "", 500, "", null],
    ["2026/08/05", "", "PERSONAL", "OTHER USER", "", 2000, "", null],
  ];
  const parsed = parseAmexRows(rows);
  assert.equal(parsed.length, 5);
  assert.equal(parsed.filter((row) => row.included).reduce((sum, row) => sum + row.amount, 0), 2300);
  assert.equal(parsed[1].amountSource, "H");
  assert.equal(parsed[2].locked, true);
  assert.equal(parsed[3].reason, "etc");
});

test("H column zero is still preferred over F", () => {
  const parsed = parseAmexRows([...meta, ["", "", "SHOP", "CHIHARU SATO", "", 1200, "", 0]]);
  assert.equal(parsed[0].amount, 0);
  assert.equal(parsed[0].amountSource, "H");
});

test("personal cash flow uses every Amex statement line except previous transfer", () => {
  const parsed = parseAmexRows([
    ...meta,
    ["2026/08/01", "", "PARTNER SHOP", "OTHER USER", "", 2000, "", null],
    ["2026/08/02", "", "ETC TOKYO", "OTHER USER", "", 500, "", null],
    ["2026/08/03", "", "前回分口座振替金額", "CHIHARU SATO", "", 99000, "", null],
  ]);
  assert.equal(parsed.filter((row) => row.included).reduce((sum, row) => sum + row.amount, 0), 500);
  assert.equal(sumAmexStatementAmount(parsed), 2500);
});

test("money parser supports yen strings and accounting negatives", () => {
  assert.equal(parseMoney("￥12,340"), 12340);
  assert.equal(parseMoney("(1,200)"), -1200);
  assert.equal(parseMoney(""), null);
});

test("toIsoDateKey normalizes ja-JP display dates and slash strings to YYYY-MM-DD", () => {
  const fromDate = parseAmexRows([
    ...meta,
    [new Date(2026, 6, 4), "", "SHOP", "CHIHARU SATO", "", 1000, "", null],
  ]);
  assert.equal(toIsoDateKey(fromDate[0].date), "2026-07-04");
  assert.equal(toIsoDateKey("2026/07/04"), "2026-07-04");
  assert.equal(toIsoDateKey("2026/7/4"), "2026-07-04");
  assert.equal(toIsoDateKey("2026-07-04"), "2026-07-04");
  assert.equal(toIsoDateKey("2026年7月4日"), "2026-07-04");
  assert.equal(toIsoDateKey("２０２６／０７／０４"), "2026-07-04");
  assert.equal(toIsoDateKey(" 2026.7.4 "), "2026-07-04");
  assert.equal(toIsoDateKey("2026-02-31"), null);
  assert.equal(toIsoDateKey(""), null);
});

test("day filter keeps only matching Amex rows and sums included settlement amounts", () => {
  const parsed = parseAmexRows([
    ...meta,
    ["2026/07/04", "", "FRESH MARKET", "CHIHARU SATO", "", 12640, "", null],
    ["2026/07/08", "", "ETC 首都高速", "PRIMARY USER", "", 3840, "", null],
    ["2026/07/12", "", "BISTRO AO", "CHIHARU SATO", "", 6800, "", 6200],
    ["2026/07/12", "", "PERSONAL SHOP", "PRIMARY USER", "", 9200, "", null],
  ]);
  const july12 = filterTransactionsByIsoDate(parsed, "2026-07-12");
  assert.equal(july12.length, 2);
  assert.deepEqual(july12.map((row) => row.description), ["BISTRO AO", "PERSONAL SHOP"]);
  assert.equal(sumIncludedSettlementAmount(july12), 6200);
  assert.equal(sumIncludedSettlementAmount(parsed), 22680);
  assert.equal(filterTransactionsByIsoDate(parsed, null).length, 4);
  assert.equal(filterTransactionsByIsoDate(parsed, "").length, 4);
});

test("projection applies scenario swing, growth and one-off expense", () => {
  const base = {
    months: 12,
    amexMonthly: 10000,
    rentMonthly: 50000,
    fixedMonthly: 5000,
    otherMonthly: 10000,
    annualGrowthRate: 0,
    scenarioSwing: 20,
    oneOffLabel: "trip",
    oneOffAmount: 100000,
    oneOffMonth: 2,
  };
  const lean = buildProjection(base, "lean");
  const buffered = buildProjection(base, "buffered");
  assert.equal(lean[0].total, 71000);
  assert.equal(buffered[0].total, 79000);
  assert.equal(lean[1].oneOff, 100000);
});

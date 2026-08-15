import assert from "node:assert/strict";
import test from "node:test";
import { buildProjection, parseAmexRows, parseMoney } from "../app/lib/finance.ts";

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

test("money parser supports yen strings and accounting negatives", () => {
  assert.equal(parseMoney("￥12,340"), 12340);
  assert.equal(parseMoney("(1,200)"), -1200);
  assert.equal(parseMoney(""), null);
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

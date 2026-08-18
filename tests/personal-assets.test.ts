import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePersonalFinance,
  parsePersonalAssetsState,
  parsePersonalCalculationSnapshot,
} from "../app/lib/personal-assets.ts";

const state = {
  monthlySalary: 300000,
  reserveTarget: 100000,
  accounts: [{ id: "bank", name: "生活口座", balance: 500000 }],
  mainAccountId: "bank",
  investments: [{ id: "fund", name: "投資信託", valuation: 110000, profitLossRate: 10 }],
  personalExpenses: [{ id: "hobby", monthKey: "2026-07", label: "趣味", amount: 20000 }],
};

test("personal assets calculate remaining money and total assets", () => {
  const parsed = parsePersonalAssetsState(state);
  assert.ok(parsed);
  const result = calculatePersonalFinance(parsed, {
    monthKey: "2026-07",
    claimAmount: 50000,
    amexStatementAmount: 228710,
    otherAmount: 60000,
  });
  assert.equal(result.mainAccountBalance, 500000);
  assert.equal(result.mainAccountBaseBalance, 150000);
  assert.equal(result.monthlyCashflow, 41290);
  assert.equal(result.remainingMoney, 191290);
  assert.equal(result.accountTotal, 500000);
  assert.equal(result.investmentValue, 110000);
  assert.equal(result.totalAssets, 301290);
  assert.equal(result.investableAmount, 91290);
  assert.equal(result.incomeGainBudget, 73032);
  assert.equal(result.capitalGainBudget, 18258);
  assert.equal(result.monthlyProjection[0].estimatedAssets, 342580);
});

test("personal asset state rejects invalid private data", () => {
  assert.equal(parsePersonalAssetsState({ ...state, personalExpenses: [{ ...state.personalExpenses[0], monthKey: "2026-13" }] }), null);
  assert.equal(parsePersonalAssetsState({ ...state, investments: [{ ...state.investments[0], profitLossRate: -101 }] }), null);
  assert.equal(parsePersonalAssetsState({ ...state, accounts: [{ ...state.accounts[0], balance: -1 }] }), null);
  assert.equal(parsePersonalAssetsState({ ...state, mainAccountId: "missing" }), null);
  assert.equal(parsePersonalAssetsState({ ...state, mainAccountId: undefined })?.mainAccountId, null);
});

test("legacy investment return rate is migrated to valuation and profit-loss rate", () => {
  const parsed = parsePersonalAssetsState({
    ...state,
    investments: [{ id: "fund", name: "投資信託", amount: 100000, returnRate: 10 }],
  });
  assert.deepEqual(parsed?.investments[0], {
    id: "fund",
    name: "投資信託",
    valuation: 110000,
    profitLossRate: 10,
  });
});

test("personal calculation snapshot is validated by month", () => {
  assert.deepEqual(parsePersonalCalculationSnapshot({
    monthKey: "2026-08",
    remainingMoney: -1000,
    totalAssets: 200000,
    investableAmount: 100000,
  }), {
    monthKey: "2026-08",
    remainingMoney: -1000,
    totalAssets: 200000,
    investableAmount: 100000,
  });
  assert.equal(parsePersonalCalculationSnapshot({
    monthKey: "2026-08",
    remainingMoney: 0,
    totalAssets: 0,
    investableAmount: -1,
  }), null);
});

test("reserve target is editable as a shared setting and changes investable amount", () => {
  const parsed = parsePersonalAssetsState(state);
  assert.ok(parsed);
  const month = {
    monthKey: "2026-07",
    claimAmount: 50000,
    amexStatementAmount: 228710,
    otherAmount: 60000,
  };
  const defaultReserve = calculatePersonalFinance(parsed, month);
  const customReserve = calculatePersonalFinance({ ...parsed, reserveTarget: 250000 }, month);
  assert.equal(defaultReserve.investableAmount, 91290);
  assert.equal(customReserve.investableAmount, 0);
});

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
  assert.equal(result.monthlyCashflow, 41290);
  assert.equal(result.remainingMoney, 541290);
  assert.equal(result.accountTotal, 500000);
  assert.equal(result.investmentValue, 110000);
  assert.equal(result.totalAssets, 651290);
  assert.equal(result.investableAmount, 441000);
  assert.equal(result.incomeGainBudget, 352000);
  assert.equal(result.capitalGainBudget, 89000);
  assert.equal(result.monthlyProjection[0].estimatedAssets, 692580);
  assert.equal(result.monthlyProjection[1].estimatedAssets, 733870);
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
  assert.equal(defaultReserve.investableAmount, 441000);
  assert.equal(customReserve.investableAmount, 291000);
});


test("screenshot regression: adding 50000 yen reduces the cash shortfall by 50000", () => {
  const base = {
    ...state,
    monthlySalary: 453981,
    reserveTarget: 0,
    accounts: [],
    mainAccountId: null,
    investments: [{ id: "fund", name: "投資", valuation: 302305, profitLossRate: 0 }],
    personalExpenses: [{ id: "personal", monthKey: "2026-09", label: "個人支出", amount: 21000 }],
  };
  const month = { monthKey: "2026-09", claimAmount: 114716, amexStatementAmount: 386756, otherAmount: 284264 };
  const empty = calculatePersonalFinance(base, month);
  const funded = calculatePersonalFinance({ ...base, accounts: [{ id: "bank", name: "rakuten", balance: 50000 }], mainAccountId: "bank" }, month);
  assert.equal(empty.remainingMoney, -123323);
  assert.equal(funded.remainingMoney, -73323);
  assert.equal(funded.remainingMoney - empty.remainingMoney, 50000);
  assert.equal(funded.totalAssets, 228982);
  assert.equal(funded.totalAssets - empty.totalAssets, 50000);
  assert.equal(funded.monthlyProjection[0].estimatedAssets, 105659);
  assert.equal(funded.monthlyProjection[1].estimatedAssets, -17664);
});

test("main account selection never changes total assets or counts balances twice", () => {
  const month = { monthKey: "2026-07", claimAmount: 50000, amexStatementAmount: 228710, otherAmount: 60000 };
  const accounts = [{ id: "bank", name: "生活口座", balance: 500000 }, { id: "other", name: "貯蓄", balance: 200000 }];
  const noMain = calculatePersonalFinance({ ...state, accounts, mainAccountId: null }, month);
  const bankMain = calculatePersonalFinance({ ...state, accounts, mainAccountId: "bank" }, month);
  const otherMain = calculatePersonalFinance({ ...state, accounts, mainAccountId: "other" }, month);
  for (const result of [bankMain, otherMain]) {
    assert.equal(result.totalAssets, noMain.totalAssets);
    assert.equal(result.investableAmount, noMain.investableAmount);
    assert.deepEqual(result.monthlyProjection, noMain.monthlyProjection);
  }
  const zeroMain = calculatePersonalFinance({ ...state, accounts: [{ id: "bank", name: "生活口座", balance: 0 }] }, month);
  assert.equal(zeroMain.remainingMoney, noMain.monthlyCashflow);
});

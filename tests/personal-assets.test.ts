import assert from "node:assert/strict";
import test from "node:test";
import { calculatePersonalFinance, parsePersonalAssetsState } from "../app/lib/personal-assets.ts";

const state = {
  monthlySalary: 300000,
  reserveTarget: 100000,
  accounts: [{ id: "bank", name: "生活口座", balance: 500000 }],
  investments: [{ id: "fund", name: "投資信託", amount: 100000, returnRate: 10 }],
  personalExpenses: [{ id: "hobby", monthKey: "2026-07", label: "趣味", amount: 20000 }],
};

test("personal assets calculate remaining money and total assets", () => {
  const parsed = parsePersonalAssetsState(state);
  assert.ok(parsed);
  const result = calculatePersonalFinance(parsed, {
    monthKey: "2026-07",
    claimAmount: 50000,
    amexAmount: 228710,
    otherAmount: 60000,
  });
  assert.equal(result.remainingMoney, 41290);
  assert.equal(result.accountTotal, 500000);
  assert.equal(result.investmentPrincipal, 100000);
  assert.equal(result.totalAssets, 641290);
  assert.equal(result.investableAmount, 541290);
  assert.equal(result.incomeGainBudget, 433032);
  assert.equal(result.capitalGainBudget, 108258);
  assert.equal(result.investmentEstimatedValue, 110000);
  assert.equal(result.monthlyProjection[0].estimatedAssets, 682580);
});

test("personal asset state rejects invalid private data", () => {
  assert.equal(parsePersonalAssetsState({ ...state, personalExpenses: [{ ...state.personalExpenses[0], monthKey: "2026-13" }] }), null);
  assert.equal(parsePersonalAssetsState({ ...state, investments: [{ ...state.investments[0], returnRate: -101 }] }), null);
  assert.equal(parsePersonalAssetsState({ ...state, accounts: [{ ...state.accounts[0], balance: -1 }] }), null);
});

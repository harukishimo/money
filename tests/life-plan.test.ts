import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLifePlan,
  createDefaultLifePlanInputs,
  mortgagePayment,
  parseLifePlanInputs,
} from "../app/lib/life-plan.ts";

function zeroedPlan() {
  const plan = createDefaultLifePlanInputs();
  return {
    ...plan,
    startMonth: "2026-01",
    months: 12,
    people: [
      {
        ...plan.people[0],
        monthlyTakeHome: 100_000,
        annualBonus: 0,
        annualIncomeGrowthRate: 0,
        personalFixedMonthly: 0,
        monthlyPension: 0,
      },
      {
        ...plan.people[1],
        monthlyTakeHome: 0,
        annualBonus: 0,
        annualIncomeGrowthRate: 0,
        personalFixedMonthly: 0,
        monthlyPension: 0,
      },
    ] as typeof plan.people,
    otherIncomeMonthly: 0,
    currentCash: 0,
    currentInvestments: 0,
    monthlyFixedExpenses: 0,
    monthlyVariableExpenses: 0,
    annualInflationRate: 0,
    minimumCash: 0,
    monthlyInvestment: 0,
    annualInvestmentReturn: 0,
    annualInvestmentFee: 0,
    events: [],
    children: [],
    housing: {
      ...plan.housing,
      mode: "rent" as const,
      rentMonthly: 0,
      rentAnnualGrowthRate: 0,
    },
  };
}

test("life plan rolls monthly income into cash and annual summaries", () => {
  const result = buildLifePlan(zeroedPlan(), "base");
  assert.equal(result.rows.length, 12);
  assert.equal(result.rows[0].monthlyBalance, 100_000);
  assert.equal(result.endingCash, 1_200_000);
  assert.equal(result.endingNetWorth, 1_200_000);
  assert.equal(result.annual[0].income, 1_200_000);
  assert.equal(result.firstShortfall, null);
});

test("investment contribution transfers assets without reducing net worth", () => {
  const plan = { ...zeroedPlan(), monthlyInvestment: 50_000 };
  const result = buildLifePlan(plan, "base");
  assert.equal(result.endingCash, 600_000);
  assert.equal(result.endingInvestments, 600_000);
  assert.equal(result.endingInvestmentPrincipal, 600_000);
  assert.equal(result.endingInvestmentGain, 0);
  assert.equal(result.endingNetWorth, 1_200_000);
});

test("retirement stops salary and pension starts at the configured age", () => {
  const base = zeroedPlan();
  const plan = {
    ...base,
    months: 24,
    people: [
      { ...base.people[0], currentAge: 64, retirementAge: 65, pensionStartAge: 65, monthlyPension: 40_000 },
      { ...base.people[1], currentAge: 64, retirementAge: 65, pensionStartAge: 65, monthlyPension: 0 },
    ] as typeof base.people,
    retirementLivingMonthly: 0,
    retirementCareMonthly: 0,
  };
  const result = buildLifePlan(plan, "base");
  assert.equal(result.rows[11].income, 100_000);
  assert.equal(result.rows[12].income, 40_000);
});

test("one-off life event identifies the first funding shortfall", () => {
  const plan = {
    ...zeroedPlan(),
    people: zeroedPlan().people.map((person) => ({ ...person, monthlyTakeHome: 0 })) as ReturnType<typeof zeroedPlan>["people"],
    currentCash: 100_000,
    events: [{
      id: "move",
      label: "引越し",
      startMonth: 1,
      oneOffAmount: 150_000,
      monthlyAmount: 0,
      durationMonths: 0,
      payer: "household" as const,
    }],
  };
  const result = buildLifePlan(plan, "base");
  assert.equal(result.firstShortfall?.month, 1);
  assert.deepEqual(result.firstShortfall?.eventLabels, ["引越し"]);
  assert.equal(result.endingCash, -50_000);
});

test("education presets add age-based monthly costs", () => {
  const plan = {
    ...zeroedPlan(),
    people: zeroedPlan().people.map((person) => ({ ...person, monthlyTakeHome: 0 })) as ReturnType<typeof zeroedPlan>["people"],
    children: [{
      id: "child",
      name: "第一子",
      birthMonthOffset: -72,
      path: "public" as const,
      costMultiplier: 1,
    }],
    educationInflationRate: 0,
  };
  const result = buildLifePlan(plan, "base");
  assert.equal(result.rows[0].educationCost, 29_167);
  assert.equal(result.totalEducationCost, 350_004);
});

test("mortgage uses equal monthly payments and handles zero interest", () => {
  assert.equal(mortgagePayment(12_000_000, 0, 1), 1_000_000);
  assert.ok(mortgagePayment(40_000_000, 1.5, 35) > 120_000);
});

test("personal event payer is not split as a common expense", () => {
  const base = zeroedPlan();
  const plan = {
    ...base,
    people: base.people.map((person) => ({ ...person, monthlyTakeHome: 100_000 })) as typeof base.people,
    monthlyFixedExpenses: 100_000,
    splitMethod: "equal" as const,
    events: [{
      id: "personal",
      label: "本人の資格費用",
      startMonth: 1,
      oneOffAmount: 10_000,
      monthlyAmount: 0,
      durationMonths: 0,
      payer: "personA" as const,
    }],
  };
  const result = buildLifePlan(plan, "base");
  assert.deepEqual(result.allocation.burdens, [60_000, 50_000]);
});

test("life plan persistence parser accepts defaults and rejects invalid ranges", () => {
  const plan = createDefaultLifePlanInputs();
  assert.deepEqual(parseLifePlanInputs(plan), plan);
  assert.equal(parseLifePlanInputs({ ...plan, months: 601 }), null);
  assert.equal(parseLifePlanInputs({ ...plan, people: [{ ...plan.people[0], bonusMonth: 13 }, plan.people[1]] }), null);
});

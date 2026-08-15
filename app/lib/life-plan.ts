export type LifePlanScenario = "pessimistic" | "base" | "optimistic";
export type SplitMethod = "equal" | "disposable" | "custom";
export type HousingMode = "rent" | "buy";
export type EventPayer = "household" | "personA" | "personB";
export type EducationPath = "public" | "mixed" | "private";

export interface LifePlanPerson {
  name: string;
  currentAge: number;
  monthlyTakeHome: number;
  annualBonus: number;
  bonusMonth: number;
  annualIncomeGrowthRate: number;
  personalFixedMonthly: number;
  retirementAge: number;
  pensionStartAge: number;
  monthlyPension: number;
}

export interface LifePlanEvent {
  id: string;
  label: string;
  startMonth: number;
  oneOffAmount: number;
  monthlyAmount: number;
  durationMonths: number;
  payer: EventPayer;
}

export interface LifePlanChild {
  id: string;
  name: string;
  birthMonthOffset: number;
  path: EducationPath;
  costMultiplier: number;
}

export interface LifePlanHousing {
  mode: HousingMode;
  rentMonthly: number;
  rentAnnualGrowthRate: number;
  purchaseMonth: number;
  propertyPrice: number;
  downPayment: number;
  purchaseCosts: number;
  annualInterestRate: number;
  loanYears: number;
  monthlyMaintenance: number;
  annualPropertyTax: number;
  annualPropertyGrowthRate: number;
}

export interface LifePlanInputs {
  startMonth: string;
  months: number;
  people: [LifePlanPerson, LifePlanPerson];
  otherIncomeMonthly: number;
  currentCash: number;
  currentInvestments: number;
  monthlyFixedExpenses: number;
  monthlyVariableExpenses: number;
  annualInflationRate: number;
  essentialVariableRate: number;
  splitMethod: SplitMethod;
  customPersonARate: number;
  emergencyTargetMonths: number;
  minimumCash: number;
  monthlyInvestment: number;
  annualInvestmentReturn: number;
  annualInvestmentFee: number;
  events: LifePlanEvent[];
  housing: LifePlanHousing;
  children: LifePlanChild[];
  educationInflationRate: number;
  retirementLivingMonthly: number;
  retirementCareMonthly: number;
}

export interface LifePlanMonthRow {
  month: number;
  label: string;
  personIncome: [number, number];
  income: number;
  spending: number;
  monthlyBalance: number;
  cash: number;
  investments: number;
  investmentPrincipal: number;
  investmentContribution: number;
  investmentWithdrawal: number;
  propertyValue: number;
  loanBalance: number;
  netWorth: number;
  housingCost: number;
  educationCost: number;
  eventCost: number;
  eventLabels: string[];
  cashPressure: boolean;
  shortfall: boolean;
}

export interface LifePlanAnnualRow {
  year: number;
  label: string;
  income: number;
  spending: number;
  balance: number;
  endCash: number;
  endInvestments: number;
  endNetWorth: number;
}

export interface ExpenseAllocation {
  rates: [number, number];
  commonExpense: number;
  burdens: [number, number];
  remaining: [number, number];
}

export interface EmergencyFundResult {
  essentialMonthly: number;
  coveredMonths: number;
  targetMonths: number;
  status: "safe" | "warning" | "danger";
}

export interface HousingComparison {
  rentTotal: number;
  buyCashOut: number;
  buyEquity: number;
  buyNetCost: number;
  difference: number;
  better: HousingMode;
  breakEvenMonth: number | null;
}

export interface LifePlanResult {
  rows: LifePlanMonthRow[];
  annual: LifePlanAnnualRow[];
  allocation: ExpenseAllocation;
  emergency: EmergencyFundResult;
  housingComparison: HousingComparison;
  endingCash: number;
  endingInvestments: number;
  endingInvestmentPrincipal: number;
  endingInvestmentGain: number;
  endingNetWorth: number;
  firstCashPressure: LifePlanMonthRow | null;
  firstShortfall: LifePlanMonthRow | null;
  totalEducationCost: number;
  totalEventCost: number;
}

const EDUCATION_ANNUAL_COSTS: Record<EducationPath, [number, number, number, number, number]> = {
  // 幼児教育、小学校、中学校、高校、大学の順。初期値は概算で、将来は年度別統計へ差し替える。
  public: [300_000, 350_000, 550_000, 600_000, 1_000_000],
  mixed: [400_000, 350_000, 550_000, 1_050_000, 1_500_000],
  private: [500_000, 1_700_000, 1_500_000, 1_050_000, 1_500_000],
};

const SCENARIO_ADJUSTMENTS: Record<LifePlanScenario, {
  incomeGrowth: number;
  inflation: number;
  investmentReturn: number;
}> = {
  pessimistic: { incomeGrowth: -1, inflation: 1, investmentReturn: -2 },
  base: { incomeGrowth: 0, inflation: 0, investmentReturn: 0 },
  optimistic: { incomeGrowth: 1, inflation: -0.5, investmentReturn: 2 },
};

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function createDefaultLifePlanInputs(): LifePlanInputs {
  return {
    startMonth: currentYearMonth(),
    months: 360,
    people: [
      {
        name: "本人",
        currentAge: 30,
        monthlyTakeHome: 300_000,
        annualBonus: 600_000,
        bonusMonth: 6,
        annualIncomeGrowthRate: 1,
        personalFixedMonthly: 30_000,
        retirementAge: 65,
        pensionStartAge: 65,
        monthlyPension: 140_000,
      },
      {
        name: "パートナー",
        currentAge: 30,
        monthlyTakeHome: 250_000,
        annualBonus: 400_000,
        bonusMonth: 12,
        annualIncomeGrowthRate: 1,
        personalFixedMonthly: 30_000,
        retirementAge: 65,
        pensionStartAge: 65,
        monthlyPension: 120_000,
      },
    ],
    otherIncomeMonthly: 0,
    currentCash: 2_000_000,
    currentInvestments: 1_000_000,
    monthlyFixedExpenses: 50_000,
    monthlyVariableExpenses: 100_000,
    annualInflationRate: 2,
    essentialVariableRate: 60,
    splitMethod: "disposable",
    customPersonARate: 50,
    emergencyTargetMonths: 6,
    minimumCash: 500_000,
    monthlyInvestment: 50_000,
    annualInvestmentReturn: 4,
    annualInvestmentFee: 0.2,
    events: [],
    housing: {
      mode: "rent",
      rentMonthly: 120_000,
      rentAnnualGrowthRate: 1,
      purchaseMonth: 60,
      propertyPrice: 45_000_000,
      downPayment: 5_000_000,
      purchaseCosts: 3_000_000,
      annualInterestRate: 1.5,
      loanYears: 35,
      monthlyMaintenance: 25_000,
      annualPropertyTax: 150_000,
      annualPropertyGrowthRate: 0,
    },
    children: [],
    educationInflationRate: 2,
    retirementLivingMonthly: 250_000,
    retirementCareMonthly: 30_000,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function annualFactor(rate: number, elapsedMonths: number) {
  return Math.pow(Math.max(0.0001, 1 + rate / 100), elapsedMonths / 12);
}

function monthLabel(startMonth: string, offset: number) {
  const [yearText, monthText] = startMonth.split("-");
  const year = Number(yearText);
  const zeroBasedMonth = Number(monthText) - 1 + offset;
  const resultYear = year + Math.floor(zeroBasedMonth / 12);
  const resultMonth = ((zeroBasedMonth % 12) + 12) % 12 + 1;
  return `${resultYear}年${resultMonth}月`;
}

function calendarMonth(startMonth: string, offset: number) {
  const start = Number(startMonth.slice(5, 7));
  return ((start - 1 + offset) % 12) + 1;
}

export function mortgagePayment(principal: number, annualInterestRate: number, years: number) {
  const payments = Math.max(1, Math.round(years * 12));
  const normalizedPrincipal = Math.max(0, principal);
  const monthlyRate = Math.max(0, annualInterestRate) / 100 / 12;
  if (monthlyRate === 0) return normalizedPrincipal / payments;
  const growth = Math.pow(1 + monthlyRate, payments);
  return normalizedPrincipal * monthlyRate * growth / (growth - 1);
}

function educationMonthlyCost(child: LifePlanChild, month: number, inflationRate: number) {
  const ageInMonths = month - child.birthMonthOffset;
  if (ageInMonths < 36 || ageInMonths >= 264) return 0;

  const age = Math.floor(ageInMonths / 12);
  const stage = age < 6 ? 0 : age < 12 ? 1 : age < 15 ? 2 : age < 18 ? 3 : 4;
  const annual = EDUCATION_ANNUAL_COSTS[child.path][stage];
  const inflation = annualFactor(inflationRate, Math.max(0, month));
  return Math.round(annual / 12 * child.costMultiplier * inflation);
}

function personIncome(person: LifePlanPerson, month: number, startMonth: string, growthAdjustment: number) {
  const retirementMonth = Math.max(0, Math.round((person.retirementAge - person.currentAge) * 12));
  const pensionStartMonth = Math.max(0, Math.round((person.pensionStartAge - person.currentAge) * 12));
  const growth = annualFactor(person.annualIncomeGrowthRate + growthAdjustment, month);
  const salary = month < retirementMonth ? person.monthlyTakeHome * growth : 0;
  const bonus = month < retirementMonth && calendarMonth(startMonth, month) === person.bonusMonth
    ? person.annualBonus * growth
    : 0;
  const pension = month >= pensionStartMonth ? person.monthlyPension : 0;
  return Math.round(salary + bonus + pension);
}

function eventAmounts(events: LifePlanEvent[], month: number) {
  let oneOff = 0;
  let recurring = 0;
  const labels: string[] = [];

  for (const event of events) {
    const start = Math.max(0, Math.round(event.startMonth) - 1);
    const continues = month >= start && (event.durationMonths === 0 || month < start + event.durationMonths);
    if (month === start && event.oneOffAmount > 0) {
      oneOff += event.oneOffAmount;
      labels.push(event.label);
    }
    if (continues && event.monthlyAmount > 0) {
      recurring += event.monthlyAmount;
      if (!labels.includes(event.label)) labels.push(event.label);
    }
  }

  return { oneOff, recurring, labels };
}

function allocationRates(inputs: LifePlanInputs): [number, number] {
  if (inputs.splitMethod === "equal") return [0.5, 0.5];
  if (inputs.splitMethod === "custom") {
    const rate = clamp(inputs.customPersonARate / 100, 0, 1);
    return [rate, 1 - rate];
  }

  const disposableA = Math.max(0, inputs.people[0].monthlyTakeHome - inputs.people[0].personalFixedMonthly);
  const disposableB = Math.max(0, inputs.people[1].monthlyTakeHome - inputs.people[1].personalFixedMonthly);
  const total = disposableA + disposableB;
  return total === 0 ? [0.5, 0.5] : [disposableA / total, disposableB / total];
}

function buildAllocation(inputs: LifePlanInputs, firstRow: LifePlanMonthRow): ExpenseAllocation {
  const rates = allocationRates(inputs);
  const personalA = inputs.people[0].personalFixedMonthly;
  const personalB = inputs.people[1].personalFixedMonthly;
  const personalEventA = inputs.events
    .filter((event) => event.payer === "personA")
    .reduce((sum, event) => {
      const amount = eventAmounts([event], 0);
      return sum + amount.oneOff + amount.recurring;
    }, 0);
  const personalEventB = inputs.events
    .filter((event) => event.payer === "personB")
    .reduce((sum, event) => {
      const amount = eventAmounts([event], 0);
      return sum + amount.oneOff + amount.recurring;
    }, 0);
  const commonExpense = Math.max(0, firstRow.spending - personalA - personalB - personalEventA - personalEventB);
  const commonA = Math.round(commonExpense * rates[0]);
  const commonB = commonExpense - commonA;
  const burdens: [number, number] = [
    commonA + personalA + personalEventA,
    commonB + personalB + personalEventB,
  ];
  return {
    rates,
    commonExpense,
    burdens,
    remaining: [firstRow.personIncome[0] - burdens[0], firstRow.personIncome[1] - burdens[1]],
  };
}

function buildHousingComparison(inputs: LifePlanInputs): HousingComparison {
  const housing = inputs.housing;
  const horizon = Math.max(1, Math.round(inputs.months));
  const purchaseIndex = Math.max(0, Math.round(housing.purchaseMonth) - 1);
  const loanPrincipal = Math.max(0, housing.propertyPrice - housing.downPayment);
  const payment = mortgagePayment(loanPrincipal, housing.annualInterestRate, housing.loanYears);
  const monthlyRate = Math.max(0, housing.annualInterestRate) / 100 / 12;
  const loanPayments = Math.max(1, Math.round(housing.loanYears * 12));

  let rentTotal = 0;
  let buyCashOut = 0;
  let loanBalance = 0;
  let propertyValue = 0;
  let breakEvenMonth: number | null = null;

  for (let month = 0; month < horizon; month += 1) {
    const rent = housing.rentMonthly * annualFactor(housing.rentAnnualGrowthRate, month);
    rentTotal += rent;

    if (month < purchaseIndex) {
      buyCashOut += rent;
    } else {
      if (month === purchaseIndex) {
        buyCashOut += housing.downPayment + housing.purchaseCosts;
        loanBalance = loanPrincipal;
        propertyValue = housing.propertyPrice;
      } else {
        propertyValue *= annualFactor(housing.annualPropertyGrowthRate, 1);
      }

      const paymentNumber = month - purchaseIndex;
      if (loanBalance > 0 && paymentNumber < loanPayments) {
        const interest = loanBalance * monthlyRate;
        const principal = Math.min(loanBalance, Math.max(0, payment - interest));
        loanBalance -= principal;
        buyCashOut += interest + principal;
      }
      buyCashOut += housing.monthlyMaintenance + housing.annualPropertyTax / 12;
    }

    const equity = Math.max(0, propertyValue - loanBalance);
    const buyNetCost = buyCashOut - equity;
    if (month >= purchaseIndex && breakEvenMonth === null && buyNetCost <= rentTotal) breakEvenMonth = month + 1;
  }

  const buyEquity = Math.max(0, propertyValue - loanBalance);
  const buyNetCost = buyCashOut - buyEquity;
  const difference = buyNetCost - rentTotal;
  return {
    rentTotal: Math.round(rentTotal),
    buyCashOut: Math.round(buyCashOut),
    buyEquity: Math.round(buyEquity),
    buyNetCost: Math.round(buyNetCost),
    difference: Math.round(Math.abs(difference)),
    better: difference <= 0 ? "buy" : "rent",
    breakEvenMonth,
  };
}

export function buildLifePlan(inputs: LifePlanInputs, scenario: LifePlanScenario): LifePlanResult {
  const adjustment = SCENARIO_ADJUSTMENTS[scenario];
  const inflationRate = inputs.annualInflationRate + adjustment.inflation;
  const educationInflation = inputs.educationInflationRate + adjustment.inflation;
  const netInvestmentReturn = inputs.annualInvestmentReturn - inputs.annualInvestmentFee + adjustment.investmentReturn;
  const investmentMonthlyFactor = annualFactor(netInvestmentReturn, 1);
  const housing = inputs.housing;
  const purchaseIndex = Math.max(0, Math.round(housing.purchaseMonth) - 1);
  const loanPrincipal = Math.max(0, housing.propertyPrice - housing.downPayment);
  const loanPayment = mortgagePayment(loanPrincipal, housing.annualInterestRate, housing.loanYears);
  const loanMonthlyRate = Math.max(0, housing.annualInterestRate) / 100 / 12;
  const loanPayments = Math.max(1, Math.round(housing.loanYears * 12));

  let cash = inputs.currentCash;
  let investments = inputs.currentInvestments;
  let investmentPrincipal = inputs.currentInvestments;
  let propertyValue = 0;
  let loanBalance = 0;
  const rows: LifePlanMonthRow[] = [];

  for (let month = 0; month < Math.max(1, Math.round(inputs.months)); month += 1) {
    const inflation = annualFactor(inflationRate, month);
    const personIncomeValues: [number, number] = [
      personIncome(inputs.people[0], month, inputs.startMonth, adjustment.incomeGrowth),
      personIncome(inputs.people[1], month, inputs.startMonth, adjustment.incomeGrowth),
    ];
    const income = personIncomeValues[0] + personIncomeValues[1] + Math.round(inputs.otherIncomeMonthly * inflation);
    const allRetired = inputs.people.every((person) => month >= Math.max(0, Math.round((person.retirementAge - person.currentAge) * 12)));
    const baseLiving = allRetired
      ? inputs.retirementLivingMonthly + inputs.retirementCareMonthly
      : inputs.monthlyFixedExpenses + inputs.monthlyVariableExpenses;
    const personalExpenses = inputs.people.reduce((sum, person) => sum + person.personalFixedMonthly, 0) * inflation;
    const livingExpenses = baseLiving * inflation + personalExpenses;
    const educationCost = inputs.children.reduce(
      (sum, child) => sum + educationMonthlyCost(child, month, educationInflation),
      0,
    );
    const event = eventAmounts(inputs.events, month);

    let housingCost = 0;
    let housingOneOff = 0;
    if (housing.mode === "rent" || month < purchaseIndex) {
      housingCost = housing.rentMonthly * annualFactor(housing.rentAnnualGrowthRate + adjustment.inflation, month);
    } else {
      if (month === purchaseIndex) {
        loanBalance = loanPrincipal;
        propertyValue = housing.propertyPrice;
        housingOneOff = housing.downPayment + housing.purchaseCosts;
      } else {
        propertyValue *= annualFactor(housing.annualPropertyGrowthRate, 1);
      }

      const paymentNumber = month - purchaseIndex;
      if (loanBalance > 0 && paymentNumber < loanPayments) {
        const interest = loanBalance * loanMonthlyRate;
        const principal = Math.min(loanBalance, Math.max(0, loanPayment - interest));
        loanBalance -= principal;
        housingCost += interest + principal;
      }
      housingCost += (housing.monthlyMaintenance + housing.annualPropertyTax / 12) * inflation;
    }

    const eventCost = event.oneOff + event.recurring;
    const spending = Math.round(livingExpenses + educationCost + eventCost + housingCost + housingOneOff);
    const monthlyBalance = income - spending;
    const cashBeforeInvestment = cash + monthlyBalance;
    const plannedContribution = Math.round(inputs.monthlyInvestment * inflation);
    const investmentContribution = Math.min(plannedContribution, Math.max(0, cashBeforeInvestment - inputs.minimumCash));
    investments = investments * investmentMonthlyFactor + investmentContribution;
    investmentPrincipal += investmentContribution;
    let nextCash = cashBeforeInvestment - investmentContribution;
    const neededWithdrawal = Math.max(0, inputs.minimumCash - nextCash);
    const investmentWithdrawal = Math.min(investments, neededWithdrawal);
    const principalWithdrawal = investments > 0
      ? investmentPrincipal * (investmentWithdrawal / investments)
      : 0;
    investments -= investmentWithdrawal;
    investmentPrincipal = Math.max(0, investmentPrincipal - principalWithdrawal);
    nextCash += investmentWithdrawal;

    const cashPressure = investmentContribution < plannedContribution || investmentWithdrawal > 0;
    const shortfall = nextCash < inputs.minimumCash;
    cash = nextCash;
    const eventLabels = [...event.labels];
    if (housingOneOff > 0) eventLabels.push("住宅購入");

    rows.push({
      month: month + 1,
      label: monthLabel(inputs.startMonth, month),
      personIncome: personIncomeValues,
      income: Math.round(income),
      spending,
      monthlyBalance: Math.round(monthlyBalance),
      cash: Math.round(cash),
      investments: Math.round(investments),
      investmentPrincipal: Math.round(investmentPrincipal),
      investmentContribution: Math.round(investmentContribution),
      investmentWithdrawal: Math.round(investmentWithdrawal),
      propertyValue: Math.round(propertyValue),
      loanBalance: Math.round(loanBalance),
      netWorth: Math.round(cash + investments + propertyValue - loanBalance),
      housingCost: Math.round(housingCost + housingOneOff),
      educationCost: Math.round(educationCost),
      eventCost: Math.round(eventCost),
      eventLabels,
      cashPressure,
      shortfall,
    });
  }

  const annual: LifePlanAnnualRow[] = [];
  for (const row of rows) {
    const yearIndex = Math.floor((row.month - 1) / 12);
    const existing = annual[yearIndex];
    if (!existing) {
      annual.push({
        year: yearIndex + 1,
        label: `${yearIndex + 1}年目`,
        income: row.income,
        spending: row.spending,
        balance: row.monthlyBalance,
        endCash: row.cash,
        endInvestments: row.investments,
        endNetWorth: row.netWorth,
      });
    } else {
      existing.income += row.income;
      existing.spending += row.spending;
      existing.balance += row.monthlyBalance;
      existing.endCash = row.cash;
      existing.endInvestments = row.investments;
      existing.endNetWorth = row.netWorth;
    }
  }

  const firstRow = rows[0];
  const essentialMonthly = Math.max(1,
    firstRow.housingCost
    + inputs.monthlyFixedExpenses
    + inputs.monthlyVariableExpenses * clamp(inputs.essentialVariableRate / 100, 0, 1)
    + inputs.people[0].personalFixedMonthly
    + inputs.people[1].personalFixedMonthly,
  );
  const coveredMonths = inputs.currentCash / essentialMonthly;
  const emergency: EmergencyFundResult = {
    essentialMonthly: Math.round(essentialMonthly),
    coveredMonths,
    targetMonths: inputs.emergencyTargetMonths,
    status: coveredMonths >= inputs.emergencyTargetMonths
      ? "safe"
      : coveredMonths >= inputs.emergencyTargetMonths / 2 ? "warning" : "danger",
  };
  const lastRow = rows.at(-1) ?? firstRow;

  return {
    rows,
    annual,
    allocation: buildAllocation(inputs, firstRow),
    emergency,
    housingComparison: buildHousingComparison(inputs),
    endingCash: lastRow.cash,
    endingInvestments: lastRow.investments,
    endingInvestmentPrincipal: lastRow.investmentPrincipal,
    endingInvestmentGain: lastRow.investments - lastRow.investmentPrincipal,
    endingNetWorth: lastRow.netWorth,
    firstCashPressure: rows.find((row) => row.cashPressure) ?? null,
    firstShortfall: rows.find((row) => row.shortfall) ?? null,
    totalEducationCost: rows.reduce((sum, row) => sum + row.educationCost, 0),
    totalEventCost: rows.reduce((sum, row) => sum + row.eventCost, 0),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberIn(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function textIn(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function parsePerson(value: unknown): LifePlanPerson | null {
  if (!isRecord(value)
    || !textIn(value.name, 40)
    || !numberIn(value.currentAge, 0, 100)
    || !numberIn(value.monthlyTakeHome, 0, 100_000_000)
    || !numberIn(value.annualBonus, 0, 1_000_000_000)
    || !numberIn(value.bonusMonth, 1, 12)
    || !numberIn(value.annualIncomeGrowthRate, -50, 100)
    || !numberIn(value.personalFixedMonthly, 0, 100_000_000)
    || !numberIn(value.retirementAge, 18, 100)
    || !numberIn(value.pensionStartAge, 18, 100)
    || !numberIn(value.monthlyPension, 0, 100_000_000)) return null;
  return value as unknown as LifePlanPerson;
}

function parseEvent(value: unknown): LifePlanEvent | null {
  if (!isRecord(value)
    || !textIn(value.id, 100)
    || !textIn(value.label, 100)
    || !numberIn(value.startMonth, 1, 600)
    || !numberIn(value.oneOffAmount, 0, 10_000_000_000)
    || !numberIn(value.monthlyAmount, 0, 1_000_000_000)
    || !numberIn(value.durationMonths, 0, 600)
    || !["household", "personA", "personB"].includes(String(value.payer))) return null;
  return value as unknown as LifePlanEvent;
}

function parseChild(value: unknown): LifePlanChild | null {
  if (!isRecord(value)
    || !textIn(value.id, 100)
    || !textIn(value.name, 100)
    || !numberIn(value.birthMonthOffset, -360, 600)
    || !["public", "mixed", "private"].includes(String(value.path))
    || !numberIn(value.costMultiplier, 0, 10)) return null;
  return value as unknown as LifePlanChild;
}

function parseHousing(value: unknown): LifePlanHousing | null {
  if (!isRecord(value)
    || !["rent", "buy"].includes(String(value.mode))
    || !numberIn(value.rentMonthly, 0, 100_000_000)
    || !numberIn(value.rentAnnualGrowthRate, -50, 100)
    || !numberIn(value.purchaseMonth, 1, 600)
    || !numberIn(value.propertyPrice, 0, 100_000_000_000)
    || !numberIn(value.downPayment, 0, 100_000_000_000)
    || !numberIn(value.purchaseCosts, 0, 100_000_000_000)
    || !numberIn(value.annualInterestRate, 0, 100)
    || !numberIn(value.loanYears, 1, 50)
    || !numberIn(value.monthlyMaintenance, 0, 100_000_000)
    || !numberIn(value.annualPropertyTax, 0, 1_000_000_000)
    || !numberIn(value.annualPropertyGrowthRate, -50, 100)) return null;
  return value as unknown as LifePlanHousing;
}

export function parseLifePlanInputs(value: unknown): LifePlanInputs | null {
  if (!isRecord(value)
    || typeof value.startMonth !== "string"
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.startMonth)
    || !numberIn(value.months, 12, 600)
    || !Array.isArray(value.people)
    || value.people.length !== 2
    || !numberIn(value.otherIncomeMonthly, 0, 100_000_000)
    || !numberIn(value.currentCash, 0, 100_000_000_000)
    || !numberIn(value.currentInvestments, 0, 100_000_000_000)
    || !numberIn(value.monthlyFixedExpenses, 0, 100_000_000)
    || !numberIn(value.monthlyVariableExpenses, 0, 100_000_000)
    || !numberIn(value.annualInflationRate, -50, 100)
    || !numberIn(value.essentialVariableRate, 0, 100)
    || !["equal", "disposable", "custom"].includes(String(value.splitMethod))
    || !numberIn(value.customPersonARate, 0, 100)
    || !numberIn(value.emergencyTargetMonths, 1, 60)
    || !numberIn(value.minimumCash, 0, 100_000_000_000)
    || !numberIn(value.monthlyInvestment, 0, 100_000_000)
    || !numberIn(value.annualInvestmentReturn, -50, 100)
    || !numberIn(value.annualInvestmentFee, 0, 100)
    || !Array.isArray(value.events)
    || value.events.length > 100
    || !Array.isArray(value.children)
    || value.children.length > 20
    || !numberIn(value.educationInflationRate, -50, 100)
    || !numberIn(value.retirementLivingMonthly, 0, 100_000_000)
    || !numberIn(value.retirementCareMonthly, 0, 100_000_000)) return null;

  const people = value.people.map(parsePerson);
  const events = value.events.map(parseEvent);
  const children = value.children.map(parseChild);
  const housing = parseHousing(value.housing);
  if (people.some((person) => person === null)
    || events.some((event) => event === null)
    || children.some((child) => child === null)
    || !housing) return null;

  return {
    startMonth: value.startMonth,
    months: value.months,
    people: people as [LifePlanPerson, LifePlanPerson],
    otherIncomeMonthly: value.otherIncomeMonthly,
    currentCash: value.currentCash,
    currentInvestments: value.currentInvestments,
    monthlyFixedExpenses: value.monthlyFixedExpenses,
    monthlyVariableExpenses: value.monthlyVariableExpenses,
    annualInflationRate: value.annualInflationRate,
    essentialVariableRate: value.essentialVariableRate,
    splitMethod: value.splitMethod as SplitMethod,
    customPersonARate: value.customPersonARate,
    emergencyTargetMonths: value.emergencyTargetMonths,
    minimumCash: value.minimumCash,
    monthlyInvestment: value.monthlyInvestment,
    annualInvestmentReturn: value.annualInvestmentReturn,
    annualInvestmentFee: value.annualInvestmentFee,
    events: events as LifePlanEvent[],
    housing,
    children: children as LifePlanChild[],
    educationInflationRate: value.educationInflationRate,
    retirementLivingMonthly: value.retirementLivingMonthly,
    retirementCareMonthly: value.retirementCareMonthly,
  };
}

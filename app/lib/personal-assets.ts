import { formatMonthLabel, isMonthKey, nextMonthKey } from "./state.ts";

export interface PersonalAccount {
  id: string;
  name: string;
  balance: number;
}

export interface PersonalInvestment {
  id: string;
  name: string;
  amount: number;
  returnRate: number;
}

export interface PersonalExpense {
  id: string;
  monthKey: string;
  label: string;
  amount: number;
}

export interface PersonalAssetsState {
  monthlySalary: number;
  reserveTarget: number;
  accounts: PersonalAccount[];
  mainAccountId: string | null;
  investments: PersonalInvestment[];
  personalExpenses: PersonalExpense[];
}

export interface PersonalMonthSummary {
  monthKey: string;
  claimAmount: number;
  amexStatementAmount: number;
  otherAmount: number;
}

export interface PersonalCalculationSnapshot {
  monthKey: string;
  remainingMoney: number;
  totalAssets: number;
  investableAmount: number;
}

export interface PersonalProjectionRow {
  monthKey: string;
  label: string;
  estimatedAssets: number;
}

export interface PersonalFinanceResult {
  salary: number;
  claimAmount: number;
  amexStatementAmount: number;
  sharedOtherAmount: number;
  personalExpenseAmount: number;
  otherAmount: number;
  mainAccountBalance: number;
  mainAccountBaseBalance: number;
  monthlyCashflow: number;
  remainingMoney: number;
  accountTotal: number;
  investmentPrincipal: number;
  investmentEstimatedValue: number;
  investmentGain: number;
  totalAssets: number;
  reserveTarget: number;
  investableAmount: number;
  incomeGainBudget: number;
  capitalGainBudget: number;
  monthlyProjection: PersonalProjectionRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isText(value: unknown, minLength: number, maxLength: number) {
  return typeof value === "string" && value.trim().length >= minLength && value.trim().length <= maxLength;
}

function isAccount(value: unknown): value is PersonalAccount {
  return isRecord(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && value.id.length <= 120
    && isText(value.name, 1, 120)
    && isNonNegativeNumber(value.balance);
}

function isInvestment(value: unknown): value is PersonalInvestment {
  return isRecord(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && value.id.length <= 120
    && isText(value.name, 1, 120)
    && isNonNegativeNumber(value.amount)
    && typeof value.returnRate === "number"
    && Number.isFinite(value.returnRate)
    && value.returnRate >= -100
    && value.returnRate <= 1000;
}

function isPersonalExpense(value: unknown): value is PersonalExpense {
  return isRecord(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && value.id.length <= 120
    && isMonthKey(value.monthKey)
    && isText(value.label, 1, 120)
    && isNonNegativeNumber(value.amount);
}

export function parsePersonalCalculationSnapshot(value: unknown): PersonalCalculationSnapshot | null {
  if (!isRecord(value)
    || !isMonthKey(value.monthKey)
    || !isFiniteNumber(value.remainingMoney)
    || !isFiniteNumber(value.totalAssets)
    || !isNonNegativeNumber(value.investableAmount)) {
    return null;
  }
  return {
    monthKey: value.monthKey,
    remainingMoney: value.remainingMoney,
    totalAssets: value.totalAssets,
    investableAmount: value.investableAmount,
  };
}

export function createDefaultPersonalAssetsState(): PersonalAssetsState {
  return {
    monthlySalary: 0,
    reserveTarget: 100000,
    accounts: [],
    mainAccountId: null,
    investments: [],
    personalExpenses: [],
  };
}

export function parsePersonalAssetsState(value: unknown): PersonalAssetsState | null {
  if (!isRecord(value)
    || !isNonNegativeNumber(value.monthlySalary)
    || !isNonNegativeNumber(value.reserveTarget)
    || !Array.isArray(value.accounts)
    || value.accounts.length > 100
    || !value.accounts.every(isAccount)
    || !Array.isArray(value.investments)
    || value.investments.length > 100
    || !value.investments.every(isInvestment)
    || !Array.isArray(value.personalExpenses)
    || value.personalExpenses.length > 500
    || !value.personalExpenses.every(isPersonalExpense)) {
    return null;
  }
  const mainAccountId = value.mainAccountId === undefined ? null : value.mainAccountId;
  if (mainAccountId !== null
    && (typeof mainAccountId !== "string" || !value.accounts.some((account) => account.id === mainAccountId))) {
    return null;
  }
  return {
    monthlySalary: value.monthlySalary,
    reserveTarget: value.reserveTarget,
    accounts: value.accounts.map((account) => ({ ...account, name: account.name.trim() })),
    mainAccountId,
    investments: value.investments.map((investment) => ({ ...investment, name: investment.name.trim() })),
    personalExpenses: value.personalExpenses.map((expense) => ({ ...expense, label: expense.label.trim() })),
  };
}

export function calculatePersonalFinance(
  state: PersonalAssetsState,
  month: PersonalMonthSummary,
): PersonalFinanceResult {
  const personalExpenseAmount = state.personalExpenses
    .filter((expense) => expense.monthKey === month.monthKey)
    .reduce((sum, expense) => sum + expense.amount, 0);
  const otherAmount = month.otherAmount + personalExpenseAmount;
  const monthlyCashflow = state.monthlySalary + month.claimAmount - month.amexStatementAmount - otherAmount;
  const accountTotal = state.accounts.reduce((sum, account) => sum + account.balance, 0);
  const mainAccount = state.accounts.find((account) => account.id === state.mainAccountId);
  const mainAccountBalance = mainAccount?.balance ?? 0;
  const mainAccountBaseBalance = mainAccount
    ? mainAccountBalance - state.monthlySalary - month.claimAmount
    : 0;
  const remainingMoney = mainAccount
    ? mainAccountBaseBalance + state.monthlySalary + month.claimAmount - month.amexStatementAmount - otherAmount
    : monthlyCashflow;
  const investmentPrincipal = state.investments.reduce((sum, investment) => sum + investment.amount, 0);
  const investmentEstimatedValue = state.investments.reduce(
    (sum, investment) => sum + Math.round(investment.amount * (1 + investment.returnRate / 100)),
    0,
  );
  const investmentGain = investmentEstimatedValue - investmentPrincipal;
  const accountTotalExcludingMain = mainAccount ? accountTotal - mainAccountBalance : accountTotal;
  const totalAssets = accountTotalExcludingMain + investmentPrincipal + remainingMoney;
  const investableAmount = Math.max(0, totalAssets - state.reserveTarget);
  const monthlyProjection = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = index + 1;
    const monthKey = nextMonthKeyByOffset(month.monthKey, monthNumber);
    return {
      monthKey,
      label: formatMonthLabel(monthKey),
      estimatedAssets: totalAssets + monthlyCashflow * monthNumber,
    };
  });

  return {
    salary: state.monthlySalary,
    claimAmount: month.claimAmount,
    amexStatementAmount: month.amexStatementAmount,
    sharedOtherAmount: month.otherAmount,
    personalExpenseAmount,
    otherAmount,
    mainAccountBalance,
    mainAccountBaseBalance,
    monthlyCashflow,
    remainingMoney,
    accountTotal,
    investmentPrincipal,
    investmentEstimatedValue,
    investmentGain,
    totalAssets,
    reserveTarget: state.reserveTarget,
    investableAmount,
    incomeGainBudget: Math.round(investableAmount * 0.8),
    capitalGainBudget: Math.round(investableAmount * 0.2),
    monthlyProjection,
  };
}

function nextMonthKeyByOffset(monthKey: string, offset: number) {
  let result = monthKey;
  for (let index = 0; index < offset; index += 1) result = nextMonthKey(result);
  return result;
}

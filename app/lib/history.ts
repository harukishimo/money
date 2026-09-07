import type { AmexTransaction } from "./finance.ts";
import { splitSettlementByChamShare } from "./finance.ts";
import type { HouseholdState, ManualExpense } from "./state";
import type { StateEnvelope } from "./sheets";

export interface HistoryEntry {
  monthKey: string;
  closedAt: string;
  updatedAt: string;
  amexAmount: number;
  manualAmount: number;
  total: number;
  /** ちゃむ負担額。個人資産の請求額に使う。 */
  perPerson: number;
  haruAmount: number;
  chamAmount: number;
  chamShareRate: number;
  includedCount: number;
  excludedCount: number;
  records: AmexTransaction[];
  manualExpenses: ManualExpense[];
  amexTarget: number | null;
}

function expenseCharge(expense: ManualExpense) {
  return Math.round(expense.amount * (expense.shareRate / 100));
}

export function buildHistoryEntry(envelope: StateEnvelope, state: HouseholdState): HistoryEntry | null {
  if (!envelope.monthKey || !envelope.closedAt) return null;
  const records = state.records;
  const manualExpenses = state.manualExpenses;
  const amexAmount = records
    .filter((record) => record.included)
    .reduce((sum, record) => sum + record.amount, 0);
  const manualAmount = manualExpenses.reduce((sum, expense) => sum + expenseCharge(expense), 0);
  const total = amexAmount + manualAmount;
  const split = splitSettlementByChamShare(total, state.chamShareRate);
  return {
    monthKey: envelope.monthKey,
    closedAt: envelope.closedAt,
    updatedAt: envelope.updatedAt,
    amexAmount,
    manualAmount,
    total,
    perPerson: split.cham,
    haruAmount: split.haru,
    chamAmount: split.cham,
    chamShareRate: split.chamShareRate,
    includedCount: records.filter((record) => record.included).length,
    excludedCount: records.filter((record) => !record.included).length,
    records,
    manualExpenses,
    amexTarget: state.amexTarget,
  };
}

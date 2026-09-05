import type { AmexTransaction } from "./finance";
import type { HouseholdState, ManualExpense } from "./state";
import type { StateEnvelope } from "./sheets";

export interface HistoryEntry {
  monthKey: string;
  closedAt: string;
  updatedAt: string;
  amexAmount: number;
  manualAmount: number;
  total: number;
  perPerson: number;
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
  return {
    monthKey: envelope.monthKey,
    closedAt: envelope.closedAt,
    updatedAt: envelope.updatedAt,
    amexAmount,
    manualAmount,
    total,
    perPerson: Math.round(total / 2),
    includedCount: records.filter((record) => record.included).length,
    excludedCount: records.filter((record) => !record.included).length,
    records,
    manualExpenses,
    amexTarget: state.amexTarget,
  };
}

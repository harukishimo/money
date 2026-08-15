import type { AmexTransaction, SimulationInputs } from "./finance";
import {
  createDefaultLifePlanInputs,
  parseLifePlanInputs,
  type LifePlanInputs,
} from "./life-plan.ts";

export type ManualCategory = "rent" | "fixed" | "other";

export interface ManualExpense {
  id: string;
  label: string;
  category: ManualCategory;
  amount: number;
  shareRate: number;
  recurring: boolean;
}

export interface HouseholdState {
  records: AmexTransaction[];
  manualExpenses: ManualExpense[];
  simulation: SimulationInputs;
  lifePlan: LifePlanInputs;
  fileName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown) {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveNumber(value: unknown) {
  return isFiniteNumber(value) && value >= 1;
}

function isPercentage(value: unknown) {
  return isFiniteNumber(value) && value >= 0 && value <= 100;
}

function isNullableFiniteNumber(value: unknown) {
  return value === null || isFiniteNumber(value);
}

function isTransaction(value: unknown): value is AmexTransaction {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && isFiniteNumber(value.rowNumber)
    && typeof value.date === "string"
    && typeof value.description === "string"
    && typeof value.cardholder === "string"
    && isNullableFiniteNumber(value.amountF)
    && isNullableFiniteNumber(value.amountH)
    && isFiniteNumber(value.amount)
    && (value.amountSource === "F" || value.amountSource === "H")
    && ["name", "etc", "transfer", "other"].includes(String(value.reason))
    && typeof value.reasonLabel === "string"
    && typeof value.included === "boolean"
    && typeof value.locked === "boolean"
    && (value.manuallyAdjusted === undefined || typeof value.manuallyAdjusted === "boolean");
}

function isManualExpense(value: unknown): value is ManualExpense {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.label === "string"
    && ["rent", "fixed", "other"].includes(String(value.category))
    && isNonNegativeNumber(value.amount)
    && isPercentage(value.shareRate)
    && typeof value.recurring === "boolean";
}

function isSimulation(value: unknown): value is SimulationInputs {
  if (!isRecord(value)) return false;
  return isPositiveNumber(value.months)
    && isFiniteNumber(value.amexMonthly)
    && isFiniteNumber(value.rentMonthly)
    && isFiniteNumber(value.fixedMonthly)
    && isFiniteNumber(value.otherMonthly)
    && isFiniteNumber(value.annualGrowthRate)
    && isNonNegativeNumber(value.scenarioSwing)
    && typeof value.oneOffLabel === "string"
    && isNonNegativeNumber(value.oneOffAmount)
    && isPositiveNumber(value.oneOffMonth);
}

export function parseHouseholdState(value: unknown): HouseholdState | null {
  if (!isRecord(value)
    || !Array.isArray(value.records)
    || !value.records.every(isTransaction)
    || !Array.isArray(value.manualExpenses)
    || !value.manualExpenses.every(isManualExpense)
    || !isSimulation(value.simulation)
    || typeof value.fileName !== "string") {
    return null;
  }

  const lifePlan = value.lifePlan === undefined
    ? createDefaultLifePlanInputs()
    : parseLifePlanInputs(value.lifePlan);
  if (!lifePlan) return null;

  return {
    records: value.records,
    manualExpenses: value.manualExpenses,
    simulation: value.simulation,
    lifePlan,
    fileName: value.fileName.slice(0, 255),
  };
}

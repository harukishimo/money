export type AmountSource = "F" | "H";
export type TransactionReason = "name" | "etc" | "transfer" | "other";
export type SimulationMode = "lean" | "base" | "buffered";

export interface AmexTransaction {
  id: string;
  rowNumber: number;
  date: string;
  description: string;
  cardholder: string;
  amountF: number | null;
  amountH: number | null;
  amount: number;
  amountSource: AmountSource;
  reason: TransactionReason;
  reasonLabel: string;
  included: boolean;
  locked: boolean;
  manuallyAdjusted?: boolean;
}

export interface SimulationInputs {
  months: number;
  amexMonthly: number;
  rentMonthly: number;
  fixedMonthly: number;
  otherMonthly: number;
  annualGrowthRate: number;
  scenarioSwing: number;
  oneOffLabel: string;
  oneOffAmount: number;
  oneOffMonth: number;
}

export interface ProjectionRow {
  month: number;
  amex: number;
  rent: number;
  fixed: number;
  other: number;
  oneOff: number;
  total: number;
}

const TARGET_NAME = "CHIHARU SATO";
const TRANSFER_LABELS = ["前回分口座振替金額", "前回分講座振替金額"];

export function formatYen(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: unknown) {
  return normalize(value).toUpperCase();
}

export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return null;
  const negativeByParentheses = /^\(.*\)$/.test(normalized);
  const cleaned = normalized
    .replace(/[¥￥円,，\s]/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/[()]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negativeByParentheses ? -Math.abs(parsed) : parsed;
}

function displayDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  }
  return normalize(value);
}

export function parseAmexRows(rows: unknown[][]): AmexTransaction[] {
  return rows.slice(7).flatMap((row, index) => {
    const rowNumber = index + 8;
    const date = displayDate(row[0]);
    const description = normalize(row[2]);
    const cardholder = normalize(row[3]);
    const amountF = parseMoney(row[5]);
    const amountH = parseMoney(row[7]);
    const amountSource: AmountSource = amountH !== null ? "H" : "F";
    const amount = amountH !== null ? amountH : (amountF ?? 0);

    if (!date && !description && !cardholder && amountF === null && amountH === null) return [];

    const compactDescription = normalizeForMatch(description).replace(/\s/g, "");
    const isTransfer = TRANSFER_LABELS.some((label) => compactDescription.includes(label));
    const isEtc = normalizeForMatch(description).includes("ETC");
    const isTargetName = normalizeForMatch(cardholder) === TARGET_NAME;

    let reason: TransactionReason = "other";
    let reasonLabel = "対象外";
    let included = false;
    let locked = false;
    if (isTransfer) {
      reason = "transfer";
      reasonLabel = "前回振替・除外";
      locked = true;
    } else if (isEtc) {
      reason = "etc";
      reasonLabel = "ETC共通";
      included = amountF !== null || amountH !== null;
    } else if (isTargetName) {
      reason = "name";
      reasonLabel = "名義一致";
      included = amountF !== null || amountH !== null;
    }

    return [{
      id: `${rowNumber}-${normalizeForMatch(description)}-${normalizeForMatch(cardholder)}-${amount}`,
      rowNumber,
      date,
      description,
      cardholder,
      amountF,
      amountH,
      amount,
      amountSource,
      reason,
      reasonLabel,
      included,
      locked,
    }];
  });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function buildProjection(inputs: SimulationInputs, mode: SimulationMode): ProjectionRow[] {
  const swing = Math.max(0, inputs.scenarioSwing) / 100;
  const variableFactor = mode === "lean" ? Math.max(0, 1 - swing) : mode === "buffered" ? 1 + swing : 1;
  const annualFactor = Math.max(0.001, 1 + inputs.annualGrowthRate / 100);
  const rows: ProjectionRow[] = [];

  for (let index = 0; index < Math.max(1, Math.round(inputs.months)); index += 1) {
    const month = index + 1;
    const growth = Math.pow(annualFactor, index / 12);
    const amex = Math.round(Math.max(0, inputs.amexMonthly) * variableFactor * growth);
    const rent = Math.round(Math.max(0, inputs.rentMonthly) * growth);
    const fixed = Math.round(Math.max(0, inputs.fixedMonthly) * growth);
    const other = Math.round(Math.max(0, inputs.otherMonthly) * variableFactor * growth);
    const oneOff = month === Math.max(1, Math.round(inputs.oneOffMonth)) ? Math.max(0, inputs.oneOffAmount) : 0;
    rows.push({ month, amex, rent, fixed, other, oneOff, total: amex + rent + fixed + other + oneOff });
  }
  return rows;
}

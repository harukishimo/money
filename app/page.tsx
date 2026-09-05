"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSheet } from "read-excel-file/browser";
import LifePlanPanel from "./life-plan-panel";
import PersonalAssetsPanel from "./personal-assets-panel";
import {
  amexTargetRemaining,
  buildProjection,
  filterTransactionsByIsoDateRange,
  formatIsoDateSlash,
  formatYen,
  normalizeIsoDateRange,
  parseAmexRows,
  parseCsv,
  sumAmexStatementAmount,
  sumIncludedSettlementAmount,
  toIsoDateKey,
  type AmexTransaction,
  type SimulationInputs,
  type SimulationMode,
} from "./lib/finance";
import type { HistoryEntry } from "./lib/history";
import { createDefaultLifePlanInputs, type LifePlanInputs } from "./lib/life-plan";
import { isWishlistUrl, summarizeWishlist, type WishlistItem, type WishlistSummary } from "./lib/wishlist";
import {
  calculatePersonalFinance,
  type PersonalAssetsState,
  type PersonalCalculationSnapshot,
  type PersonalMonthSummary,
} from "./lib/personal-assets";
import {
  closingMonthKey,
  formatMonthLabel,
  nextMonthKey,
  parseHouseholdState,
  previousMonthKey,
  type HouseholdState,
  type ManualCategory,
  type ManualExpense,
} from "./lib/state";

type View = "settlement" | "simulation" | "lifeplan" | "history" | "wishlist" | "personal";
type SyncStatus = "loading" | "saved" | "saving" | "error";
type DayRangeFilter = { monthKey: string; start: string; end: string | null };

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const STORAGE_KEY = "futari-settlement-v1";

class AuthenticationRequiredError extends Error {}
class AdminAuthenticationRequiredError extends Error {}

const demoRows: unknown[][] = [
  ["カードご利用代金明細書"],
  ["ご請求月", "2026年8月"],
  ["基本カード会員", "SAMPLE USER"],
  [],
  ["以下はサンプルデータです"],
  [],
  ["ご利用日", "処理日", "ご利用内容", "カード会員名", "区分", "金額", "通貨", "調整後金額"],
  ["2026/07/04", "", "FRESH MARKET", "CHIHARU SATO", "", 12640, "JPY", null],
  ["2026/07/08", "", "ETC 首都高速", "PRIMARY USER", "", 3840, "JPY", null],
  ["2026/07/10", "", "前回分口座振替金額", "CHIHARU SATO", "", 98420, "JPY", null],
  ["2026/07/12", "", "BISTRO AO", "CHIHARU SATO", "", 6800, "JPY", 6200],
  ["2026/07/16", "", "PERSONAL SHOP", "PRIMARY USER", "", 9200, "JPY", null],
];

const demoManual: ManualExpense[] = [
  { id: "demo-rent", label: "家賃", category: "rent", amount: 120000, shareRate: 50, recurring: true },
  { id: "demo-utilities", label: "電気・ガス", category: "fixed", amount: 16000, shareRate: 50, recurring: true },
];

const defaultSimulation: SimulationInputs = {
  months: 24,
  amexMonthly: 22680,
  rentMonthly: 60000,
  fixedMonthly: 8000,
  otherMonthly: 0,
  annualGrowthRate: 2,
  scenarioSwing: 15,
  oneOffLabel: "旅行・大型出費",
  oneOffAmount: 100000,
  oneOffMonth: 6,
};

const defaultLifePlan = createDefaultLifePlanInputs();

const modes: { key: SimulationMode; label: string; note: string }[] = [
  { key: "lean", label: "節約", note: "変動費を抑える" },
  { key: "base", label: "基準", note: "現在のペース" },
  { key: "buffered", label: "ゆとり", note: "予備費を見込む" },
];

const categoryLabels: Record<ManualCategory, string> = {
  rent: "家賃",
  fixed: "固定費",
  other: "その他",
};

type WishlistForm = {
  name: string;
  category: string;
  amount: string;
  url: string;
};

function emptyHouseholdState(): HouseholdState {
  return {
    records: [],
    manualExpenses: [],
    simulation: defaultSimulation,
    lifePlan: createDefaultLifePlanInputs(),
    fileName: "未取込",
    amexTarget: null,
  };
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function expenseCharge(expense: ManualExpense) {
  return Math.round(expense.amount * (expense.shareRate / 100));
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (response.status === 401) {
    throw new AuthenticationRequiredError("ログインが必要です。");
  }
  if (!response.ok) throw new Error(body.error || "サーバーとの通信に失敗しました。");
  return body;
}

async function loadRemoteState(monthKey: string) {
  const response = await fetch(`/api/state?month=${encodeURIComponent(monthKey)}`, { cache: "no-store" });
  return responseJson<{
    state: HouseholdState | null;
    revision: string | null;
    updatedAt: string | null;
    closedAt: string | null;
    monthKey: string;
    source: "month" | "legacy";
  }>(response);
}

async function loadHistory() {
  const response = await fetch("/api/history", { cache: "no-store" });
  return responseJson<{ entries: HistoryEntry[] }>(response);
}

async function loadWishlist() {
  const response = await fetch("/api/wishlist", { cache: "no-store" });
  return responseJson<{ items: WishlistItem[]; revision: string | null; updatedAt: string | null }>(response);
}

async function saveRemoteState(
  state: HouseholdState,
  monthKey: string,
  expectedRevision: string | null,
  closedAt?: string | null,
) {
  const response = await fetch(`/api/state?month=${encodeURIComponent(monthKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, expectedRevision, ...(closedAt === undefined ? {} : { closedAt }) }),
  });
  return responseJson<{ revision: string; updatedAt: string; closedAt: string | null }>(response);
}

async function saveRemoteWishlist(items: WishlistItem[], expectedRevision: string | null) {
  const response = await fetch("/api/wishlist", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, expectedRevision }),
  });
  return responseJson<{ items: WishlistItem[]; revision: string; updatedAt: string }>(response);
}

async function adminResponseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (response.status === 401) {
    if (body.error === "認証が必要です。") throw new AuthenticationRequiredError("ログインが必要です。");
    throw new AdminAuthenticationRequiredError("個人資産用の認証が必要です。");
  }
  if (!response.ok) throw new Error(body.error || "個人資産サーバーとの通信に失敗しました。");
  return body;
}

async function loadRemotePersonalAssets(monthKey: string) {
  const response = await fetch(`/api/admin/assets?month=${encodeURIComponent(monthKey)}`, { cache: "no-store" });
  return adminResponseJson<{
    state: PersonalAssetsState;
    revision: string | null;
    settingsRevision: string | null;
    updatedAt: string | null;
    calculation: PersonalCalculationSnapshot | null;
    monthKey: string;
    source: "month" | "legacy" | "empty";
    months: string[];
  }>(response);
}

async function loginPersonalAssets(password: string) {
  const response = await fetch("/api/admin/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return adminResponseJson<{ authenticated: true }>(response);
}

async function saveRemotePersonalAssets(
  state: PersonalAssetsState,
  monthKey: string,
  expectedRevision: string | null,
  expectedSettingsRevision: string | null,
  calculation: PersonalCalculationSnapshot,
) {
  const response = await fetch(`/api/admin/assets?month=${encodeURIComponent(monthKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, expectedRevision, expectedSettingsRevision, calculation }),
  });
  return adminResponseJson<{ state: PersonalAssetsState; revision: string; settingsRevision: string; updatedAt: string; monthKey: string; calculation: PersonalCalculationSnapshot }>(response);
}

function personalSaveSignature(state: PersonalAssetsState, calculation: PersonalCalculationSnapshot | null) {
  return JSON.stringify({ state, calculation });
}

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<View>("settlement");
  const [records, setRecords] = useState<AmexTransaction[]>(() => parseAmexRows(demoRows));
  const [manualExpenses, setManualExpenses] = useState<ManualExpense[]>(demoManual);
  const [simulation, setSimulation] = useState<SimulationInputs>(defaultSimulation);
  const [lifePlan, setLifePlan] = useState<LifePlanInputs>(defaultLifePlan);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>("base");
  const [fileName, setFileName] = useState("サンプル明細.xlsx");
  const [monthKey, setMonthKey] = useState(closingMonthKey);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [personalAssets, setPersonalAssets] = useState<PersonalAssetsState | null>(null);
  const [selectedPersonalMonth, setSelectedPersonalMonth] = useState<string | null>(null);
  const [personalAssetMonths, setPersonalAssetMonths] = useState<string[]>([]);
  const [personalLoadedMonthKey, setPersonalLoadedMonthKey] = useState<string | null>(null);
  const [personalUnlocked, setPersonalUnlocked] = useState(false);
  const [personalAccessChecked, setPersonalAccessChecked] = useState(false);
  const [personalAccessPassword, setPersonalAccessPassword] = useState("");
  const [personalLoading, setPersonalLoading] = useState(false);
  const [personalAccessError, setPersonalAccessError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [loadedMonthKey, setLoadedMonthKey] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [importing, setImporting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<DayRangeFilter | null>(null);
  const [amexTarget, setAmexTarget] = useState<number | null>(null);
  const [manualForm, setManualForm] = useState({
    label: "",
    category: "other" as ManualCategory,
    amount: "",
    shareRate: "100",
    recurring: false,
  });
  const [wishlistForm, setWishlistForm] = useState<WishlistForm>({
    name: "",
    category: "未分類",
    amount: "",
    url: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef<string | null>(null);
  const wishlistRevisionRef = useRef<string | null>(null);
  const personalRevisionRef = useRef<string | null>(null);
  const personalSettingsRevisionRef = useRef<string | null>(null);
  const lastSavedPersonalJsonRef = useRef<string | null>(null);
  const personalCheckStartedRef = useRef(false);
  const lastSavedJsonRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const wishlistSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const personalSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const personalMonthKey = selectedPersonalMonth ?? monthKey;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [remoteHistory, remoteWishlist] = await Promise.all([loadHistory(), loadWishlist()]);
        if (cancelled) return;
        setHistoryEntries(remoteHistory.entries);
        setSelectedHistoryMonth((current) => current ?? remoteHistory.entries[0]?.monthKey ?? null);
        setWishlist(remoteWishlist.items);
        wishlistRevisionRef.current = remoteWishlist.revision;
        const latestClosedMonth = remoteHistory.entries[0]?.monthKey;
        const nextWorkMonth = latestClosedMonth ? nextMonthKey(latestClosedMonth) : closingMonthKey();
        if (nextWorkMonth !== monthKey) setMonthKey(nextWorkMonth);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof AuthenticationRequiredError) {
          router.replace("/login");
          return;
        }
        setError(caught instanceof Error ? caught.message : "月次履歴を読み込めませんでした。");
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [monthKey, router]);

  useEffect(() => {
    if (!historyReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await loadRemoteState(monthKey);
        if (cancelled) return;

        const remoteState = parseHouseholdState(remote.state);
        if (remoteState) {
          setRecords(remoteState.records);
          setManualExpenses(remoteState.manualExpenses);
          setSimulation({ ...defaultSimulation, ...remoteState.simulation });
          setLifePlan(remoteState.lifePlan);
          setFileName(remoteState.fileName || "保存済み明細");
          setAmexTarget(remoteState.amexTarget);
          setIsDemo(false);
          setClosedAt(remote.closedAt ?? null);
          if (remote.source === "legacy") {
            revisionRef.current = null;
            setNotice(`${formatMonthLabel(monthKey)}分の旧保存データを下書きとして読み込みました。`);
          } else {
            revisionRef.current = remote.revision;
          }
          lastSavedJsonRef.current = JSON.stringify(remoteState);
          setSyncStatus("saved");
          localStorage.removeItem(STORAGE_KEY);
        } else {
          const legacyText = localStorage.getItem(STORAGE_KEY);
          const legacyState = legacyText ? parseHouseholdState(JSON.parse(legacyText)) : null;
          if (legacyState) {
            setRecords(legacyState.records);
            setManualExpenses(legacyState.manualExpenses);
            setSimulation({ ...defaultSimulation, ...legacyState.simulation });
            setLifePlan(legacyState.lifePlan);
            setFileName(legacyState.fileName || "移行済み明細");
            setAmexTarget(legacyState.amexTarget);
            setIsDemo(false);
            setClosedAt(null);
            revisionRef.current = null;
            lastSavedJsonRef.current = JSON.stringify(legacyState);
            setNotice(`${formatMonthLabel(monthKey)}分の端末内データを下書きとして読み込みました。`);
          } else {
            const emptyState = emptyHouseholdState();
            setRecords(emptyState.records);
            setManualExpenses(emptyState.manualExpenses);
            setSimulation(emptyState.simulation);
            setLifePlan(emptyState.lifePlan);
            setFileName(emptyState.fileName);
            setAmexTarget(emptyState.amexTarget);
            setIsDemo(false);
            setClosedAt(null);
            revisionRef.current = null;
            lastSavedJsonRef.current = JSON.stringify(emptyState);
          }
          setSyncStatus("saved");
        }
        setLoadedMonthKey(monthKey);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof AuthenticationRequiredError) {
          router.replace("/login");
          return;
        }
        setSyncStatus("error");
        setError(caught instanceof Error ? caught.message : "保存データを読み込めませんでした。");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [historyReady, monthKey, router]);

  useEffect(() => {
    if (!hydrated || !historyReady || loadedMonthKey !== monthKey || isDemo) return;
    const state: HouseholdState = { records, manualExpenses, simulation, lifePlan, fileName, amexTarget };
    const serialized = JSON.stringify(state);
    if (serialized === lastSavedJsonRef.current) return;

    const timer = window.setTimeout(() => {
      setSyncStatus("saving");
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        try {
          const saved = await saveRemoteState(state, monthKey, revisionRef.current, closedAt);
          revisionRef.current = saved.revision;
          lastSavedJsonRef.current = serialized;
          setSyncStatus("saved");
        } catch (caught) {
          if (caught instanceof AuthenticationRequiredError) {
            router.replace("/login");
            return;
          }
          setSyncStatus("error");
          setError(caught instanceof Error ? caught.message : "Google Sheetsへ保存できませんでした。");
        }
      });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [records, manualExpenses, simulation, lifePlan, fileName, amexTarget, monthKey, closedAt, historyReady, loadedMonthKey, hydrated, isDemo, router]);

  useEffect(() => {
    if (view !== "personal" || personalUnlocked || personalAccessChecked || personalCheckStartedRef.current) return;
    let cancelled = false;
    personalCheckStartedRef.current = true;
    setPersonalLoading(true);
    void loadRemotePersonalAssets(personalMonthKey).then((remote) => {
      if (cancelled) return;
      setPersonalAssets(remote.state);
      personalRevisionRef.current = remote.revision;
      personalSettingsRevisionRef.current = remote.settingsRevision;
      setPersonalLoadedMonthKey(remote.monthKey);
      setPersonalAssetMonths(remote.months);
      lastSavedPersonalJsonRef.current = remote.source === "legacy"
        ? null
        : personalSaveSignature(remote.state, remote.calculation);
      setPersonalUnlocked(true);
      setPersonalAccessChecked(true);
    }).catch((caught) => {
      if (cancelled) return;
      if (caught instanceof AuthenticationRequiredError) {
        router.replace("/login");
        return;
      }
      if (!(caught instanceof AdminAuthenticationRequiredError)) {
        setPersonalAccessError(caught instanceof Error ? caught.message : "個人資産を読み込めませんでした。");
      }
      setPersonalAccessChecked(true);
    }).finally(() => {
      if (!cancelled) setPersonalLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view, personalUnlocked, personalAccessChecked, personalMonthKey, router]);

  useEffect(() => {
    if (view !== "personal"
      || !personalUnlocked
      || !personalAccessChecked
      || personalLoadedMonthKey === personalMonthKey) return;
    let cancelled = false;
    void loadRemotePersonalAssets(personalMonthKey).then((remote) => {
      if (cancelled) return;
      setPersonalAssets(remote.state);
      personalRevisionRef.current = remote.revision;
      personalSettingsRevisionRef.current = remote.settingsRevision;
      setPersonalLoadedMonthKey(remote.monthKey);
      setPersonalAssetMonths(remote.months);
      lastSavedPersonalJsonRef.current = remote.source === "legacy"
        ? null
        : personalSaveSignature(remote.state, remote.calculation);
      setPersonalAccessError(null);
    }).catch((caught) => {
      if (cancelled) return;
      if (caught instanceof AuthenticationRequiredError) {
        router.replace("/login");
        return;
      }
      if (caught instanceof AdminAuthenticationRequiredError) {
        setPersonalUnlocked(false);
        setPersonalAssets(null);
        personalRevisionRef.current = null;
        personalSettingsRevisionRef.current = null;
        setPersonalAccessChecked(true);
        setPersonalAccessError("個人資産の認証期限が切れました。もう一度パスワードを入力してください。");
        return;
      }
      setPersonalAccessError(caught instanceof Error ? caught.message : "個人資産を読み込めませんでした。");
    }).finally(() => {
      if (!cancelled) setPersonalLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view, personalUnlocked, personalAccessChecked, personalLoadedMonthKey, personalMonthKey, router]);

  const activeRange = useMemo(() => {
    if (closedAt || !dayFilter || dayFilter.monthKey !== monthKey) return null;
    return normalizeIsoDateRange(dayFilter.start, dayFilter.end ?? dayFilter.start);
  }, [closedAt, dayFilter, monthKey]);
  const amexAmount = useMemo(
    () => sumIncludedSettlementAmount(records),
    [records],
  );
  const visibleRecords = useMemo(
    () => filterTransactionsByIsoDateRange(records, activeRange?.start ?? null, activeRange?.end ?? null),
    [activeRange, records],
  );
  const daySettlementAmount = useMemo(
    () => (activeRange ? sumIncludedSettlementAmount(visibleRecords) : 0),
    [activeRange, visibleRecords],
  );
  const amexStatementAmount = useMemo(() => sumAmexStatementAmount(records), [records]);
  const manualAmount = useMemo(
    () => manualExpenses.reduce((sum, expense) => sum + expenseCharge(expense), 0),
    [manualExpenses],
  );
  const settlementTotal = amexAmount + manualAmount;
  const targetProgress = amexTargetRemaining(amexTarget, amexAmount);
  const perPersonSettlement = Math.round(settlementTotal / 2);
  const includedCount = records.filter((record) => record.included).length;
  const excludedCount = records.filter((record) => !record.included).length;
  const wishlistSummary = useMemo(() => summarizeWishlist(wishlist), [wishlist]);
  const personalMonthSummaries = useMemo<PersonalMonthSummary[]>(() => {
    const summaries = new Map<string, PersonalMonthSummary>();
    summaries.set(monthKey, {
      monthKey,
      claimAmount: perPersonSettlement,
      amexStatementAmount,
      otherAmount: manualAmount,
    });
    for (const entry of historyEntries) {
      if (!summaries.has(entry.monthKey)) {
        summaries.set(entry.monthKey, {
          monthKey: entry.monthKey,
          claimAmount: entry.perPerson,
          amexStatementAmount: sumAmexStatementAmount(entry.records),
          otherAmount: entry.manualAmount,
        });
      }
    }
    return [...summaries.values()];
  }, [amexStatementAmount, historyEntries, manualAmount, monthKey, perPersonSettlement]);

  const selectedPersonalSummary = useMemo(
    () => personalMonthSummaries.find((summary) => summary.monthKey === personalMonthKey) ?? {
      monthKey: personalMonthKey,
      claimAmount: 0,
      amexStatementAmount: 0,
      otherAmount: 0,
    },
    [personalMonthKey, personalMonthSummaries],
  );
  const personalCalculation = useMemo<PersonalCalculationSnapshot | null>(() => {
    if (!personalAssets) return null;
    const result = calculatePersonalFinance(personalAssets, selectedPersonalSummary);
    return {
      monthKey: personalMonthKey,
      remainingMoney: result.remainingMoney,
      totalAssets: result.totalAssets,
      investableAmount: result.investableAmount,
    };
  }, [personalAssets, personalMonthKey, selectedPersonalSummary]);

  useEffect(() => {
    if (!personalAssets
      || !personalUnlocked
      || personalLoading
      || personalLoadedMonthKey !== personalMonthKey
      || !personalCalculation) return;
    const serialized = personalSaveSignature(personalAssets, personalCalculation);
    if (serialized === lastSavedPersonalJsonRef.current) return;
    const timer = window.setTimeout(() => {
      personalSaveQueueRef.current = personalSaveQueueRef.current.then(async () => {
        try {
          const saved = await saveRemotePersonalAssets(
            personalAssets,
            personalMonthKey,
            personalRevisionRef.current,
            personalSettingsRevisionRef.current,
            personalCalculation,
          );
          personalRevisionRef.current = saved.revision;
          personalSettingsRevisionRef.current = saved.settingsRevision;
          lastSavedPersonalJsonRef.current = serialized;
          setPersonalAssetMonths((current) => [...new Set([...current, personalMonthKey])].sort((left, right) => right.localeCompare(left)));
          setPersonalAccessError(null);
        } catch (caught) {
          if (caught instanceof AuthenticationRequiredError) {
            router.replace("/login");
            return;
          }
          if (caught instanceof AdminAuthenticationRequiredError) {
            setPersonalUnlocked(false);
            setPersonalAssets(null);
            setPersonalLoadedMonthKey(null);
            personalRevisionRef.current = null;
            personalSettingsRevisionRef.current = null;
            setPersonalAccessChecked(true);
            setPersonalAccessError("個人資産の認証期限が切れました。もう一度パスワードを入力してください。");
            return;
          }
          setPersonalAccessError(caught instanceof Error ? caught.message : "個人資産を保存できませんでした。");
        }
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [personalAssets, personalCalculation, personalLoading, personalLoadedMonthKey, personalMonthKey, personalUnlocked, router]);

  const projections = useMemo(
    () => Object.fromEntries(modes.map(({ key }) => [key, buildProjection(simulation, key)])) as Record<SimulationMode, ReturnType<typeof buildProjection>>,
    [simulation],
  );
  const selectedProjection = projections[simulationMode];
  const annualProjection = useMemo(() => {
    const years: { label: string; total: number }[] = [];
    selectedProjection.forEach((row, index) => {
      const yearIndex = Math.floor(index / 12);
      if (!years[yearIndex]) years[yearIndex] = { label: `${yearIndex + 1}年目`, total: 0 };
      years[yearIndex].total += row.total;
    });
    return years;
  }, [selectedProjection]);
  const maxAnnual = Math.max(...annualProjection.map((row) => row.total), 1);

  const importFile = async (file: File) => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const rows = extension === "csv" ? parseCsv(await file.text()) : await readSheet(file);
      const nextRecords = parseAmexRows(rows as unknown[][]);
      if (nextRecords.length === 0) {
        throw new Error("8行目以降に明細を見つけられませんでした。Amexから出力したファイルか確認してください。");
      }
      const nextAmexAmount = nextRecords.filter((row) => row.included).reduce((sum, row) => sum + row.amount, 0);
      setRecords(nextRecords);
      setFileName(file.name);
      if (isDemo) setManualExpenses([]);
      setIsDemo(false);
      setClosedAt(null);
      setSimulation((current) => ({ ...current, amexMonthly: nextAmexAmount }));
      setNotice(`${formatMonthLabel(monthKey)}分として${nextRecords.length}件を取り込み、${nextRecords.filter((row) => row.included).length}件を請求対象にしました。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ファイルの読み込みに失敗しました。");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const closeMonth = () => {
    if (closedAt || importing) return;
    if (!window.confirm(`${formatMonthLabel(monthKey)}分として月次締めを実行しますか？`)) return;
    const state: HouseholdState = { records, manualExpenses, simulation, lifePlan, fileName, amexTarget };
    const closedAtValue = new Date().toISOString();
    setError(null);
    setIsClosing(true);
    setSyncStatus("saving");
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        const saved = await saveRemoteState(state, monthKey, revisionRef.current, closedAtValue);
        revisionRef.current = saved.revision;
        lastSavedJsonRef.current = JSON.stringify(state);
        const finishedMonth = monthKey;
        const nextWorkMonth = nextMonthKey(finishedMonth);
        setMonthKey(nextWorkMonth);
        setLoadedMonthKey(null);
        setRecords([]);
        setManualExpenses([]);
        setSimulation({ ...defaultSimulation, amexMonthly: 0 });
        setFileName("未取込");
        setAmexTarget(null);
        setClosedAt(null);
        setIsDemo(false);
        setSyncStatus("saved");
        setNotice(`${formatMonthLabel(finishedMonth)}分を締めました。${formatMonthLabel(nextWorkMonth)}分の作業を開始します。`);
        void loadHistory().then((result) => {
          setHistoryEntries(result.entries);
          setSelectedHistoryMonth((current) => current ?? result.entries[0]?.monthKey ?? null);
        }).catch(() => undefined);
      } catch (caught) {
        if (caught instanceof AuthenticationRequiredError) {
          router.replace("/login");
          return;
        }
        setSyncStatus("error");
        setError(caught instanceof Error ? caught.message : "月次締めを保存できませんでした。");
      } finally {
        setIsClosing(false);
      }
    });
  };

  const toggleRecord = (id: string) => {
    setIsDemo(false);
    setClosedAt(null);
    setRecords((current) => current.map((record) => {
      if (record.id !== id || record.locked) return record;
      return { ...record, included: !record.included, manuallyAdjusted: true };
    }));
  };

  const addManualExpense = () => {
    const amount = Number(manualForm.amount.replaceAll(",", ""));
    const shareRate = Number(manualForm.shareRate);
    if (!manualForm.label.trim() || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(shareRate) || shareRate < 0 || shareRate > 100) {
      setError("項目名、0円以上の金額、0〜100%の負担率を入力してください。");
      return;
    }
    const next: ManualExpense = {
      id: makeId("manual"),
      label: manualForm.label.trim(),
      category: manualForm.category,
      amount,
      shareRate,
      recurring: manualForm.recurring,
    };
    setManualExpenses((current) => isDemo ? [next] : [...current, next]);
    if (isDemo) {
      setRecords([]);
      setFileName("未取込");
    }
    setIsDemo(false);
    setClosedAt(null);
    setManualForm({ label: "", category: "other", amount: "", shareRate: "100", recurring: false });
    setError(null);
  };

  const persistWishlist = (items: WishlistItem[]) => {
    wishlistSaveQueueRef.current = wishlistSaveQueueRef.current.then(async () => {
      try {
        const saved = await saveRemoteWishlist(items, wishlistRevisionRef.current);
        wishlistRevisionRef.current = saved.revision;
      } catch (caught) {
        if (caught instanceof AuthenticationRequiredError) {
          router.replace("/login");
          return;
        }
        setError(caught instanceof Error ? caught.message : "欲しいものリストを保存できませんでした。");
      }
    });
  };

  const unlockPersonalAssets = async () => {
    if (!personalAccessPassword) return;
    setPersonalLoading(true);
    setPersonalAccessError(null);
    try {
      await loginPersonalAssets(personalAccessPassword);
      const remote = await loadRemotePersonalAssets(personalMonthKey);
      setPersonalAssets(remote.state);
      personalRevisionRef.current = remote.revision;
      personalSettingsRevisionRef.current = remote.settingsRevision;
      setPersonalLoadedMonthKey(remote.monthKey);
      setPersonalAssetMonths(remote.months);
      lastSavedPersonalJsonRef.current = remote.source === "legacy"
        ? null
        : personalSaveSignature(remote.state, remote.calculation);
      setPersonalUnlocked(true);
      setPersonalAccessChecked(true);
      setPersonalAccessPassword("");
    } catch (caught) {
      if (caught instanceof AuthenticationRequiredError) {
        router.replace("/login");
        return;
      }
      setPersonalAccessError(caught instanceof Error ? caught.message : "個人資産の認証に失敗しました。");
      setPersonalAccessChecked(true);
    } finally {
      setPersonalLoading(false);
    }
  };

  const lockPersonalAssets = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    setPersonalAssets(null);
    setPersonalUnlocked(false);
    setPersonalLoadedMonthKey(null);
    personalRevisionRef.current = null;
    personalSettingsRevisionRef.current = null;
    setPersonalAccessChecked(true);
    setPersonalAccessPassword("");
    setPersonalAccessError(null);
  };

  const openPersonalAssets = () => {
    setView("personal");
    if (!personalUnlocked && !personalLoading) {
      setPersonalAccessChecked(false);
      personalCheckStartedRef.current = false;
      setPersonalLoading(true);
    }
  };

  const changePersonalMonth = (nextMonthKey: string) => {
    if (nextMonthKey === personalMonthKey) return;
    setPersonalLoading(true);
    setSelectedPersonalMonth(nextMonthKey);
  };

  const addWishlistItem = () => {
    const amount = Number(wishlistForm.amount.replaceAll(",", ""));
    const name = wishlistForm.name.trim();
    const category = wishlistForm.category.trim();
    const url = wishlistForm.url.trim();
    if (!name || !category || !Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) {
      setError("もの、カテゴリ、1円以上の金額を入力してください。");
      return;
    }
    if (!isWishlistUrl(url)) {
      setError("URLはhttp://またはhttps://から始まる形式で入力してください。");
      return;
    }
    const nextItems = [...wishlist, { id: makeId("wishlist"), name, category, amount, url }];
    setWishlist(nextItems);
    setWishlistForm({ name: "", category, amount: "", url: "" });
    setError(null);
    setNotice(`${name}を欲しいものリストに追加しました。`);
    persistWishlist(nextItems);
  };

  const removeWishlistItem = (id: string) => {
    const nextItems = wishlist.filter((item) => item.id !== id);
    setWishlist(nextItems);
    setError(null);
    setNotice("欲しいものリストを更新しました。");
    persistWishlist(nextItems);
  };

  const applyActualsToSimulation = () => {
    const recurring = manualExpenses.filter((expense) => expense.recurring);
    const amountFor = (category: ManualCategory) => recurring
      .filter((expense) => expense.category === category)
      .reduce((sum, expense) => sum + expenseCharge(expense), 0);
    setSimulation((current) => ({
      ...current,
      amexMonthly: amexAmount,
      rentMonthly: amountFor("rent"),
      fixedMonthly: amountFor("fixed"),
      otherMonthly: amountFor("other"),
    }));
    setNotice("現在のAmex対象額と毎月項目を、基準シナリオへ反映しました。");
    setView("simulation");
  };

  const updateLifePlan = (next: LifePlanInputs) => {
    if (isDemo) {
      setRecords([]);
      setManualExpenses([]);
      setFileName("未取込");
    }
    setIsDemo(false);
    setLifePlan(next);
  };

  const resetToDemo = async () => {
    if (!window.confirm(`${formatMonthLabel(monthKey)}の保存データを消去して、サンプル表示に戻しますか？`)) return;
    try {
      const response = await fetch(`/api/state?month=${encodeURIComponent(monthKey)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revisionRef.current }),
      });
      await responseJson<{ deleted: true }>(response);
      localStorage.removeItem(STORAGE_KEY);
      revisionRef.current = null;
      lastSavedJsonRef.current = null;
      setRecords(parseAmexRows(demoRows));
      setManualExpenses(demoManual);
      setSimulation(defaultSimulation);
      setLifePlan(createDefaultLifePlanInputs());
      setFileName("サンプル明細.xlsx");
      setAmexTarget(null);
      setClosedAt(null);
      setIsDemo(true);
      setSyncStatus("saved");
      setNotice(`${formatMonthLabel(monthKey)}の保存データを消去し、サンプル表示に戻しました。`);
      setError(null);
    } catch (caught) {
      if (caught instanceof AuthenticationRequiredError) {
        router.replace("/login");
        return;
      }
      setError(caught instanceof Error ? caught.message : "保存データを消去できませんでした。");
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ふたりの家計室 トップ">
          <span className="brand-mark" aria-hidden="true" />
          <span><strong>ふたりの家計室</strong><small>settlement & forecast</small></span>
        </a>
        <nav className="view-switch" aria-label="表示切り替え">
          <button className={view === "settlement" ? "active" : ""} onClick={() => setView("settlement")}>前月の精算</button>
          <button className={view === "simulation" ? "active" : ""} onClick={() => setView("simulation")}>将来支出</button>
          <button className={view === "lifeplan" ? "active" : ""} onClick={() => setView("lifeplan")}>ライフプラン</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>月次履歴</button>
          <button className={view === "wishlist" ? "active" : ""} onClick={() => setView("wishlist")}>欲しいもの</button>
          <button className={view === "personal" ? "active" : ""} onClick={openPersonalAssets}>個人資産 🔒</button>
        </nav>
        <div className="account-actions">
          <span className={`sync-status ${syncStatus}`}><span aria-hidden="true">●</span>{syncStatus === "loading" ? "読込中" : syncStatus === "saving" ? "保存中" : syncStatus === "error" ? "保存エラー" : "Sheets保存済み"}</span>
          <button onClick={() => void logout()}>ログアウト</button>
        </div>
      </header>

      <main id="top">
        {!hydrated ? (
          <div className="demo-banner" role="status"><span>読込中</span>Google Sheetsから保存データを確認しています。</div>
        ) : isDemo && (
          <div className="demo-banner" role="status">
            <span>サンプル表示中</span>
            Excelを読み込むと、実際の明細に置き換わります。
          </div>
        )}
        {(notice || error) && (
          <div className={error ? "message error" : "message"} role={error ? "alert" : "status"}>
            {error || notice}
            <button aria-label="メッセージを閉じる" onClick={() => { setError(null); setNotice(null); }}>×</button>
          </div>
        )}

        {view === "settlement" ? (
          <>
            <section className="hero-grid" aria-labelledby="settlement-title">
              <div className="hero-copy">
                <p className="eyebrow">{formatMonthLabel(monthKey)} / MONTHLY SETTLEMENT</p>
                <h1 id="settlement-title">{formatMonthLabel(monthKey)}、ふたりで<br />精算する金額。</h1>
                <p className="hero-description">Amex明細と手入力の費用を、決めたルールでひとつの金額にまとめます。</p>
              </div>
              <div className="total-panel">
                <p className="total-label">一人あたりの請求予定額</p>
                <strong>{formatYen(perPersonSettlement)}</strong>
                <p className="total-household">二人分合計 {formatYen(settlementTotal)}</p>
                <div className="total-breakdown">
                  <span>Amex（一人分） <b>{formatYen(Math.round(amexAmount / 2))}</b></span>
                  <span>手入力（一人分） <b>{formatYen(Math.round(manualAmount / 2))}</b></span>
                </div>
                <div className="amex-target">
                  <label>
                    今月の利用目標
                    <div className="input-with-suffix">
                      <input
                        inputMode="numeric"
                        value={amexTarget === null ? "" : String(amexTarget)}
                        placeholder="未設定"
                        disabled={Boolean(closedAt)}
                        onChange={(event) => {
                          const raw = event.target.value.replaceAll(",", "").replaceAll("円", "").trim();
                          if (!raw) {
                            setAmexTarget(null);
                            setIsDemo(false);
                            return;
                          }
                          if (!/^\d+$/.test(raw)) return;
                          setAmexTarget(Number(raw));
                          setIsDemo(false);
                        }}
                      />
                      <span>円</span>
                    </div>
                  </label>
                  {targetProgress.remaining === null ? (
                    closedAt ? null : <p className="amex-target-empty">目標を入れると、精算対象のAmexに対する残りが分かります。</p>
                  ) : (
                    <p className={`amex-target-remaining${targetProgress.overBudget ? " over" : ""}`} aria-live="polite">
                      {targetProgress.overBudget ? "超過" : "残り使える金額"}
                      <b>{formatYen(targetProgress.remaining)}</b>
                      <small>精算対象Amex {formatYen(amexAmount)} に対して</small>
                    </p>
                  )}
                </div>
                {!closedAt && (
                  <div className="day-filter">
                    <div className="day-filter-controls">
                      <p className="day-filter-label">期間で絞り込む</p>
                      <button type="button" className="day-filter-clear" onClick={() => setDayFilter(null)} disabled={!dayFilter || dayFilter.monthKey !== monthKey} aria-label="期間の絞り込みをクリア">クリア</button>
                    </div>
                    <p className="day-filter-range" aria-live="polite">
                      {dayFilter && dayFilter.monthKey === monthKey
                        ? `${formatIsoDateSlash(activeRange?.start ?? dayFilter.start)} 〜 ${dayFilter.end && activeRange ? formatIsoDateSlash(activeRange.end) : ""}`
                        : "開始日と終了日を順に選ぶ"}
                    </p>
                    <DayRangeCalendar
                      key={`${monthKey}-${fileName}`}
                      fallbackMonth={monthKey}
                      records={records}
                      start={dayFilter?.monthKey === monthKey ? dayFilter.start : null}
                      end={dayFilter?.monthKey === monthKey ? dayFilter.end : null}
                      onSelect={(isoDate) => {
                        setDayFilter((current) => {
                          if (!current || current.monthKey !== monthKey || current.end !== null) {
                            return { monthKey, start: isoDate, end: null };
                          }
                          return { monthKey, start: current.start, end: isoDate };
                        });
                      }}
                    />
                    {activeRange ? (
                      <p className="day-total" aria-live="polite">
                        選択期間合計（精算対象）
                        <b>{formatYen(daySettlementAmount)}</b>
                        <small>一人分 {formatYen(Math.round(daySettlementAmount / 2))} · 月の合計は上のまま</small>
                      </p>
                    ) : null}
                  </div>
                )}
                <button className="text-action" onClick={applyActualsToSimulation}>この実績から将来を試す <span>→</span></button>
                <div className="closing-action">
                  <p>{closedAt ? `${formatMonthLabel(monthKey)}分・締め済み` : `${formatMonthLabel(monthKey)}分として登録`}</p>
                  <button className="primary-button" onClick={closeMonth} disabled={Boolean(closedAt) || isClosing || importing}>
                    {isClosing ? "月次締め中…" : closedAt ? "月次締め済み" : `${formatMonthLabel(monthKey)}分を月次締め`}
                  </button>
                </div>
              </div>
            </section>

            <section className="summary-strip" aria-label="集計概要">
              <div><span>対象明細</span><strong>{includedCount}件</strong></div>
              <div><span>自動除外</span><strong>{excludedCount}件</strong></div>
              <div><span>開始行</span><strong>8行目</strong></div>
              <div><span>金額優先</span><strong>H列 → F列</strong></div>
            </section>

            <section className="work-grid">
              <div className="main-column">
                <div className="section-heading">
                  <div>
                    <p className="section-number">01</p>
                    <h2>Amex明細を読み込む</h2>
                  </div>
                  <span className="file-name">{fileName}</span>
                </div>

                <label className={`upload-zone ${importing ? "busy" : ""}`}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importFile(file);
                    }}
                    disabled={importing}
                  />
                  <span className="upload-icon" aria-hidden="true">↥</span>
                  <span><strong>{importing ? "明細を確認中…" : "Excel または CSV を選択"}</strong><small>元ファイルは送信せず、解析した明細だけをSheetsへ保存します</small></span>
                </label>

                <div className="logic-note">
                  <p>自動計算ルール</p>
                  <ol>
                    <li>D列が「CHIHARU SATO」なら対象</li>
                    <li>C列に「ETC」があれば名義に関係なく対象</li>
                    <li>「前回分口座振替金額」は必ず除外</li>
                    <li>H列に値があればF列より優先</li>
                  </ol>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">対象</th>
                        <th scope="col">行</th>
                        <th scope="col">利用内容</th>
                        <th scope="col">カード会員名</th>
                        <th scope="col">判定</th>
                        <th scope="col" className="number">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.length === 0 ? (
                        <tr><td colSpan={6} className="empty-cell">まだAmex明細がありません。</td></tr>
                      ) : activeRange && visibleRecords.length === 0 ? (
                        <tr><td colSpan={6} className="empty-cell">選択した期間の明細はありません。</td></tr>
                      ) : visibleRecords.map((record) => (
                        <tr key={record.id} className={record.included ? "included-row" : "excluded-row"}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${record.description}を請求対象にする`}
                              checked={record.included}
                              disabled={record.locked}
                              onChange={() => toggleRecord(record.id)}
                            />
                          </td>
                          <td className="muted">{record.rowNumber}</td>
                          <td><strong>{record.description || "（明細名なし）"}</strong><small>{record.date}</small></td>
                          <td>{record.cardholder || "—"}</td>
                          <td>
                            <span className={`status-tag ${record.reason}`}>{record.reasonLabel}</span>
                            {record.manuallyAdjusted && <small className="manual-mark">手動変更</small>}
                          </td>
                          <td className="number">
                            <strong>{formatYen(record.amount)}</strong>
                            <small>{record.amountSource === "H" ? "H列を採用" : "F列を採用"}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="side-column">
                <div className="section-heading compact">
                  <div>
                    <p className="section-number">02</p>
                    <h2>その他の費用</h2>
                  </div>
                </div>
                <div className="manual-form">
                  <label>項目名<input value={manualForm.label} placeholder="例：家賃" onChange={(e) => setManualForm({ ...manualForm, label: e.target.value })} /></label>
                  <label>種類<select value={manualForm.category} onChange={(e) => setManualForm({ ...manualForm, category: e.target.value as ManualCategory })}>
                    <option value="rent">家賃</option><option value="fixed">固定費</option><option value="other">その他</option>
                  </select></label>
                  <div className="form-row">
                    <label>元の金額<input inputMode="numeric" value={manualForm.amount} placeholder="0" onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} /></label>
                    <label>請求割合<input inputMode="decimal" value={manualForm.shareRate} onChange={(e) => setManualForm({ ...manualForm, shareRate: e.target.value })} /><span className="field-suffix">%</span></label>
                  </div>
                  <label className="check-label"><input type="checkbox" checked={manualForm.recurring} onChange={(e) => setManualForm({ ...manualForm, recurring: e.target.checked })} />毎月発生する費用</label>
                  <button className="primary-button" onClick={addManualExpense}>精算に追加</button>
                </div>

                <div className="manual-list">
                  {manualExpenses.length === 0 ? <p className="empty-note">家賃や固定費を追加できます。</p> : manualExpenses.map((expense) => (
                    <div className="manual-item" key={expense.id}>
                      <div><span>{categoryLabels[expense.category]}{expense.recurring && "・毎月"}</span><strong>{expense.label}</strong><small>{formatYen(expense.amount)} × {expense.shareRate}%</small></div>
                      <div className="manual-amount"><strong>{formatYen(expenseCharge(expense))}</strong><button aria-label={`${expense.label}を削除`} onClick={() => { setIsDemo(false); setClosedAt(null); setManualExpenses((current) => current.filter((item) => item.id !== expense.id)); }}>×</button></div>
                    </div>
                  ))}
                </div>
              </aside>
            </section>
          </>
        ) : view === "simulation" ? (
          <section className="simulation-page" aria-labelledby="simulation-title">
            <div className="simulation-intro">
              <div>
                <p className="eyebrow">FUTURE SCENARIOS</p>
                <h1 id="simulation-title">この暮らしを続けたら、<br />いくらになる？</h1>
              </div>
              <p>実績は変更せず、前提だけを動かして比較できます。金額は目安であり、将来を保証するものではありません。</p>
            </div>

            <div className="scenario-tabs" aria-label="シナリオ選択">
              {modes.map((mode) => {
                const rows = projections[mode.key];
                const annual = rows.slice(0, 12).reduce((sum, row) => sum + row.total, 0);
                return (
                  <button key={mode.key} className={simulationMode === mode.key ? "active" : ""} onClick={() => setSimulationMode(mode.key)}>
                    <span>{mode.label}<small>{mode.note}</small></span>
                    <strong>{formatYen(annual)}<small>/ 最初の12か月</small></strong>
                  </button>
                );
              })}
            </div>

            <div className="simulation-grid">
              <aside className="assumption-panel">
                <div className="section-heading compact">
                  <div><p className="section-number">01</p><h2>毎月の前提</h2></div>
                </div>
                <button className="secondary-button" onClick={applyActualsToSimulation}>今月の実績を反映</button>
                <div className="assumption-fields">
                  <MoneyInput label="Amex対象額" value={simulation.amexMonthly} onChange={(value) => setSimulation({ ...simulation, amexMonthly: value })} />
                  <MoneyInput label="家賃" value={simulation.rentMonthly} onChange={(value) => setSimulation({ ...simulation, rentMonthly: value })} />
                  <MoneyInput label="固定費" value={simulation.fixedMonthly} onChange={(value) => setSimulation({ ...simulation, fixedMonthly: value })} />
                  <MoneyInput label="その他カード・費用" value={simulation.otherMonthly} onChange={(value) => setSimulation({ ...simulation, otherMonthly: value })} />
                  <label>シミュレーション期間<select value={simulation.months} onChange={(e) => setSimulation({ ...simulation, months: Number(e.target.value) })}>
                    <option value={12}>1年</option><option value={24}>2年</option><option value={36}>3年</option><option value={60}>5年</option>
                  </select></label>
                  <label>年間の金額上昇率<div className="input-with-suffix"><input type="number" step="0.1" value={simulation.annualGrowthRate} onChange={(e) => setSimulation({ ...simulation, annualGrowthRate: Number(e.target.value) || 0 })} /><span>%</span></div></label>
                  <label>節約／ゆとりの幅<div className="input-with-suffix"><input type="number" min="0" max="100" value={simulation.scenarioSwing} onChange={(e) => setSimulation({ ...simulation, scenarioSwing: Math.max(0, Number(e.target.value) || 0) })} /><span>%</span></div></label>
                </div>

                <div className="one-off-block">
                  <h3>一度だけの出費</h3>
                  <label>内容<input value={simulation.oneOffLabel} onChange={(e) => setSimulation({ ...simulation, oneOffLabel: e.target.value })} /></label>
                  <MoneyInput label="金額" value={simulation.oneOffAmount} onChange={(value) => setSimulation({ ...simulation, oneOffAmount: value })} />
                  <label>何か月後<input type="number" min="1" max={simulation.months} value={simulation.oneOffMonth} onChange={(e) => setSimulation({ ...simulation, oneOffMonth: Math.max(1, Number(e.target.value) || 1) })} /></label>
                </div>
              </aside>

              <div className="forecast-panel">
                <div className="forecast-kpis">
                  <div><span>次の1か月</span><strong>{formatYen(selectedProjection[0]?.total ?? 0)}</strong></div>
                  <div><span>最初の12か月</span><strong>{formatYen(selectedProjection.slice(0, 12).reduce((sum, row) => sum + row.total, 0))}</strong></div>
                  <div><span>{simulation.months}か月累計</span><strong>{formatYen(selectedProjection.reduce((sum, row) => sum + row.total, 0))}</strong></div>
                </div>

                <div className="chart-card">
                  <div className="chart-heading"><div><p className="section-number">02</p><h2>年間支出予測</h2></div><span>{modes.find((mode) => mode.key === simulationMode)?.label}シナリオ</span></div>
                  <div className="bar-chart" role="img" aria-label="年間支出予測の棒グラフ">
                    {annualProjection.map((row) => (
                      <div className="bar-row" key={row.label}>
                        <span>{row.label}</span>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, row.total / maxAnnual * 100)}%` }} /></div>
                        <strong>{formatYen(row.total)}</strong>
                      </div>
                    ))}
                  </div>
                  <p className="chart-note">変動費はシナリオ幅、全項目は年間上昇率を反映。一度だけの出費は指定月に加算しています。</p>
                </div>

                <div className="monthly-preview">
                  <div className="section-heading compact"><div><p className="section-number">03</p><h2>直近12か月</h2></div></div>
                  <div className="month-grid">
                    {selectedProjection.slice(0, 12).map((row) => (
                      <div key={row.month} className={row.oneOff > 0 ? "event-month" : ""}>
                        <span>{row.month}か月後</span><strong>{formatYen(row.total)}</strong>{row.oneOff > 0 && <small>{simulation.oneOffLabel}</small>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
            ) : view === "lifeplan" ? (
              <LifePlanPanel value={lifePlan} onChange={updateLifePlan} />
            ) : view === "history" ? (
              <HistoryPanel entries={historyEntries} selectedMonth={selectedHistoryMonth} onSelect={setSelectedHistoryMonth} />
            ) : view === "wishlist" ? (
              <WishlistPanel
                items={wishlist}
                summary={wishlistSummary}
                form={wishlistForm}
                onFormChange={setWishlistForm}
                onAdd={addWishlistItem}
                onRemove={removeWishlistItem}
              />
            ) : personalAssets && personalUnlocked ? (
              <PersonalAssetsPanel
                state={personalAssets}
                monthSummaries={personalMonthSummaries}
                savedMonthKeys={personalAssetMonths}
                selectedMonth={personalMonthKey}
                onMonthChange={changePersonalMonth}
                onChange={setPersonalAssets}
                onLogout={() => void lockPersonalAssets()}
                monthLoading={personalLoading && personalLoadedMonthKey !== personalMonthKey}
              />
            ) : (
              <PersonalAssetsGate
                password={personalAccessPassword}
                error={personalAccessError}
                loading={personalLoading}
                checked={personalAccessChecked}
                onPasswordChange={setPersonalAccessPassword}
                onUnlock={() => void unlockPersonalAssets()}
              />
            )}
      </main>

      <footer>
        <p>ふたりの家計室 <span>— 個人用の精算・試算ツール</span></p>
        <button onClick={() => void resetToDemo()}>保存データを消去</button>
      </footer>
    </div>
  );
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>{label}<div className="input-with-suffix"><input type="number" min="0" value={value} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} /><span>円</span></div></label>
  );
}

function calendarCells(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return [];
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return cells;
}

function rangeTone(isoDate: string, start: string | null, end: string | null) {
  const range = normalizeIsoDateRange(start, end);
  if (!range || isoDate < range.start || isoDate > range.end) return "";
  if (range.start === range.end) return "single";
  if (isoDate === range.start) return "start";
  if (isoDate === range.end) return "end";
  return "in";
}

function DayRangeCalendar({
  fallbackMonth,
  records,
  start,
  end,
  onSelect,
}: {
  fallbackMonth: string;
  records: AmexTransaction[];
  start: string | null;
  end: string | null;
  onSelect: (isoDate: string) => void;
}) {
  const initialMonth = useMemo(() => {
    const keys = records.map((record) => toIsoDateKey(record.date)).filter((value): value is string => Boolean(value)).sort();
    return keys[0]?.slice(0, 7) ?? fallbackMonth;
  }, [fallbackMonth, records]);
  const [viewMonth, setViewMonth] = useState(initialMonth);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const highlightEnd = end ?? (start && !end ? hoverDate : null);
  const cells = useMemo(() => calendarCells(viewMonth), [viewMonth]);

  return (
    <div className="range-calendar">
      <div className="range-calendar-nav">
        <button type="button" aria-label="前の月" onClick={() => setViewMonth((current) => previousMonthKey(current))}>‹</button>
        <strong>{formatMonthLabel(viewMonth)}</strong>
        <button type="button" aria-label="次の月" onClick={() => setViewMonth((current) => nextMonthKey(current))}>›</button>
      </div>
      <div className="range-calendar-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="range-calendar-grid" role="group" aria-label="期間カレンダー">
        {cells.map((isoDate, index) => {
          if (!isoDate) return <span key={`empty-${index}`} className="range-day empty" />;
          const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
          const tone = rangeTone(isoDate, start, highlightEnd);
          const dayNumber = Number(isoDate.slice(8));
          return (
            <button
              key={isoDate}
              type="button"
              className={`range-day${weekday === 0 ? " sun" : ""}${weekday === 6 ? " sat" : ""}${tone ? ` ${tone}` : ""}`}
              aria-label={`${formatIsoDateSlash(isoDate)}を${start && !end ? "終了日" : "開始日"}にする`}
              aria-pressed={tone === "start" || tone === "end" || tone === "single"}
              onMouseEnter={() => setHoverDate(isoDate)}
              onMouseLeave={() => setHoverDate(null)}
              onClick={() => onSelect(isoDate)}
            >
              <span>{dayNumber}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function HistoryPanel({
  entries,
  selectedMonth,
  onSelect,
}: {
  entries: HistoryEntry[];
  selectedMonth: string | null;
  onSelect: (monthKey: string) => void;
}) {
  const selected = entries.find((entry) => entry.monthKey === selectedMonth) ?? entries[0];
  const targetProgress = selected ? amexTargetRemaining(selected.amexTarget, selected.amexAmount) : null;

  return (
    <section className="history-page" aria-labelledby="history-title">
      <div className="simulation-intro">
        <div>
          <p className="eyebrow">MONTHLY HISTORY</p>
          <h1 id="history-title">締めた月を、<br />あとから確認する。</h1>
        </div>
        <p>月次締めを完了した月だけを一覧表示しています。明細、その他の費用、二人分の合計、一人あたりの金額を確認できます。</p>
      </div>

      {entries.length === 0 ? (
        <div className="history-empty">まだ月次締め済みのデータがありません。</div>
      ) : selected && (
        <div className="history-grid">
          <aside className="history-list" aria-label="月次履歴一覧">
            <p className="section-number">MONTHS</p>
            {entries.map((entry) => (
              <button
                key={entry.monthKey}
                className={entry.monthKey === selected.monthKey ? "active" : ""}
                onClick={() => onSelect(entry.monthKey)}
              >
                <span>{formatMonthLabel(entry.monthKey)}</span>
                <strong>{formatYen(entry.total)}</strong>
                <small>一人あたり {formatYen(entry.perPerson)}</small>
              </button>
            ))}
          </aside>

          <div className="history-detail">
            <div className="history-detail-heading">
              <div>
                <p className="eyebrow">{formatMonthLabel(selected.monthKey)} / CLOSED</p>
                <h2>{formatMonthLabel(selected.monthKey)}分の内訳</h2>
              </div>
              <span>締め日時 {formatHistoryDate(selected.closedAt)}</span>
            </div>

            <div className="history-kpis">
              <div><span>一人あたり</span><strong>{formatYen(selected.perPerson)}</strong></div>
              <div><span>二人分合計</span><strong>{formatYen(selected.total)}</strong></div>
              <div><span>Amex</span><strong>{formatYen(selected.amexAmount)}</strong></div>
              <div><span>その他費用</span><strong>{formatYen(selected.manualAmount)}</strong></div>
            </div>
            {targetProgress && targetProgress.target !== null ? (
              <p className={`history-target${targetProgress.overBudget ? " over" : ""}`}>
                利用目標 {formatYen(targetProgress.target)}
                <span>
                  {targetProgress.overBudget
                    ? `超過 ${formatYen(Math.abs(targetProgress.remaining ?? 0))}`
                    : `残り ${formatYen(targetProgress.remaining ?? 0)}`}
                </span>
              </p>
            ) : null}

            <div className="history-section">
              <div className="section-heading compact">
                <div><p className="section-number">01</p><h2>Amex明細</h2></div>
                <span>{selected.includedCount}件対象 / {selected.excludedCount}件除外</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th scope="col">対象</th><th scope="col">利用日</th><th scope="col">利用内容</th><th scope="col">名義</th><th scope="col" className="number">金額</th></tr>
                  </thead>
                  <tbody>
                    {selected.records.map((record) => (
                      <tr key={record.id} className={record.included ? "included-row" : "excluded-row"}>
                        <td>{record.included ? "対象" : "除外"}</td>
                        <td>{record.date}</td>
                        <td><strong>{record.description || "（明細名なし）"}</strong><small>{record.reasonLabel}</small></td>
                        <td>{record.cardholder || "—"}</td>
                        <td className="number"><strong>{formatYen(record.amount)}</strong><small>{record.amountSource}列</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="history-section">
              <div className="section-heading compact"><div><p className="section-number">02</p><h2>その他の費用</h2></div></div>
              {selected.manualExpenses.length === 0 ? <p className="empty-note">登録なし</p> : (
                <div className="history-expenses">
                  {selected.manualExpenses.map((expense) => (
                    <div key={expense.id}>
                      <span>{categoryLabels[expense.category]}{expense.recurring && "・毎月"}</span>
                      <strong>{expense.label}</strong>
                      <small>{formatYen(expense.amount)} × {expense.shareRate}% = {formatYen(expenseCharge(expense))}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PersonalAssetsGate({
  password,
  error,
  loading,
  checked,
  onPasswordChange,
  onUnlock,
}: {
  password: string;
  error: string | null;
  loading: boolean;
  checked: boolean;
  onPasswordChange: (password: string) => void;
  onUnlock: () => void;
}) {
  return (
    <section className="personal-gate" aria-labelledby="personal-gate-title">
      <div className="personal-gate-card">
        <p className="eyebrow">PRIVATE ACCESS</p>
        <h1 id="personal-gate-title">個人資産エリア</h1>
        <p>口座残高、投資評価額、個人支出は共有家計とは別の情報です。管理者用パスワードを入力して表示します。</p>
        <label>個人資産用パスワード<input type="password" autoComplete="current-password" value={password} onChange={(event) => onPasswordChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onUnlock(); }} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        {!checked && loading && <p className="personal-gate-note">既存の認証状態を確認しています…</p>}
        <button className="primary-button" onClick={onUnlock} disabled={loading || password.length === 0}>{loading ? "確認中…" : "個人資産を開く"}</button>
        <small>このアクセスには共有パスワードとは別の`ADMIN_PASSWORD_HASH`を使用します。</small>
      </div>
    </section>
  );
}

function WishlistPanel({
  items,
  summary,
  form,
  onFormChange,
  onAdd,
  onRemove,
}: {
  items: WishlistItem[];
  summary: WishlistSummary;
  form: WishlistForm;
  onFormChange: (form: WishlistForm) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="wishlist-page" aria-labelledby="wishlist-title">
      <div className="simulation-intro">
        <div>
          <p className="eyebrow">WISHLIST / BUDGET</p>
          <h1 id="wishlist-title">いつか欲しいものを、<br />金額で見渡す。</h1>
        </div>
        <p>買いたいものをカテゴリとURL付きで保存します。月次精算とは分けて管理し、カテゴリ別と全体の予算をいつでも確認できます。</p>
      </div>

      <div className="wishlist-layout">
        <aside className="wishlist-form-panel">
          <div className="section-heading compact">
            <div><p className="section-number">01</p><h2>欲しいものを登録</h2></div>
          </div>
          <div className="wishlist-form">
            <label>もの<input value={form.name} placeholder="例：ダイニングテーブル" onChange={(event) => onFormChange({ ...form, name: event.target.value })} /></label>
            <label>カテゴリ<input value={form.category} placeholder="例：家具、旅行" onChange={(event) => onFormChange({ ...form, category: event.target.value })} /></label>
            <label>金額<div className="input-with-suffix"><input inputMode="numeric" value={form.amount} placeholder="0" onChange={(event) => onFormChange({ ...form, amount: event.target.value })} /><span>円</span></div></label>
            <label>URL（任意）<input type="url" value={form.url} placeholder="https://..." onChange={(event) => onFormChange({ ...form, url: event.target.value })} /></label>
            <button className="primary-button" onClick={onAdd}>リストに追加</button>
          </div>
          <p className="input-note wishlist-note">登録内容はGoogle Sheetsの`wishlist`タブへ保存され、月次締めでは消えません。</p>
        </aside>

        <div className="wishlist-results">
          <div className="wishlist-kpis">
            <div><span>全体合計</span><strong>{formatYen(summary.total)}</strong></div>
            <div><span>登録数</span><strong>{items.length}件</strong></div>
            <div><span>カテゴリ数</span><strong>{summary.categories.length}種類</strong></div>
          </div>

          <div className="wishlist-category-card">
            <div className="section-heading compact"><div><p className="section-number">02</p><h2>カテゴリ別合計</h2></div></div>
            {summary.categories.length === 0 ? <p className="empty-note">まだ登録がありません。</p> : (
              <div className="wishlist-category-list">
                {summary.categories.map((category) => (
                  <div key={category.category}>
                    <span>{category.category}<small>{category.count}件</small></span>
                    <strong>{formatYen(category.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="wishlist-items-card">
            <div className="section-heading compact"><div><p className="section-number">03</p><h2>登録一覧</h2></div></div>
            {items.length === 0 ? <div className="wishlist-empty">欲しいものを登録すると、ここに一覧表示されます。</div> : (
              <div className="wishlist-item-list">
                {items.map((item) => (
                  <div className="wishlist-item" key={item.id}>
                    <div className="wishlist-item-copy">
                      <span>{item.category}</span>
                      <strong>{item.name}</strong>
                      {item.url && <a href={item.url} target="_blank" rel="noreferrer">商品ページを開く ↗</a>}
                    </div>
                    <strong className="wishlist-item-amount">{formatYen(item.amount)}</strong>
                    <button className="wishlist-remove" aria-label={`${item.name}を削除`} onClick={() => onRemove(item.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

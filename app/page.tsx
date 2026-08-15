"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSheet } from "read-excel-file/browser";
import LifePlanPanel from "./life-plan-panel";
import {
  buildProjection,
  formatYen,
  parseAmexRows,
  parseCsv,
  type AmexTransaction,
  type SimulationInputs,
  type SimulationMode,
} from "./lib/finance";
import { createDefaultLifePlanInputs, type LifePlanInputs } from "./lib/life-plan";
import {
  parseHouseholdState,
  type HouseholdState,
  type ManualCategory,
  type ManualExpense,
} from "./lib/state";

type View = "settlement" | "simulation" | "lifeplan";
type SyncStatus = "loading" | "saved" | "saving" | "error";

const STORAGE_KEY = "futari-settlement-v1";

class AuthenticationRequiredError extends Error {}

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

async function saveRemoteState(state: HouseholdState, expectedRevision: string | null) {
  const response = await fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, expectedRevision }),
  });
  return responseJson<{ revision: string; updatedAt: string }>(response);
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
  const [isDemo, setIsDemo] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState({
    label: "",
    category: "other" as ManualCategory,
    amount: "",
    shareRate: "100",
    recurring: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef<string | null>(null);
  const lastSavedJsonRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/state", { cache: "no-store" });
          const remote = await responseJson<{
            state: HouseholdState | null;
            revision: string | null;
            updatedAt: string | null;
          }>(response);
          if (cancelled) return;

          const remoteState = parseHouseholdState(remote.state);
          if (remoteState) {
            setRecords(remoteState.records);
            setManualExpenses(remoteState.manualExpenses);
            setSimulation({ ...defaultSimulation, ...remoteState.simulation });
            setLifePlan(remoteState.lifePlan);
            setFileName(remoteState.fileName || "保存済み明細");
            setIsDemo(false);
            revisionRef.current = remote.revision;
            lastSavedJsonRef.current = JSON.stringify(remoteState);
            setSyncStatus("saved");
            localStorage.removeItem(STORAGE_KEY);
            return;
          }

          const legacyText = localStorage.getItem(STORAGE_KEY);
          const legacyState = legacyText ? parseHouseholdState(JSON.parse(legacyText)) : null;
          if (legacyState) {
            const saved = await saveRemoteState(legacyState, null);
            if (cancelled) return;
            setRecords(legacyState.records);
            setManualExpenses(legacyState.manualExpenses);
            setSimulation({ ...defaultSimulation, ...legacyState.simulation });
            setLifePlan(legacyState.lifePlan);
            setFileName(legacyState.fileName || "移行済み明細");
            setIsDemo(false);
            revisionRef.current = saved.revision;
            lastSavedJsonRef.current = JSON.stringify(legacyState);
            localStorage.removeItem(STORAGE_KEY);
            setNotice("端末内の保存データをGoogle Sheetsへ移行しました。");
          }
          setSyncStatus("saved");
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
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [router]);

  useEffect(() => {
    if (!hydrated || isDemo) return;
    const state: HouseholdState = { records, manualExpenses, simulation, lifePlan, fileName };
    const serialized = JSON.stringify(state);
    if (serialized === lastSavedJsonRef.current) return;

    const timer = window.setTimeout(() => {
      setSyncStatus("saving");
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        try {
          const saved = await saveRemoteState(state, revisionRef.current);
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
  }, [records, manualExpenses, simulation, lifePlan, fileName, hydrated, isDemo, router]);

  const amexAmount = useMemo(
    () => records.filter((record) => record.included).reduce((sum, record) => sum + record.amount, 0),
    [records],
  );
  const manualAmount = useMemo(
    () => manualExpenses.reduce((sum, expense) => sum + expenseCharge(expense), 0),
    [manualExpenses],
  );
  const settlementTotal = amexAmount + manualAmount;
  const perPersonSettlement = Math.round(settlementTotal / 2);
  const includedCount = records.filter((record) => record.included).length;
  const excludedCount = records.filter((record) => !record.included).length;

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
      setSimulation((current) => ({ ...current, amexMonthly: nextAmexAmount }));
      setNotice(`${nextRecords.length}件を確認し、${nextRecords.filter((row) => row.included).length}件を請求対象にしました。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ファイルの読み込みに失敗しました。");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleRecord = (id: string) => {
    setIsDemo(false);
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
    setManualForm({ label: "", category: "other", amount: "", shareRate: "100", recurring: false });
    setError(null);
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
    if (!window.confirm("Google Sheetsに保存したデータを消去して、サンプル表示に戻しますか？")) return;
    try {
      const response = await fetch("/api/state", {
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
      setIsDemo(true);
      setSyncStatus("saved");
      setNotice("Google Sheetsの保存データを消去し、サンプル表示に戻しました。");
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
          <button className={view === "settlement" ? "active" : ""} onClick={() => setView("settlement")}>今月の精算</button>
          <button className={view === "simulation" ? "active" : ""} onClick={() => setView("simulation")}>将来支出</button>
          <button className={view === "lifeplan" ? "active" : ""} onClick={() => setView("lifeplan")}>ライフプラン</button>
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
                <p className="eyebrow">MONTHLY SETTLEMENT</p>
                <h1 id="settlement-title">今月、ふたりで<br />精算する金額。</h1>
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
                <button className="text-action" onClick={applyActualsToSimulation}>この実績から将来を試す <span>→</span></button>
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
                      ) : records.map((record) => (
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
                      <div className="manual-amount"><strong>{formatYen(expenseCharge(expense))}</strong><button aria-label={`${expense.label}を削除`} onClick={() => { setIsDemo(false); setManualExpenses((current) => current.filter((item) => item.id !== expense.id)); }}>×</button></div>
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
        ) : (
          <LifePlanPanel value={lifePlan} onChange={updateLifePlan} />
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

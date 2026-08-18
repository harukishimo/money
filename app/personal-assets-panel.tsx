"use client";

import { useMemo, useState } from "react";
import { formatYen } from "./lib/finance";
import {
  calculatePersonalFinance,
  type PersonalAssetsState,
  type PersonalMonthSummary,
} from "./lib/personal-assets";
import { formatMonthLabel, isMonthKey } from "./lib/state";

interface PersonalAssetsPanelProps {
  state: PersonalAssetsState;
  monthSummaries: PersonalMonthSummary[];
  savedMonthKeys: string[];
  selectedMonth: string;
  onMonthChange: (monthKey: string) => void;
  onChange: (state: PersonalAssetsState) => void;
  onLogout: () => void;
  monthLoading: boolean;
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function moneyValue(value: string) {
  const amount = Number(value.replaceAll(",", ""));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export default function PersonalAssetsPanel({
  state,
  monthSummaries,
  savedMonthKeys,
  selectedMonth,
  onMonthChange,
  onChange,
  onLogout,
  monthLoading,
}: PersonalAssetsPanelProps) {
  const [accountForm, setAccountForm] = useState({ name: "", balance: "" });
  const [investmentForm, setInvestmentForm] = useState({ name: "", amount: "", valuation: "", profitLossRate: "0" });
  const [expenseForm, setExpenseForm] = useState({ monthKey: selectedMonth, label: "", amount: "" });
  const monthOptions = useMemo(
    () => [...new Set([selectedMonth, ...savedMonthKeys, ...monthSummaries.map((summary) => summary.monthKey), ...state.personalExpenses.map((expense) => expense.monthKey)])].sort().reverse(),
    [monthSummaries, savedMonthKeys, selectedMonth, state.personalExpenses],
  );
  const selectedSummary = monthSummaries.find((summary) => summary.monthKey === selectedMonth) ?? {
    monthKey: selectedMonth,
    claimAmount: 0,
    amexStatementAmount: 0,
    otherAmount: 0,
  };
  const result = calculatePersonalFinance(state, selectedSummary);
  const maxProjection = Math.max(...result.monthlyProjection.map((row) => Math.abs(row.estimatedAssets)), 1);

  const addAccount = () => {
    const balance = moneyValue(accountForm.balance);
    if (!accountForm.name.trim() || balance === null) return;
    const id = makeId("account");
    onChange({
      ...state,
      accounts: [...state.accounts, { id, name: accountForm.name.trim(), balance }],
      mainAccountId: state.mainAccountId ?? (state.accounts.length === 0 ? id : null),
    });
    setAccountForm({ name: "", balance: "" });
  };

  const removeAccount = (id: string) => {
    const nextAccounts = state.accounts.filter((account) => account.id !== id);
    onChange({
      ...state,
      accounts: nextAccounts,
      mainAccountId: state.mainAccountId === id ? (nextAccounts[0]?.id ?? null) : state.mainAccountId,
    });
  };

  const addInvestment = () => {
    const amount = moneyValue(investmentForm.amount);
    const valuation = moneyValue(investmentForm.valuation);
    const profitLossRate = Number(investmentForm.profitLossRate);
    if (!investmentForm.name.trim() || amount === null || valuation === null || !Number.isFinite(profitLossRate) || profitLossRate < -100 || profitLossRate > 1000) return;
    onChange({
      ...state,
      investments: [...state.investments, {
        id: makeId("investment"),
        name: investmentForm.name.trim(),
        amount,
        valuation,
        profitLossRate,
      }],
    });
    setInvestmentForm({ name: "", amount: "", valuation: "", profitLossRate: "0" });
  };

  const addExpense = () => {
    const amount = moneyValue(expenseForm.amount);
    if (!isMonthKey(expenseForm.monthKey) || !expenseForm.label.trim() || amount === null) return;
    onChange({
      ...state,
      personalExpenses: [...state.personalExpenses, {
        id: makeId("personal-expense"),
        monthKey: expenseForm.monthKey,
        label: expenseForm.label.trim(),
        amount,
      }],
    });
    setExpenseForm({ monthKey: expenseForm.monthKey, label: "", amount: "" });
  };

  return (
    <section className="personal-assets-page" aria-labelledby="personal-assets-title" aria-busy={monthLoading}>
      <div className="simulation-intro personal-assets-intro">
        <div>
          <p className="eyebrow">PRIVATE ASSETS / CASH FLOW</p>
          <h1 id="personal-assets-title">自分のお金が、<br />どう増えるか。</h1>
        </div>
        <div className="personal-assets-intro-actions">
          <p>共有家計とは分離した個人用の資産管理です。選択月の請求額と登録済み費用から、残るお金と将来の資産推移を試算します。</p>
          <button className="secondary-button" onClick={onLogout}>個人資産をロック</button>
        </div>
      </div>

      <div className="personal-month-toolbar">
        <label>収支を確認する月<select value={selectedMonth} onChange={(event) => { onMonthChange(event.target.value); setExpenseForm((current) => ({ ...current, monthKey: event.target.value })); }}>
          {monthOptions.map((monthKey) => <option key={monthKey} value={monthKey}>{formatMonthLabel(monthKey)}</option>)}
        </select></label>
        <span>請求額・Amex・共有費用は月次データから取得。給与・口座・個人支出は月別、予備資金・投資状況は月を跨いで保存</span>
      </div>

      <div className={`personal-assets-layout${monthLoading ? " is-loading" : ""}`}>
        {monthLoading && <div className="personal-month-loading">{formatMonthLabel(selectedMonth)}の個人資産を読み込んでいます…</div>}
        <aside className="personal-input-panel">
          <div className="section-heading compact"><div><p className="section-number">01</p><h2>個人資産を入力</h2></div></div>
          <div className="personal-base-form">
            <label>自分の月給<div className="input-with-suffix"><input type="number" min="0" value={state.monthlySalary} onChange={(event) => onChange({ ...state, monthlySalary: Math.max(0, Number(event.target.value) || 0) })} /><span>円</span></div></label>
            <label>手元に残す予備資金<div className="input-with-suffix"><input aria-label="手元に残す予備資金" type="number" min="0" value={state.reserveTarget} onChange={(event) => onChange({ ...state, reserveTarget: Math.max(0, Number(event.target.value) || 0) })} /><span>円</span></div></label>
          </div>
          <p className="detail-note personal-reserve-note">予備資金は月を跨いでも共通設定として保持されます。いつでも自由に変更できます。</p>

          <details open>
            <summary>口座残高・メイン口座</summary>
            <p className="detail-note">メイン口座を1つ選ぶと、給料・請求額を除いた残高と当月の残額を計算します。</p>
            <div className="personal-form-row">
              <input value={accountForm.name} placeholder="口座名" onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} />
              <input inputMode="numeric" value={accountForm.balance} placeholder="残高" onChange={(event) => setAccountForm({ ...accountForm, balance: event.target.value })} />
              <button className="secondary-button" onClick={addAccount}>追加</button>
            </div>
            <div className="personal-entry-list">
              {state.accounts.map((account) => (
                <div key={account.id}>
                  <label className="main-account-option">
                    <input
                      type="radio"
                      name="main-account"
                      checked={state.mainAccountId === account.id}
                      onChange={() => onChange({ ...state, mainAccountId: account.id })}
                    />
                    <span>{account.name}<small>{state.mainAccountId === account.id ? "メイン口座" : "その他の口座"}</small></span>
                  </label>
                  <strong>{formatYen(account.balance)}</strong>
                  <button aria-label={`${account.name}を削除`} onClick={() => removeAccount(account.id)}>×</button>
                </div>
              ))}
              {state.accounts.length === 0 && <p className="empty-note">口座残高を登録してください。</p>}
            </div>
          </details>

          <details open>
            <summary>投資状況（全月共通）</summary>
            <div className="personal-form-stack">
              <input value={investmentForm.name} placeholder="銘柄名・投資先" onChange={(event) => setInvestmentForm({ ...investmentForm, name: event.target.value })} />
              <div className="personal-form-row investment-form-row">
                <input inputMode="numeric" value={investmentForm.amount} placeholder="投資元本" onChange={(event) => setInvestmentForm({ ...investmentForm, amount: event.target.value })} />
                <input inputMode="numeric" value={investmentForm.valuation} placeholder="評価額" onChange={(event) => setInvestmentForm({ ...investmentForm, valuation: event.target.value })} />
                <div className="input-with-suffix"><input type="number" step="0.1" value={investmentForm.profitLossRate} placeholder="評価損益率" onChange={(event) => setInvestmentForm({ ...investmentForm, profitLossRate: event.target.value })} /><span>%</span></div>
                <button className="secondary-button" onClick={addInvestment}>追加</button>
              </div>
            </div>
            <div className="personal-entry-list personal-investment-entry-list">
              {state.investments.map((investment) => (
                <div key={investment.id}><span>{investment.name}<small>評価損益率 {investment.profitLossRate}%</small></span><strong>{formatYen(investment.amount)}<small>元本</small></strong><strong>{formatYen(investment.valuation)}<small>評価額</small></strong><button aria-label={`${investment.name}を削除`} onClick={() => onChange({ ...state, investments: state.investments.filter((item) => item.id !== investment.id) })}>×</button></div>
              ))}
              {state.investments.length === 0 && <p className="empty-note">投資元本・評価額・評価損益率を登録してください。</p>}
            </div>
          </details>

          <details open>
            <summary>個人支出（月を選んで登録）</summary>
            <div className="personal-form-stack">
              <label className="personal-small-label">利用月<input type="month" value={expenseForm.monthKey} onChange={(event) => setExpenseForm({ ...expenseForm, monthKey: event.target.value })} /></label>
              <input value={expenseForm.label} placeholder="例：趣味、個人旅行" onChange={(event) => setExpenseForm({ ...expenseForm, label: event.target.value })} />
              <div className="personal-form-row">
                <input inputMode="numeric" value={expenseForm.amount} placeholder="金額" onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} />
                <button className="secondary-button" onClick={addExpense}>追加</button>
              </div>
            </div>
            <div className="personal-entry-list">
              {state.personalExpenses.map((expense) => (
                <div key={expense.id}><span>{formatMonthLabel(expense.monthKey)}・{expense.label}</span><strong>{formatYen(expense.amount)}</strong><button aria-label={`${expense.label}を削除`} onClick={() => onChange({ ...state, personalExpenses: state.personalExpenses.filter((item) => item.id !== expense.id) })}>×</button></div>
              ))}
              {state.personalExpenses.length === 0 && <p className="empty-note">月次締め後でも個人分だけ追加できます。</p>}
            </div>
          </details>
        </aside>

        <div className="personal-results">
          <div className="personal-formula-card">
            <p className="section-number">02 / MONTHLY CASH FLOW</p>
            <h2>今月、残るお金</h2>
            <strong className={result.remainingMoney < 0 ? "personal-negative" : ""}>{formatYen(result.remainingMoney)}</strong>
            <p>（メイン口座の基礎残高 {formatYen(result.mainAccountBaseBalance)} ＋ 自分の給料 {formatYen(result.salary)} ＋ 請求額 {formatYen(result.claimAmount)}）− Amex全明細 {formatYen(result.amexStatementAmount)} − その他 {formatYen(result.otherAmount)}</p>
            <div className="personal-cashflow-breakdown">
              <div><span>メイン口座全額</span><strong>{formatYen(result.mainAccountBalance)}</strong></div>
              <div><span>給料・請求額を除いた残高</span><strong>{formatYen(result.mainAccountBaseBalance)}</strong></div>
              <div><span>共有費用</span><strong>{formatYen(result.sharedOtherAmount)}</strong></div>
              <div><span>個人支出</span><strong>{formatYen(result.personalExpenseAmount)}</strong></div>
              <div><span>対象月</span><strong>{formatMonthLabel(selectedMonth)}</strong></div>
            </div>
          </div>

          <div className="personal-kpis">
            <div><span>口座残高合計</span><strong>{formatYen(result.accountTotal)}</strong></div>
            <div><span>投資元本合計</span><strong>{formatYen(result.investmentPrincipal)}</strong></div>
            <div><span>現時点の総資産</span><strong>{formatYen(result.totalAssets)}</strong><small>{state.mainAccountId ? "その他口座＋投資元本＋メイン口座の残額" : "口座＋投資元本＋残るお金"}</small></div>
            <div><span>投資に使える金額</span><strong>{formatYen(result.investableAmount)}</strong><small>予備資金 {formatYen(result.reserveTarget)}を確保後</small></div>
          </div>

          <div className="personal-investment-card">
            <div className="section-heading compact"><div><p className="section-number">03</p><h2>投資に使える金額の配分</h2></div><span>インカム：キャピタル = 8：2</span></div>
            <div className="personal-allocation-grid">
              <div><span>インカムゲイン側</span><strong>{formatYen(result.incomeGainBudget)}</strong><small>80%</small></div>
              <div><span>キャピタルゲイン側</span><strong>{formatYen(result.capitalGainBudget)}</strong><small>20%</small></div>
            </div>
            <p className="detail-note">投資に使える金額は、総資産から設定した予備資金を引いた金額です。配分は試算上の目安で、実際の購入判断や投資助言ではありません。</p>
          </div>

          <div className="personal-investment-card">
            <div className="section-heading compact"><div><p className="section-number">04</p><h2>投資の現在状態</h2></div><span>評価損益目安 {formatYen(result.investmentGain)}</span></div>
            {state.investments.length === 0 ? <p className="empty-note">投資を登録すると、元本・評価額・評価損益率を表示します。</p> : (
              <div className="personal-investment-table">
                {state.investments.map((investment) => {
                  return <div key={investment.id}><span>{investment.name}<small>評価損益率 {investment.profitLossRate}%</small></span><strong>{formatYen(investment.amount)}<small>投資元本</small></strong><strong>{formatYen(investment.valuation)}<small>評価額</small></strong></div>;
                })}
              </div>
            )}
            <p className="detail-note">総資産と投資可能額は従来どおり投資元本で計算し、評価額・評価損益率は現在の投資状態として表示します。</p>
          </div>

          <div className="personal-forecast-card">
            <div className="section-heading compact"><div><p className="section-number">05</p><h2>今後12か月の貯まり具合</h2></div><span>選択月の残額が続く前提</span></div>
            <div className="personal-forecast-list">
              {result.monthlyProjection.map((row) => (
                <div className={row.estimatedAssets < 0 ? "personal-forecast-row negative" : "personal-forecast-row"} key={row.monthKey}>
                  <span>{row.label}</span><div><i style={{ width: `${Math.max(3, Math.min(100, Math.abs(row.estimatedAssets) / maxProjection * 100))}%` }} /></div><strong>{formatYen(row.estimatedAssets)}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

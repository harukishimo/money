"use client";

import { useMemo, useState } from "react";
import { formatYen } from "./lib/finance";
import {
  buildLifePlan,
  type EducationPath,
  type EventPayer,
  type LifePlanChild,
  type LifePlanEvent,
  type LifePlanInputs,
  type LifePlanPerson,
  type LifePlanScenario,
} from "./lib/life-plan";

interface LifePlanPanelProps {
  value: LifePlanInputs;
  onChange: (value: LifePlanInputs) => void;
}

const scenarios: { key: LifePlanScenario; label: string; note: string }[] = [
  { key: "pessimistic", label: "悲観", note: "物価高・収入と運用は低め" },
  { key: "base", label: "基準", note: "入力した前提どおり" },
  { key: "optimistic", label: "楽観", note: "収入と運用は高め" },
];

const educationLabels: Record<EducationPath, string> = {
  public: "公立中心",
  mixed: "高校・大学は私立",
  private: "私立中心",
};

const payerLabels: Record<EventPayer, string> = {
  household: "二人の共通費",
  personA: "本人",
  personB: "パートナー",
};

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function signedYen(value: number) {
  return `${value >= 0 ? "+" : ""}${formatYen(value)}`;
}

export default function LifePlanPanel({ value, onChange }: LifePlanPanelProps) {
  const [scenario, setScenario] = useState<LifePlanScenario>("base");
  const [eventForm, setEventForm] = useState<Omit<LifePlanEvent, "id">>({
    label: "",
    startMonth: 12,
    oneOffAmount: 0,
    monthlyAmount: 0,
    durationMonths: 0,
    payer: "household",
  });
  const [childForm, setChildForm] = useState<Omit<LifePlanChild, "id">>({
    name: "",
    birthMonthOffset: 0,
    path: "public",
    costMultiplier: 1,
  });

  const results = useMemo(() => Object.fromEntries(
    scenarios.map(({ key }) => [key, buildLifePlan(value, key)]),
  ) as Record<LifePlanScenario, ReturnType<typeof buildLifePlan>>, [value]);
  const result = results[scenario];
  const chartRows = result.annual;
  const chartMaximum = Math.max(1, ...chartRows.flatMap((row) => [row.income, row.spending]));
  const importantRows = useMemo(() => {
    const selected = new Map<number, (typeof result.rows)[number]>();
    result.rows.slice(0, 12).forEach((row) => selected.set(row.month, row));
    result.rows.filter((row) => row.eventLabels.length > 0).forEach((row) => selected.set(row.month, row));
    if (result.firstCashPressure) selected.set(result.firstCashPressure.month, result.firstCashPressure);
    if (result.firstShortfall) selected.set(result.firstShortfall.month, result.firstShortfall);
    return [...selected.values()].sort((a, b) => a.month - b.month).slice(0, 30);
  }, [result]);

  const update = <Key extends keyof LifePlanInputs>(key: Key, next: LifePlanInputs[Key]) => {
    onChange({ ...value, [key]: next });
  };

  const updatePerson = <Key extends keyof LifePlanPerson>(index: 0 | 1, key: Key, next: LifePlanPerson[Key]) => {
    const people: [LifePlanPerson, LifePlanPerson] = [{ ...value.people[0] }, { ...value.people[1] }];
    people[index][key] = next;
    update("people", people);
  };

  const addEvent = () => {
    if (!eventForm.label.trim()) return;
    update("events", [...value.events, { ...eventForm, id: makeId("event"), label: eventForm.label.trim() }]);
    setEventForm({ label: "", startMonth: 12, oneOffAmount: 0, monthlyAmount: 0, durationMonths: 0, payer: "household" });
  };

  const addChild = () => {
    if (!childForm.name.trim()) return;
    update("children", [...value.children, { ...childForm, id: makeId("child"), name: childForm.name.trim() }]);
    setChildForm({ name: "", birthMonthOffset: 0, path: "public", costMultiplier: 1 });
  };

  const warningRow = result.firstShortfall ?? result.firstCashPressure;

  return (
    <section className="life-plan-page" aria-labelledby="life-plan-title">
      <div className="simulation-intro life-plan-intro">
        <div>
          <p className="eyebrow">LIFE PLAN</p>
          <h1 id="life-plan-title">ふたりの未来を、<br />月ごとに見通す。</h1>
        </div>
        <p>収入・生活費・イベント・住宅・教育・老後・運用を、最大50年先まで同じ月次モデルで計算します。カードの精算額とは別の世帯キャッシュフローです。</p>
      </div>

      <div className="life-scenario-tabs" aria-label="ライフプランシナリオ">
        {scenarios.map((item) => {
          const scenarioResult = results[item.key];
          return (
            <button key={item.key} className={scenario === item.key ? "active" : ""} onClick={() => setScenario(item.key)}>
              <span>{item.label}<small>{item.note}</small></span>
              <strong>{formatYen(scenarioResult.endingNetWorth)}<small>{value.months / 12}年後の純資産</small></strong>
              <em>{scenarioResult.firstShortfall ? `${scenarioResult.firstShortfall.label}に不足` : "資産不足なし"}</em>
            </button>
          );
        })}
      </div>

      {warningRow ? (
        <div className={`plan-alert ${result.firstShortfall ? "danger" : "warning"}`} role="status">
          <strong>{result.firstShortfall ? "資金不足の可能性" : "現金余力が低下"}</strong>
          <span>{warningRow.label}：{warningRow.eventLabels.join("・") || "通常支出または収入変化"}の前後で、最低現金残高を維持できなくなります。</span>
        </div>
      ) : (
        <div className="plan-alert safe" role="status"><strong>計画期間内の資金不足なし</strong><span>入力した前提では最低現金残高を維持できます。</span></div>
      )}

      <div className="life-plan-layout">
        <aside className="life-inputs" aria-label="ライフプランの前提入力">
          <div className="section-heading compact"><div><p className="section-number">01</p><h2>前提を入力</h2></div></div>
          <p className="input-note">変更内容は他の家計データと一緒にGoogle Sheetsへ保存されます。</p>

          <details open>
            <summary>基本・現在資産</summary>
            <div className="plan-fields">
              <label>開始月<input type="month" value={value.startMonth} onChange={(event) => { if (event.target.value) update("startMonth", event.target.value); }} /></label>
              <label>計画期間<select value={value.months} onChange={(event) => update("months", Number(event.target.value))}>
                <option value={120}>10年</option><option value={240}>20年</option><option value={360}>30年</option><option value={480}>40年</option><option value={600}>50年</option>
              </select></label>
              <PlanMoneyField label="現在の現預金" value={value.currentCash} onChange={(next) => update("currentCash", next)} />
              <PlanMoneyField label="現在の投資残高" value={value.currentInvestments} onChange={(next) => update("currentInvestments", next)} />
              <PlanMoneyField label="最低残したい現金" value={value.minimumCash} onChange={(next) => update("minimumCash", next)} />
              <PlanNumberField label="年間物価上昇率" value={value.annualInflationRate} suffix="%" step={0.1} onChange={(next) => update("annualInflationRate", next)} />
            </div>
          </details>

          <details open>
            <summary>二人の収入・老後</summary>
            {value.people.map((person, index) => (
              <div className="person-input-card" key={index}>
                <label>表示名<input value={person.name} onChange={(event) => updatePerson(index as 0 | 1, "name", event.target.value)} /></label>
                <div className="plan-fields">
                  <PlanNumberField label="現在年齢" value={person.currentAge} suffix="歳" min={0} max={100} onChange={(next) => updatePerson(index as 0 | 1, "currentAge", next)} />
                  <PlanMoneyField label="月間手取り" value={person.monthlyTakeHome} onChange={(next) => updatePerson(index as 0 | 1, "monthlyTakeHome", next)} />
                  <PlanMoneyField label="年間賞与手取り" value={person.annualBonus} onChange={(next) => updatePerson(index as 0 | 1, "annualBonus", next)} />
                  <PlanNumberField label="賞与月" value={person.bonusMonth} suffix="月" min={1} max={12} onChange={(next) => updatePerson(index as 0 | 1, "bonusMonth", next)} />
                  <PlanNumberField label="年間昇給率" value={person.annualIncomeGrowthRate} suffix="%" step={0.1} onChange={(next) => updatePerson(index as 0 | 1, "annualIncomeGrowthRate", next)} />
                  <PlanMoneyField label="個人固定費" value={person.personalFixedMonthly} onChange={(next) => updatePerson(index as 0 | 1, "personalFixedMonthly", next)} />
                  <PlanNumberField label="退職年齢" value={person.retirementAge} suffix="歳" min={18} max={100} onChange={(next) => updatePerson(index as 0 | 1, "retirementAge", next)} />
                  <PlanNumberField label="年金開始年齢" value={person.pensionStartAge} suffix="歳" min={18} max={100} onChange={(next) => updatePerson(index as 0 | 1, "pensionStartAge", next)} />
                  <PlanMoneyField label="月間年金手取り" value={person.monthlyPension} onChange={(next) => updatePerson(index as 0 | 1, "monthlyPension", next)} />
                </div>
              </div>
            ))}
            <div className="plan-fields">
              <PlanMoneyField label="その他の月間収入" value={value.otherIncomeMonthly} onChange={(next) => update("otherIncomeMonthly", next)} />
              <PlanMoneyField label="二人退職後の生活費" value={value.retirementLivingMonthly} onChange={(next) => update("retirementLivingMonthly", next)} />
              <PlanMoneyField label="老後の医療・介護予備費" value={value.retirementCareMonthly} onChange={(next) => update("retirementCareMonthly", next)} />
            </div>
          </details>

          <details>
            <summary>生活費・負担割合</summary>
            <div className="plan-fields">
              <PlanMoneyField label="世帯固定費（住居除く）" value={value.monthlyFixedExpenses} onChange={(next) => update("monthlyFixedExpenses", next)} />
              <PlanMoneyField label="世帯変動費" value={value.monthlyVariableExpenses} onChange={(next) => update("monthlyVariableExpenses", next)} />
              <PlanNumberField label="変動費のうち必須割合" value={value.essentialVariableRate} suffix="%" min={0} max={100} onChange={(next) => update("essentialVariableRate", next)} />
              <label>共通費の分担<select value={value.splitMethod} onChange={(event) => update("splitMethod", event.target.value as LifePlanInputs["splitMethod"])}>
                <option value="disposable">可処分手取り比例</option><option value="equal">50%ずつ</option><option value="custom">任意割合</option>
              </select></label>
              {value.splitMethod === "custom" && <PlanNumberField label={`${value.people[0].name}の割合`} value={value.customPersonARate} suffix="%" min={0} max={100} onChange={(next) => update("customPersonARate", next)} />}
            </div>
          </details>

          <details>
            <summary>貯蓄・資産運用・緊急資金</summary>
            <div className="plan-fields">
              <PlanMoneyField label="毎月の投資積立" value={value.monthlyInvestment} onChange={(next) => update("monthlyInvestment", next)} />
              <PlanNumberField label="年間期待利回り" value={value.annualInvestmentReturn} suffix="%" step={0.1} onChange={(next) => update("annualInvestmentReturn", next)} />
              <PlanNumberField label="年間手数料率" value={value.annualInvestmentFee} suffix="%" step={0.1} min={0} onChange={(next) => update("annualInvestmentFee", next)} />
              <PlanNumberField label="緊急資金の目標" value={value.emergencyTargetMonths} suffix="か月" min={1} onChange={(next) => update("emergencyTargetMonths", next)} />
            </div>
            <p className="detail-note">現金が最低残高を下回る月は、まず投資資産を取り崩します。余力がない月は積立額を自動で減額します。</p>
          </details>

          <details>
            <summary>ライフイベント</summary>
            <div className="item-list compact-list">
              {value.events.map((event) => (
                <div key={event.id}><span>{event.startMonth}か月目・{payerLabels[event.payer]}</span><strong>{event.label}</strong><small>一時 {formatYen(event.oneOffAmount)} / 毎月 {formatYen(event.monthlyAmount)}{event.durationMonths === 0 ? "・終了なし" : `・${event.durationMonths}か月`}</small><button aria-label={`${event.label}を削除`} onClick={() => update("events", value.events.filter((item) => item.id !== event.id))}>×</button></div>
              ))}
            </div>
            <div className="plan-fields event-form">
              <label className="wide-field">イベント名<input maxLength={100} placeholder="例：引越し、結婚、車購入" value={eventForm.label} onChange={(event) => setEventForm({ ...eventForm, label: event.target.value })} /></label>
              <PlanNumberField label="発生月（開始から）" value={eventForm.startMonth} suffix="か月目" min={1} max={value.months} onChange={(next) => setEventForm({ ...eventForm, startMonth: next })} />
              <PlanMoneyField label="一時費用" value={eventForm.oneOffAmount} onChange={(next) => setEventForm({ ...eventForm, oneOffAmount: next })} />
              <PlanMoneyField label="継続する月額" value={eventForm.monthlyAmount} onChange={(next) => setEventForm({ ...eventForm, monthlyAmount: next })} />
              <PlanNumberField label="継続月数（0は終了なし）" value={eventForm.durationMonths} suffix="か月" min={0} max={value.months} onChange={(next) => setEventForm({ ...eventForm, durationMonths: next })} />
              <label>負担者<select value={eventForm.payer} onChange={(event) => setEventForm({ ...eventForm, payer: event.target.value as EventPayer })}>
                <option value="household">二人の共通費</option><option value="personA">本人</option><option value="personB">パートナー</option>
              </select></label>
              <button className="secondary-button wide-field" disabled={!eventForm.label.trim() || (eventForm.oneOffAmount <= 0 && eventForm.monthlyAmount <= 0)} onClick={addEvent}>イベントを追加</button>
            </div>
          </details>

          <details>
            <summary>住宅計画</summary>
            <div className="plan-fields">
              <label>計画へ反映する住まい<select value={value.housing.mode} onChange={(event) => update("housing", { ...value.housing, mode: event.target.value as LifePlanInputs["housing"]["mode"] })}>
                <option value="rent">賃貸を継続</option><option value="buy">指定月に購入</option>
              </select></label>
              <PlanMoneyField label="現在の月額家賃" value={value.housing.rentMonthly} onChange={(next) => update("housing", { ...value.housing, rentMonthly: next })} />
              <PlanNumberField label="年間家賃上昇率" value={value.housing.rentAnnualGrowthRate} suffix="%" step={0.1} onChange={(next) => update("housing", { ...value.housing, rentAnnualGrowthRate: next })} />
              <PlanNumberField label="購入する月" value={value.housing.purchaseMonth} suffix="か月目" min={1} max={value.months} onChange={(next) => update("housing", { ...value.housing, purchaseMonth: next })} />
              <PlanMoneyField label="物件価格" value={value.housing.propertyPrice} onChange={(next) => update("housing", { ...value.housing, propertyPrice: next })} />
              <PlanMoneyField label="頭金" value={value.housing.downPayment} onChange={(next) => update("housing", { ...value.housing, downPayment: next })} />
              <PlanMoneyField label="購入諸費用" value={value.housing.purchaseCosts} onChange={(next) => update("housing", { ...value.housing, purchaseCosts: next })} />
              <PlanNumberField label="年間ローン金利" value={value.housing.annualInterestRate} suffix="%" step={0.1} min={0} onChange={(next) => update("housing", { ...value.housing, annualInterestRate: next })} />
              <PlanNumberField label="ローン期間" value={value.housing.loanYears} suffix="年" min={1} max={50} onChange={(next) => update("housing", { ...value.housing, loanYears: next })} />
              <PlanMoneyField label="月額維持・修繕費" value={value.housing.monthlyMaintenance} onChange={(next) => update("housing", { ...value.housing, monthlyMaintenance: next })} />
              <PlanMoneyField label="年間固定資産税等" value={value.housing.annualPropertyTax} onChange={(next) => update("housing", { ...value.housing, annualPropertyTax: next })} />
              <PlanNumberField label="年間物件価格変化率" value={value.housing.annualPropertyGrowthRate} suffix="%" step={0.1} onChange={(next) => update("housing", { ...value.housing, annualPropertyGrowthRate: next })} />
            </div>
            <p className="detail-note">賃貸と購入の比較は、購入後の住宅価値−ローン残高を持分として差し引きます。税控除、売却費、運用機会損失は未反映です。</p>
          </details>

          <details>
            <summary>教育費計画</summary>
            <div className="plan-fields">
              <PlanNumberField label="年間教育費上昇率" value={value.educationInflationRate} suffix="%" step={0.1} onChange={(next) => update("educationInflationRate", next)} />
            </div>
            <div className="item-list compact-list">
              {value.children.map((child) => (
                <div key={child.id}><span>{child.birthMonthOffset >= 0 ? `${child.birthMonthOffset}か月後に誕生` : `開始時点で約${Math.floor(Math.abs(child.birthMonthOffset) / 12)}歳`}</span><strong>{child.name}</strong><small>{educationLabels[child.path]}・基準額×{child.costMultiplier}</small><button aria-label={`${child.name}を削除`} onClick={() => update("children", value.children.filter((item) => item.id !== child.id))}>×</button></div>
              ))}
            </div>
            <div className="plan-fields event-form">
              <label className="wide-field">子どもの表示名<input maxLength={100} placeholder="例：第一子" value={childForm.name} onChange={(event) => setChildForm({ ...childForm, name: event.target.value })} /></label>
              <PlanNumberField label="誕生は何か月後" value={childForm.birthMonthOffset} suffix="か月" min={-360} max={value.months} onChange={(next) => setChildForm({ ...childForm, birthMonthOffset: next })} />
              <label>進路プリセット<select value={childForm.path} onChange={(event) => setChildForm({ ...childForm, path: event.target.value as EducationPath })}>
                <option value="public">公立中心</option><option value="mixed">高校・大学は私立</option><option value="private">私立中心</option>
              </select></label>
              <PlanNumberField label="費用倍率" value={childForm.costMultiplier} suffix="倍" min={0} max={10} step={0.1} onChange={(next) => setChildForm({ ...childForm, costMultiplier: next })} />
              <button className="secondary-button wide-field" disabled={!childForm.name.trim()} onClick={addChild}>子どもを追加</button>
            </div>
            <p className="detail-note">既に5歳なら「-60か月」のように入力します。費用は幼児教育〜大学までの概算プリセットです。</p>
          </details>
        </aside>

        <div className="life-results">
          <div className="life-kpis">
            <div><span>初月の収支</span><strong className={result.rows[0].monthlyBalance < 0 ? "negative" : ""}>{signedYen(result.rows[0].monthlyBalance)}</strong></div>
            <div><span>{value.months / 12}年後の現預金</span><strong className={result.endingCash < value.minimumCash ? "negative" : ""}>{formatYen(result.endingCash)}</strong></div>
            <div><span>{value.months / 12}年後の純資産</span><strong className={result.endingNetWorth < 0 ? "negative" : ""}>{formatYen(result.endingNetWorth)}</strong></div>
            <div><span>生活防衛資金</span><strong>{result.emergency.coveredMonths.toFixed(1)}か月</strong><small className={`emergency-${result.emergency.status}`}>目標 {result.emergency.targetMonths}か月</small></div>
          </div>

          <section className="result-card allocation-card">
            <div className="chart-heading"><div><p className="section-number">02</p><h2>二人の負担目安</h2></div><span>{value.splitMethod === "disposable" ? "可処分手取り比例" : value.splitMethod === "equal" ? "50%ずつ" : "任意割合"}</span></div>
            <div className="allocation-grid">
              {value.people.map((person, index) => (
                <div key={index}>
                  <span>{person.name}・共通費 {Math.round(result.allocation.rates[index] * 1000) / 10}%</span>
                  <strong>{formatYen(result.allocation.burdens[index])}</strong>
                  <small>初月の手取り後残額 {formatYen(result.allocation.remaining[index])}</small>
                </div>
              ))}
            </div>
            <p className="chart-note">共通費 {formatYen(result.allocation.commonExpense)} を設定方式で按分し、各自の個人固定費を加えています。</p>
          </section>

          <section className="result-card">
            <div className="chart-heading"><div><p className="section-number">03</p><h2>年ごとの収支と純資産</h2></div><span>{scenarios.find((item) => item.key === scenario)?.label}シナリオ</span></div>
            <div className="life-chart" role="img" aria-label="年ごとの収入、支出、純資産の比較">
              {chartRows.map((row) => (
                <div className="life-chart-row" key={row.year}>
                  <span>{row.label}</span>
                  <div className="double-bars">
                    <i className="income-bar" style={{ width: `${Math.max(1, row.income / chartMaximum * 100)}%` }} title={`収入 ${formatYen(row.income)}`} />
                    <i className="spending-bar" style={{ width: `${Math.max(1, row.spending / chartMaximum * 100)}%` }} title={`支出 ${formatYen(row.spending)}`} />
                  </div>
                  <strong className={row.endNetWorth < 0 ? "negative" : ""}>{formatYen(row.endNetWorth)}</strong>
                </div>
              ))}
            </div>
            <div className="chart-legend"><span><i className="income-key" />年間収入</span><span><i className="spending-key" />年間支出</span><span>右端：年末純資産</span></div>
          </section>

          <div className="plan-result-grid">
            <section className="result-card compact-result">
              <p className="section-number">04</p><h2>住宅：賃貸 vs 購入</h2>
              <dl><div><dt>賃貸累計</dt><dd>{formatYen(result.housingComparison.rentTotal)}</dd></div><div><dt>購入の現金流出</dt><dd>{formatYen(result.housingComparison.buyCashOut)}</dd></div><div><dt>購入後の持分</dt><dd>{formatYen(result.housingComparison.buyEquity)}</dd></div><div><dt>購入の実質コスト</dt><dd>{formatYen(result.housingComparison.buyNetCost)}</dd></div></dl>
              <p className="result-callout">この前提では<strong>{result.housingComparison.better === "rent" ? "賃貸" : "購入"}</strong>が約{formatYen(result.housingComparison.difference)}低コスト</p>
              <small>{result.housingComparison.breakEvenMonth ? `購入が逆転する目安：${result.housingComparison.breakEvenMonth}か月目` : "計画期間内に購入コストは賃貸を下回りません"}</small>
            </section>
            <section className="result-card compact-result">
              <p className="section-number">05</p><h2>教育・イベント・運用</h2>
              <dl><div><dt>教育費累計</dt><dd>{formatYen(result.totalEducationCost)}</dd></div><div><dt>イベント費累計</dt><dd>{formatYen(result.totalEventCost)}</dd></div><div><dt>期末投資残高</dt><dd>{formatYen(result.endingInvestments)}</dd></div><div><dt>うち投資元本</dt><dd>{formatYen(result.endingInvestmentPrincipal)}</dd></div><div><dt>運用損益</dt><dd className={result.endingInvestmentGain < 0 ? "negative" : ""}>{signedYen(result.endingInvestmentGain)}</dd></div><div><dt>必須生活費</dt><dd>{formatYen(result.emergency.essentialMonthly)}/月</dd></div></dl>
              <p className={`result-callout emergency-${result.emergency.status}`}>緊急資金：<strong>{result.emergency.status === "safe" ? "安全圏" : result.emergency.status === "warning" ? "注意" : "要対策"}</strong></p>
            </section>
          </div>

          <section className="result-card">
            <div className="chart-heading"><div><p className="section-number">06</p><h2>直近と重要な月</h2></div><span>最大30件</span></div>
            <div className="table-wrap plan-table-wrap"><table className="plan-table"><thead><tr><th>月</th><th className="number">収入</th><th className="number">支出</th><th className="number">月間収支</th><th className="number">現預金</th><th className="number">純資産</th><th>イベント・状態</th></tr></thead><tbody>
              {importantRows.map((row) => <tr key={row.month} className={row.shortfall ? "danger-row" : row.cashPressure ? "warning-row" : ""}><td><strong>{row.label}</strong><small>{row.month}か月目</small></td><td className="number">{formatYen(row.income)}</td><td className="number">{formatYen(row.spending)}</td><td className={`number ${row.monthlyBalance < 0 ? "negative" : ""}`}>{signedYen(row.monthlyBalance)}</td><td className="number">{formatYen(row.cash)}</td><td className="number">{formatYen(row.netWorth)}</td><td>{row.eventLabels.join("・") || (row.shortfall ? "資金不足" : row.cashPressure ? "積立減額／資産取崩し" : "—")}</td></tr>)}
            </tbody></table></div>
          </section>

          <p className="simulation-disclaimer">本機能は入力値に基づく概算です。税・社会保険、投資税制、住宅ローン控除、売却費、各種給付は含みません。金融・税務上の判断は専門家へ確認してください。</p>
        </div>
      </div>
    </section>
  );
}

function PlanMoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label>{label}<div className="input-with-suffix"><input type="number" min="0" value={value} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} /><span>円</span></div></label>;
}

function PlanNumberField({ label, value, suffix, min, max, step, onChange }: {
  label: string;
  value: number;
  suffix: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return <label>{label}<div className="input-with-suffix"><input type="number" min={min} max={max} step={step} value={value} onChange={(event) => {
    const parsed = Number(event.target.value) || 0;
    onChange(Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed)));
  }} /><span>{suffix}</span></div></label>;
}

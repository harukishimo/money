# ふたりの家計室

Amex明細と家賃・固定費をまとめ、月次精算額、将来支出、ふたりのライフプランを試算する個人用Next.jsアプリです。

現在のモックURL: https://new-chat-seven-mu.vercel.app

認証・Google Sheets対応版は、環境変数設定後にGitHub連携でProductionへ切り替えます。

## 現在の機能

- Amex `.xlsx` / `.csv` 取込
- `CHIHARU SATO`、ETC、前回分口座振替、H列優先の自動判定
- 家賃・固定費・その他費用の手入力と請求割合
- 節約・基準・ゆとりの将来シミュレーション
- 最長50年の世帯収入・支出・現預金・純資産予測
- 二人の可処分手取りに応じた共通費負担
- ライフイベント、緊急資金、資金不足アラート
- 賃貸と住宅購入の比較、教育費、退職・年金、資産運用
- 悲観・基準・楽観のライフプラン比較
- 共有パスワード認証と署名済みセッションCookie
- Google Sheets APIへの保存・読込
- 旧localStorageデータの初回移行
- 複数端末更新時のrevision競合検知

## 開発

```bash
npm install
npm run auth:hash
npm run auth:secret
npm run dev
```

`.env.example` を `.env.local` にコピーし、次の値を設定します。

- `APP_PASSWORD_HASH`
- `SESSION_SECRET`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Spreadsheetは `GOOGLE_SERVICE_ACCOUNT_EMAIL` のメールアドレスへ編集者として共有してください。サーバーは対応するprivate keyでService Accountとして認証し、初回接続時に `app_state` シートを自動作成します。

検証:

```bash
npm test
npm run lint
```

## 本番構成

Next.js / Vercel / Google Sheets API / Service Accountを使用します。Googleログインと専用DBは使用しません。正式なデプロイ経路はprivate GitHubリポジトリの `main` → Vercel Productionです。

- [要件定義書](docs/requirements-definition.md)
- [技術要件書](docs/technical-requirements.md)
- [ライフプラン計算仕様](docs/life-planning-logic.md)
- [GitHub・Vercel・Google Sheetsセットアップ](docs/deployment-setup.md)

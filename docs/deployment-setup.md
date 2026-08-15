# GitHub・Vercel・Google Sheetsセットアップ

## 1. GitHub

1. GitHubのprivateリポジトリ `harukishimo/money` を使用する。
2. SSH remote `git@github.com:harukishimo/money.git` を `origin` に設定する。
3. ローカルの `main` をSSHで直接pushする。
4. Vercelで `harukishimo/money` を接続し、以後の `main` pushをProductionへ自動デプロイする。

```bash
git remote add origin git@github.com:harukishimo/money.git
git branch -M main
git push -u origin main
```

`origin` が既に存在する場合は `git remote set-url origin git@github.com:harukishimo/money.git` を使用する。GitHub CLI認証は不要で、GitHubへ登録済みのSSH鍵を使用する。

秘密情報、`.env.local`、Service Account JSONはGitHubへcommitしない。

## 2. Google Cloud・Spreadsheet

1. Google Cloud ProjectでGoogle Sheets APIを有効化する。
2. Service Accountを作成し、JSONキーを安全な場所へダウンロードする。
3. Service Account JSON内の `client_email` と `private_key` を控える。
4. 保存先のGoogle Spreadsheetを作成する。
5. SpreadsheetをService Account JSON内の `client_email` へ編集者として共有する。
6. Spreadsheet URLの `/d/` と `/edit` の間をSpreadsheet IDとして控える。

アプリは初回接続時に `app_state` シートを自動作成する。Googleアカウントでアプリへログインする処理はない。

## 3. Vercel Environment Variables

Vercel DashboardのProject Settings → Environment Variablesで次の5変数を登録する。

| 変数 | 設定方法 |
|---|---|
| `APP_PASSWORD_HASH` | ローカルで `npm run auth:hash` を実行して生成 |
| `SESSION_SECRET` | ローカルで `npm run auth:secret` を実行して生成 |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Google Cloud・Spreadsheet手順6で控えたID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service Account JSONの `client_email` |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service Account JSONの `private_key`。`-----BEGIN PRIVATE KEY-----` から `-----END PRIVATE KEY-----` まで |

- 5変数とも `NEXT_PUBLIC_` を付けない。
- `APP_PASSWORD_HASH`、`SESSION_SECRET`、`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` はSensitive値として扱う。
- private keyは実際の改行を含む形でも、改行を `\n` にした1行形式でも設定できる。
- ProductionとPreviewで別のSpreadsheetおよびService Accountを使用する。
- 変数を追加・変更した後は再デプロイが必要である。
- 共有パスワードを変更する際は、既存Cookieも無効化するため `SESSION_SECRET` も同時に更新する。

## 4. Vercel Git連携

既存Vercelプロジェクトを使用する場合は、DashboardのGit設定からprivate GitHubリポジトリを接続するか、リンク済みディレクトリで次を実行する。

```bash
npx vercel@latest git connect https://github.com/harukishimo/money.git
```

Production Branchは `main` とする。以後、Pull RequestはPreview、`main`へのpushはProductionとして履歴が残る。

## 5. 本番確認

1. 未認証でトップページを開くと `/login` へ移動する。
2. 誤ったパスワードは401となる。
3. 正しいパスワードでログインできる。
4. Excel取込後に「Sheets保存済み」と表示される。
5. 別端末でログインし、同じ状態を読み込める。
6. 一方の端末で古い状態を保存すると409競合が表示される。
7. Vercelログへパスワード、ハッシュ、明細、金額、Service Account情報が出ていない。

## 6. 現在の未完了事項

- GitHub SSH remoteの設定とpushが未完了。
- 本番用5環境変数が未設定。
- 実Spreadsheetを使用した読込・保存・競合の結合テストが未実施。

この3点が完了するまでは、既存のVercelモックを正式Productionへ置き換えない。

import type { Metadata } from "next";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "ログイン | ふたりの家計室",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const requested = (await searchParams).next;
  const nextPath = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <span className="brand-mark">F</span>
        <p className="eyebrow">PRIVATE HOUSEHOLD</p>
        <h1 id="login-title">ふたりの家計室</h1>
        <p>共有パスワードを入力してください。パスワードはサーバーでハッシュ照合され、保存・記録されません。</p>
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}

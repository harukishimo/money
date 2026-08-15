"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "ログインできませんでした。");
      router.replace(nextPath);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ログインできませんでした。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="password">共有パスワード</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={submitting || password.length === 0}>
        {submitting ? "確認中…" : "家計室に入る"}
      </button>
    </form>
  );
}

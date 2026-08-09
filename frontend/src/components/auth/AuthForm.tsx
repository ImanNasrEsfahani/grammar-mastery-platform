"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/i18n";
import { StatusPanel } from "@/components/ui/StatusPanel";

export function AuthForm({mode, locale}: {mode: "login" | "register"; locale: Locale}) {
  const isFa = locale === "fa";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [fields, setFields] = useState({email: "", password: "", displayName: ""});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/session/login" : "/api/backend/auth/register";
      const body = mode === "login"
        ? {email: fields.email, password: fields.password}
        : {email: fields.email, password: fields.password, display_name: fields.displayName || null, locale: isFa ? "fa-IR" : "en-CA", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone};
      await apiRequest(path, {method: "POST", body: JSON.stringify(body)});
      if (mode === "login") router.replace(`/${locale}/dashboard`);
      else router.replace(`/${locale}/login?registered=1`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Authentication failed."}));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? (isFa ? "ورود به حساب" : "Log in") : (isFa ? "ساخت حساب" : "Create account");
  return (
    <section className="auth-layout">
      <div className="surface auth-card stack">
        <div className="stack stack-small">
          <p className="eyebrow">{isFa ? "تمرین شخصی‌سازی‌شده" : "Personalized practice"}</p>
          <h1>{title}</h1>
          <p className="muted">{isFa ? "برای ادامه یادگیری وارد شوید." : "Continue your learning history securely."}</p>
        </div>
        {error ? (
          <StatusPanel title={error.message} tone="danger" requestId={error.requestId}>
            <p>{error.code}</p>
          </StatusPanel>
        ) : null}
        <form className="stack" onSubmit={submit} noValidate>
          {mode === "register" ? (
            <div className="form-field">
              <label htmlFor="display-name">{isFa ? "نام نمایشی" : "Display name"}</label>
              <input id="display-name" name="display_name" autoComplete="name" value={fields.displayName} onChange={(event) => setFields({...fields, displayName: event.target.value})} />
            </div>
          ) : null}
          <div className="form-field">
            <label htmlFor="email">{isFa ? "ایمیل" : "Email"}</label>
            <input id="email" name="email" type="email" autoComplete="email" required value={fields.email} onChange={(event) => setFields({...fields, email: event.target.value})} aria-describedby={error?.fields.email ? "email-error" : undefined} />
            {error?.fields.email ? <p className="field-error" id="email-error">{error.fields.email.join(" ")}</p> : null}
          </div>
          <div className="form-field">
            <label htmlFor="password">{isFa ? "گذرواژه" : "Password"}</label>
            <input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 12 : 1} required value={fields.password} onChange={(event) => setFields({...fields, password: event.target.value})} aria-describedby={error?.fields.password ? "password-error" : undefined} />
            {error?.fields.password ? <p className="field-error" id="password-error">{error.fields.password.join(" ")}</p> : null}
          </div>
          <button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? (isFa ? "در حال ارسال…" : "Submitting…") : title}
          </button>
        </form>
        <p className="muted">
          {mode === "login" ? (isFa ? "حساب ندارید؟ " : "Need an account? ") : (isFa ? "حساب دارید؟ " : "Already registered? ")}
          <Link href={`/${locale}/${mode === "login" ? "register" : "login"}`}>
            {mode === "login" ? (isFa ? "ثبت‌نام" : "Register") : (isFa ? "ورود" : "Log in")}
          </Link>
        </p>
      </div>
    </section>
  );
}

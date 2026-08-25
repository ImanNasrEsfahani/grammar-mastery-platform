"use client";

import {useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./AuthForm.module.css";

type AuthFields = {
  email: string;
  password: string;
  displayName: string;
};

type LoginCopy = {
  welcome: string;
  subtitle: string;
  email: string;
  emailPlaceholder: string;
  password: string;
  passwordPlaceholder: string;
  showPassword: string;
  hidePassword: string;
  remember: string;
  forgot: string;
  submit: string;
  submitting: string;
  noAccount: string;
  create: string;
  brandTitle: string;
  brandSubtitle: string;
  brandFeatures: string;
  copyright: string;
};

const loginCopy: Record<Locale, LoginCopy> = {
  fa: {
    welcome: "خوش آمدید",
    subtitle: "برای ادامه مسیر یادگیری خود وارد حساب شوید.",
    email: "ایمیل",
    emailPlaceholder: "name@example.com",
    password: "گذرواژه",
    passwordPlaceholder: "گذرواژه شما",
    showPassword: "نمایش گذرواژه",
    hidePassword: "پنهان‌کردن گذرواژه",
    remember: "مرا به خاطر بسپار",
    forgot: "گذرواژه را فراموش کرده‌اید؟",
    submit: "ورود",
    submitting: "در حال ورود…",
    noAccount: "حساب ندارید؟",
    create: "ساخت حساب",
    brandTitle: "GRAMMAR\nMASTERY",
    brandSubtitle: "یادگیری حرفه‌ای گرامر فرانسه",
    brandFeatures: "تمرین تطبیقی • مرور • آمادگی TCF",
    copyright: "© 2026 Grammar Mastery",
  },
  en: {
    welcome: "Welcome back",
    subtitle: "Sign in to continue your learning journey.",
    email: "Email",
    emailPlaceholder: "name@example.com",
    password: "Password",
    passwordPlaceholder: "Your password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    remember: "Remember me",
    forgot: "Forgot password?",
    submit: "Sign in",
    submitting: "Signing in…",
    noAccount: "No account?",
    create: "Create one",
    brandTitle: "GRAMMAR\nMASTERY",
    brandSubtitle: "Premium French grammar learning",
    brandFeatures: "Adaptive practice • Review • TCF preparation",
    copyright: "© 2026 Grammar Mastery",
  },
};

function EyeIcon({hidden}: {hidden: boolean}) {
  if (hidden) {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.4 4.3 9 5.3.2.4.2.9 0 1.3a13.9 13.9 0 0 1-2.5 3.2M6.2 6.3A14.5 14.5 0 0 0 3 10.3c-.2.4-.2.9 0 1.3C3.6 12.7 6.8 17 12 17c1.2 0 2.3-.2 3.2-.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 10.4C3.6 9.3 6.8 5 12 5s8.4 4.3 9 5.4c.2.4.2.8 0 1.2C20.4 12.7 17.2 17 12 17s-8.4-4.3-9-5.4a1.3 1.3 0 0 1 0-1.2Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="11" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function BrandArtwork() {
  return (
    <svg className={styles.towerArtwork} viewBox="0 0 180 560" fill="none" aria-hidden="true">
      <path d="M34 526L86 62M146 526L94 62" stroke="currentColor" strokeWidth="6" strokeLinecap="square" />
      <path d="M73 185H108M60 310H121M46 425H134" stroke="currentColor" strokeWidth="5" strokeLinecap="square" />
    </svg>
  );
}

export function AuthForm({mode, locale}: {mode: "login" | "register"; locale: Locale}) {
  const isFa = locale === "fa";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [fields, setFields] = useState<AuthFields>({email: "", password: "", displayName: ""});
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/session/login" : "/api/backend/auth/register";
      const body = mode === "login"
        ? {email: fields.email, password: fields.password, remember_me: rememberMe}
        : {
            email: fields.email,
            password: fields.password,
            display_name: fields.displayName || null,
            locale: isFa ? "fa-IR" : "en-CA",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
      await apiRequest(path, {method: "POST", body: JSON.stringify(body)});
      if (mode === "login") {
        router.replace(`/${locale}/dashboard`);
        router.refresh();
      } else {
        router.replace(`/${locale}/login?registered=1`);
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Authentication failed."}),
      );
    } finally {
      setBusy(false);
    }
  }

  if (mode === "login") {
    const copy = loginCopy[locale];
    return (
      <section className={styles.loginPage} dir={isFa ? "rtl" : "ltr"} aria-labelledby="login-title">
        <div className={styles.loginGrid}>
          <aside className={styles.brandPanel} aria-label={isFa ? "معرفی Grammar Mastery" : "Grammar Mastery introduction"}>
            <div className={styles.brandVisual}>
              <BrandArtwork />
              <div className={styles.brandCopy}>
                <h2>{copy.brandTitle.split("\n").map((line) => <span key={line}>{line}</span>)}</h2>
                <p className={styles.brandSubtitle}>{copy.brandSubtitle}</p>
                <p className={styles.brandFeatures}>{copy.brandFeatures}</p>
                <div className={styles.levelPill} dir="ltr" aria-label="B1 to B2">B1 <span>→</span> B2</div>
              </div>
            </div>
            <p className={styles.copyright} dir="ltr">{copy.copyright}</p>
          </aside>

          <div className={styles.formStage}>
            <div className={styles.loginCard}>
              <header className={styles.loginHeading}>
                <h1 id="login-title">{copy.welcome}</h1>
                <p>{copy.subtitle}</p>
              </header>

              {error ? (
                <StatusPanel title={error.message} tone="danger" requestId={error.requestId}>
                  <p>{error.code}</p>
                </StatusPanel>
              ) : null}

              <form className={styles.loginForm} onSubmit={submit} noValidate>
                <div className={styles.field}>
                  <label htmlFor="email">{copy.email}</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={copy.emailPlaceholder}
                    required
                    value={fields.email}
                    onChange={(event) => setFields({...fields, email: event.target.value})}
                    aria-invalid={Boolean(error?.fields.email)}
                    aria-describedby={error?.fields.email ? "email-error" : undefined}
                  />
                  {error?.fields.email ? <p className={styles.fieldError} id="email-error">{error.fields.email.join(" ")}</p> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="password">{copy.password}</label>
                  <div className={styles.passwordControl}>
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder={copy.passwordPlaceholder}
                      required
                      value={fields.password}
                      onChange={(event) => setFields({...fields, password: event.target.value})}
                      aria-invalid={Boolean(error?.fields.password)}
                      aria-describedby={error?.fields.password ? "password-error" : undefined}
                    />
                    <button
                      className={styles.passwordToggle}
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? copy.hidePassword : copy.showPassword}
                      aria-pressed={showPassword}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                  {error?.fields.password ? <p className={styles.fieldError} id="password-error">{error.fields.password.join(" ")}</p> : null}
                </div>

                <div className={styles.loginOptions}>
                  <label className={styles.rememberChoice}>
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                    />
                    <span className={styles.checkboxVisual} aria-hidden="true"><span>✓</span></span>
                    <span>{copy.remember}</span>
                  </label>
                  <Link className={styles.forgotLink} href={`/${locale}/forgot-password`}>{copy.forgot}</Link>
                </div>

                <button className={styles.submitButton} type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? copy.submitting : copy.submit}
                </button>
              </form>

              <div className={styles.divider} aria-hidden="true"><span /><small>{isFa ? "یا" : "or"}</small><span /></div>
              <p className={styles.registerPrompt}>
                <span>{copy.noAccount}</span>
                <Link href={`/${locale}/register`}>{copy.create}</Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const title = isFa ? "ساخت حساب" : "Create account";
  return (
    <section className="auth-layout">
      <div className="surface auth-card stack">
        <div className="stack stack-small">
          <p className="eyebrow">{isFa ? "تمرین شخصی‌سازی‌شده" : "Personalized practice"}</p>
          <h1>{title}</h1>
          <p className="muted">{isFa ? "برای شروع مسیر یادگیری حساب بسازید." : "Create an account to start your learning history."}</p>
        </div>
        {error ? (
          <StatusPanel title={error.message} tone="danger" requestId={error.requestId}>
            <p>{error.code}</p>
          </StatusPanel>
        ) : null}
        <form className="stack" onSubmit={submit} noValidate>
          <div className="form-field">
            <label htmlFor="display-name">{isFa ? "نام نمایشی" : "Display name"}</label>
            <input id="display-name" name="display_name" autoComplete="name" value={fields.displayName} onChange={(event) => setFields({...fields, displayName: event.target.value})} />
          </div>
          <div className="form-field">
            <label htmlFor="email">{isFa ? "ایمیل" : "Email"}</label>
            <input id="email" name="email" type="email" autoComplete="email" required value={fields.email} onChange={(event) => setFields({...fields, email: event.target.value})} aria-describedby={error?.fields.email ? "email-error" : undefined} />
            {error?.fields.email ? <p className="field-error" id="email-error">{error.fields.email.join(" ")}</p> : null}
          </div>
          <div className="form-field">
            <label htmlFor="password">{isFa ? "گذرواژه" : "Password"}</label>
            <div className={styles.registerPasswordControl}>
              <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} required value={fields.password} onChange={(event) => setFields({...fields, password: event.target.value})} aria-describedby={error?.fields.password ? "password-error" : undefined} />
              <button type="button" className={styles.registerPasswordToggle} onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? (isFa ? "پنهان‌کردن گذرواژه" : "Hide password") : (isFa ? "نمایش گذرواژه" : "Show password")}>
                <EyeIcon hidden={showPassword} />
              </button>
            </div>
            {error?.fields.password ? <p className="field-error" id="password-error">{error.fields.password.join(" ")}</p> : null}
          </div>
          <button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? (isFa ? "در حال ارسال…" : "Submitting…") : title}
          </button>
        </form>
        <p className="muted">
          {isFa ? "حساب دارید؟ " : "Already registered? "}
          <Link href={`/${locale}/login`}>{isFa ? "ورود" : "Log in"}</Link>
        </p>
      </div>
    </section>
  );
}

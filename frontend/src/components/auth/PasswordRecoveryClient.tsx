"use client";

import Link from "next/link";
import {useMemo, useState} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import styles from "./PasswordRecoveryClient.module.css";

type Mode = "request" | "reset";
type RecoveryEnvelope = {
  data: {status: "ACCEPTED" | "PASSWORD_RESET"};
  meta: {request_id: string; api_version: "v1"};
};

type RequestState = "email" | "verification";
type ResetState = "form" | "success" | "expired";

function passwordStrength(value: string) {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 12) score += 35;
  if (value.length >= 16) score += 15;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 20;
  if (/\d/.test(value)) score += 15;
  if (/[^A-Za-z0-9]/.test(value)) score += 15;
  return Math.min(100, score);
}

function strengthLabel(value: number, isFa: boolean) {
  if (value < 35) return isFa ? "ضعیف" : "Weak";
  if (value < 65) return isFa ? "متوسط" : "Fair";
  if (value < 85) return isFa ? "خوب" : "Good";
  return isFa ? "قوی" : "Strong";
}

export function PasswordRecoveryClient({
  locale,
  mode,
  token = null,
}: {
  locale: Locale;
  mode: Mode;
  token?: string | null;
}) {
  const isFa = locale === "fa";
  const [requestState, setRequestState] = useState<RequestState>("email");
  const [resetState, setResetState] = useState<ResetState>(token ? "form" : "expired");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);
  const mismatch = Boolean(confirmPassword && newPassword !== confirmPassword);
  const shortPassword = Boolean(newPassword && newPassword.length < 12);
  const activeStep = mode === "request" ? (requestState === "email" ? 1 : 2) : 3;

  async function requestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<RecoveryEnvelope>("/api/backend/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({email, locale: isFa ? "fa-IR" : "en-CA"}),
      });
      setRequestId(response?.meta.request_id ?? null);
      setRequestState("verification");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Password recovery failed."}));
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setResetState("expired");
      return;
    }
    if (newPassword.length < 12 || newPassword !== confirmPassword) return;
    setBusy(true);
    try {
      const response = await apiRequest<RecoveryEnvelope>("/api/backend/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({token, new_password: newPassword}),
      });
      setRequestId(response?.meta.request_id ?? null);
      setNewPassword("");
      setConfirmPassword("");
      setResetState("success");
    } catch (caught) {
      const next = caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Password reset failed."});
      if (["PASSWORD_RESET_INVALID", "PASSWORD_RESET_EXPIRED"].includes(next.code)) {
        setResetState("expired");
      } else {
        setError(next);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.recoveryPage}>
      <div className={styles.shell}>
        <aside className={styles.trustPanel} aria-labelledby="recovery-trust-title">
          <div>
            <p className={styles.kicker}>Grammar Mastery · Security</p>
            <h1 id="recovery-trust-title">{isFa ? "بازیابی امن حساب" : "Secure account recovery"}</h1>
            <p className={styles.lead}>
              {isFa ? "دسترسی به مسیر یادگیری‌ات را در چند مرحله ساده برگردان." : "Return to your learning path in a few calm, secure steps."}
            </p>
            <ul className={styles.trustList}>
              <li><span aria-hidden="true">✓</span>{isFa ? "لینک بازیابی یک‌بارمصرف" : "Single-use recovery link"}</li>
              <li><span aria-hidden="true">✓</span>{isFa ? "اعتبار محدود برای امنیت بیشتر" : "Short expiry for extra security"}</li>
              <li><span aria-hidden="true">✓</span>{isFa ? "ادامه مستقیم از همان حساب" : "Continue with the same learning account"}</li>
            </ul>
          </div>
          <RecoveryIllustration />
          <p className={styles.privacyNote} dir="ltr">French academic learning • Privacy-first</p>
        </aside>

        <section className={styles.formCard} aria-labelledby="password-recovery-title">
          <header className={styles.formHeader}>
            <p className={styles.kicker}>{isFa ? "دسترسی به حساب" : "Account access"}</p>
            <h2 id="password-recovery-title">{isFa ? "بازیابی رمز عبور" : "Reset your password"}</h2>
            <p>{isFa ? "برای حسابت یک لینک امن بازیابی دریافت کن." : "Receive a secure recovery link for your account."}</p>
          </header>

          <StepIndicator activeStep={activeStep} isFa={isFa} />

          {mode === "request" && requestState === "email" ? (
            <form className={styles.form} onSubmit={requestReset} noValidate>
              <div className={styles.field}>
                <label htmlFor="recovery-email">{isFa ? "ایمیل حساب" : "Account email"}</label>
                <input
                  id="recovery-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  dir="ltr"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby={error?.fields.email ? "recovery-email-error" : "secure-link-note"}
                />
                {error?.fields.email ? <p id="recovery-email-error" className={styles.fieldError}>{error.fields.email.join(" ")}</p> : null}
              </div>

              <div className={styles.securityNote} id="secure-link-note">
                <span className={styles.lockIcon} aria-hidden="true">⌁</span>
                <div>
                  <strong>{isFa ? "لینک امن بازیابی به ایمیل شما ارسال می‌شود." : "A secure recovery link will be sent to your email."}</strong>
                  <small>{isFa ? "این لینک کوتاه‌مدت و یک‌بارمصرف است." : "The link is short-lived and can only be used once."}</small>
                </div>
              </div>

              {error && !error.fields.email ? <InlineError error={error} isFa={isFa} /> : null}

              <button className={styles.primaryButton} type="submit" disabled={busy} aria-busy={busy}>
                {busy ? (isFa ? "در حال ارسال…" : "Sending…") : (isFa ? "ارسال لینک بازیابی" : "Send recovery link")}
              </button>
            </form>
          ) : null}

          {mode === "request" && requestState === "verification" ? (
            <section className={styles.stateCard} aria-live="polite">
              <span className={styles.stateIcon} aria-hidden="true">✉</span>
              <h3>{isFa ? "ایمیل را بررسی کن" : "Check your email"}</h3>
              <p>
                {isFa
                  ? "اگر حسابی با این ایمیل وجود داشته باشد، لینک بازیابی برای آن ارسال شده است. برای امنیت، وجود یا نبود حساب را تأیید نمی‌کنیم."
                  : "If an account exists for that email, a recovery link has been sent. For security, we do not confirm whether an account exists."}
              </p>
              <button className={styles.secondaryButton} type="button" onClick={() => {setRequestState("email"); setError(null);}}>
                {isFa ? "استفاده از ایمیل دیگر" : "Use another email"}
              </button>
              {requestId ? <small className={styles.requestId} dir="ltr">Request ID: {requestId}</small> : null}
            </section>
          ) : null}

          {mode === "reset" && resetState === "form" ? (
            <form className={styles.form} onSubmit={savePassword} noValidate>
              <div className={styles.field}>
                <label htmlFor="new-password">{isFa ? "رمز جدید" : "New password"}</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  minLength={12}
                  maxLength={256}
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  aria-describedby="password-strength password-rule"
                />
                <div className={styles.strengthRow} id="password-strength">
                  <progress max={100} value={strength} aria-label={isFa ? `قدرت رمز: ${strengthLabel(strength, true)}` : `Password strength: ${strengthLabel(strength, false)}`} />
                  <span>{isFa ? "قدرت رمز:" : "Strength:"} <strong>{strengthLabel(strength, isFa)}</strong></span>
                </div>
                <small id="password-rule" className={shortPassword ? styles.fieldError : styles.helper}>
                  {isFa ? "حداقل ۱۲ کاراکتر؛ ترکیب حروف، عدد و نماد بهتر است." : "At least 12 characters; a mix of letters, numbers and symbols is stronger."}
                </small>
              </div>

              <div className={styles.field}>
                <label htmlFor="confirm-password">{isFa ? "تکرار رمز جدید" : "Confirm new password"}</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  minLength={12}
                  maxLength={256}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  aria-invalid={mismatch || undefined}
                  aria-describedby={mismatch ? "password-mismatch" : undefined}
                />
                {mismatch ? <p id="password-mismatch" className={styles.fieldError}>{isFa ? "دو رمز با هم یکسان نیستند." : "The passwords do not match."}</p> : null}
              </div>

              <div className={styles.securityNote}>
                <span className={styles.lockIcon} aria-hidden="true">✓</span>
                <div>
                  <strong>{isFa ? "بعد از ذخیره، نشست‌های قبلی خارج می‌شوند." : "Existing sessions are signed out after reset."}</strong>
                  <small>{isFa ? "برای ادامه با رمز جدید دوباره وارد شو." : "Log in again with the new password to continue."}</small>
                </div>
              </div>

              {error ? <InlineError error={error} isFa={isFa} /> : null}

              <button className={styles.primaryButton} type="submit" disabled={busy || newPassword.length < 12 || mismatch || !confirmPassword} aria-busy={busy}>
                {busy ? (isFa ? "در حال ذخیره…" : "Saving…") : (isFa ? "ذخیره رمز جدید" : "Save new password")}
              </button>
            </form>
          ) : null}

          {mode === "reset" && resetState === "success" ? (
            <section className={`${styles.stateCard} ${styles.successState}`} aria-live="polite">
              <span className={styles.stateIcon} aria-hidden="true">✓</span>
              <h3>{isFa ? "رمز با موفقیت تغییر کرد" : "Password updated"}</h3>
              <p>{isFa ? "همه نشست‌های قبلی بسته شده‌اند. حالا با رمز جدید وارد شو." : "Previous sessions have been revoked. You can now log in with your new password."}</p>
              <Link className={styles.primaryButton} href={`/${locale}/login?reset=1`}>{isFa ? "ورود با رمز جدید" : "Log in with new password"}</Link>
              {requestId ? <small className={styles.requestId} dir="ltr">Request ID: {requestId}</small> : null}
            </section>
          ) : null}

          {mode === "reset" && resetState === "expired" ? (
            <section className={`${styles.stateCard} ${styles.expiredState}`} aria-live="polite">
              <span className={styles.stateIcon} aria-hidden="true">!</span>
              <h3>{isFa ? "لینک معتبر نیست یا منقضی شده" : "This link is invalid or expired"}</h3>
              <p>{isFa ? "برای امنیت، لینک‌های بازیابی فقط یک‌بار و برای مدت محدود قابل استفاده‌اند." : "For security, recovery links are single-use and expire after a short period."}</p>
              <Link className={styles.primaryButton} href={`/${locale}/forgot-password`}>{isFa ? "دریافت لینک جدید" : "Request a new link"}</Link>
            </section>
          ) : null}

          <div className={styles.backRow}>
            <Link href={`/${locale}/login`}>← {isFa ? "بازگشت به ورود" : "Back to login"}</Link>
            <span>{isFa ? "رمز را به خاطر آوردی؟" : "Remembered your password?"}</span>
          </div>
        </section>
      </div>
      <footer className={styles.footer} dir="ltr">© 2026 Grammar Mastery</footer>
    </div>
  );
}

function StepIndicator({activeStep, isFa}: {activeStep: number; isFa: boolean}) {
  const steps = isFa ? ["ایمیل", "تأیید", "رمز جدید"] : ["Email", "Verification", "New password"];
  return (
    <ol className={styles.steps} aria-label={isFa ? "مراحل بازیابی رمز" : "Password recovery steps"}>
      {steps.map((label, index) => {
        const step = index + 1;
        const active = step === activeStep;
        const complete = step < activeStep;
        return (
          <li key={label} className={active ? styles.activeStep : complete ? styles.completeStep : ""} aria-current={active ? "step" : undefined}>
            <span>{complete ? "✓" : step}</span>
            <small>{label}</small>
          </li>
        );
      })}
    </ol>
  );
}

function InlineError({error, isFa}: {error: ApiError; isFa: boolean}) {
  return (
    <div className={styles.errorBox} role="alert">
      <strong>{isFa ? "بازیابی انجام نشد" : "Recovery could not continue"}</strong>
      <span>{error.message}</span>
      {error.requestId ? <small dir="ltr">Request ID: {error.requestId}</small> : null}
    </div>
  );
}

function RecoveryIllustration() {
  return (
    <div className={styles.illustration} aria-hidden="true">
      <svg viewBox="0 0 220 190" fill="none">
        <rect x="18" y="42" width="184" height="128" rx="20" />
        <path d="M33 72 110 16l77 56-77 58L33 72Z" />
        <circle cx="110" cy="91" r="25" />
        <path d="M110 116v45h30v20m-30-35h20" />
      </svg>
    </div>
  );
}

"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useMemo, useState} from "react";
import type {ChangeEvent, FormEvent} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./RegisterExperience.module.css";

type FieldErrors = Partial<Record<"displayName" | "email" | "password" | "confirmPassword" | "terms", string>>;
type PasswordField = "password" | "confirmPassword";

type IconName = "book" | "target" | "progress" | "review" | "user" | "mail" | "lock" | "eye" | "eyeOff" | "shield" | "globe";

function Icon({name}: {name: IconName}) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "book") return <svg {...common}><path d="M4 5.5c3.6 0 6 .8 8 2.5v11c-2-1.7-4.4-2.5-8-2.5z"/><path d="M20 5.5c-3.6 0-6 .8-8 2.5v11c2-1.7 4.4-2.5 8-2.5z"/><path d="M12 4v4"/></svg>;
  if (name === "target") return <svg {...common}><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M14.5 9.5 20 4M16.5 4H20v3.5"/></svg>;
  if (name === "progress") return <svg {...common}><path d="M4 19V8M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/><circle cx="7" cy="15" r="1"/><circle cx="11" cy="11" r="1"/><circle cx="14" cy="13" r="1"/><circle cx="19" cy="7" r="1"/></svg>;
  if (name === "review") return <svg {...common}><path d="M8 4h8l1 4 3 2-3 2-1 5H8l-1-5-3-2 3-2z"/><path d="M9 20h6M12 17v3"/></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="3"/><path d="M6.5 19c.8-3.2 2.6-5 5.5-5s4.7 1.8 5.5 5"/></svg>;
  if (name === "mail") return <svg {...common}><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m5 7 7 5 7-5"/></svg>;
  if (name === "lock") return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2"/></svg>;
  if (name === "eye") return <svg {...common}><path d="M2.8 12s3.4-5 9.2-5 9.2 5 9.2 5-3.4 5-9.2 5-9.2-5-9.2-5Z"/><circle cx="12" cy="12" r="2.2"/></svg>;
  if (name === "eyeOff") return <svg {...common}><path d="m3 3 18 18"/><path d="M10.6 7.2A8.8 8.8 0 0 1 12 7c5.8 0 9.2 5 9.2 5a14 14 0 0 1-2.3 2.7M6.2 6.2A14.7 14.7 0 0 0 2.8 12s3.4 5 9.2 5c1.2 0 2.3-.2 3.3-.6"/><path d="M10.4 10.4a2.3 2.3 0 0 0 3.2 3.2"/></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 3 19 6v5c0 4.7-2.9 8.1-7 10-4.1-1.9-7-5.3-7-10V6z"/><path d="M12 8v7M9.5 12h5"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>;
}

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <Icon name="book" />
      <span>✦</span>
    </span>
  );
}

function ParisLineArt() {
  return (
    <svg className={styles.parisArt} viewBox="0 0 570 360" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M28 306h514M54 287c70 16 120 19 181 3 58-15 112-17 174 1 49 14 78 13 110 3" opacity=".32"/>
        <path d="M76 292v-62l19-15 18 15v62M83 230v-28h23v28M94 202v-17" opacity=".5"/>
        <path d="M174 289 217 95h17l42 194M196 212h58M205 168h40M214 123h22M186 247h77M174 289h103" strokeWidth="2.2"/>
        <path d="m217 95 8-23 9 23M225 72V51" strokeWidth="2"/>
        <path d="M304 290v-58h52v58M312 232v-19h36v19M330 213v-25" opacity=".58"/>
        <path d="M374 291v-69c21-26 44-26 65 0v69M386 222c0-16 8-30 20-41 12 11 20 25 20 41M406 181v-15" opacity=".6"/>
        <path d="M455 291v-46h54v46M462 245v-31h40v31M470 214v-18h24v18" opacity=".42"/>
        <path d="M132 321c54-16 104-16 155 0 59 18 117 18 174 0" opacity=".2"/>
        <path d="M252 88c7-5 14-5 21 0M290 121c7-5 14-5 21 0M135 136c7-5 14-5 21 0" opacity=".55"/>
      </g>
      <g fill="currentColor" opacity=".1">
        <circle cx="82" cy="250" r="42"/><circle cx="489" cy="258" r="45"/><circle cx="335" cy="270" r="30"/>
      </g>
    </svg>
  );
}

function passwordStrength(password: string, isFa: boolean) {
  if (!password) return {score: 0, label: isFa ? "هنوز وارد نشده" : "Not entered"};
  const criteria = [
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const satisfied = criteria.filter(Boolean).length;
  const score = Math.max(1, Math.min(4, satisfied));
  const faLabels = ["", "ضعیف", "متوسط", "خوب", "قوی"];
  const enLabels = ["", "Weak", "Fair", "Good", "Strong"];
  return {score, label: (isFa ? faLabels : enLabels)[score] ?? ""};
}

export function RegisterExperience({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [visible, setVisible] = useState<Record<PasswordField, boolean>>({password: false, confirmPassword: false});
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => passwordStrength(password, isFa), [isFa, password]);
  const otherLocale = isFa ? "en" : "fa";
  const year = new Date().getFullYear();

  const copy = isFa ? {
    brand: "تسلط بر گرامر فرانسه",
    existing: "از قبل حساب دارید؟",
    login: "ورود",
    heroTitle: "حساب خود را بسازید و در زبان فرانسه پیشرفت کنید",
    heroText: "به زبان‌آموزان بپیوندید و گرامر فرانسه را مرحله‌به‌مرحله، هدفمند و قابل‌اندازه‌گیری یاد بگیرید.",
    feature1: "مسیر شخصی‌سازی‌شده",
    feature1Text: "تمرینی متناسب با سطح، ضعف‌ها و هدف‌های شما.",
    feature2: "پیگیری پیشرفت",
    feature2Text: "تسلط و روند پیشرفت خود را با شواهد واقعی ببینید.",
    feature3: "مرورهای هوشمند",
    feature3Text: "اشتباه‌ها را با مرور فاصله‌دار و هدفمند دوباره تمرین کنید.",
    cardTitle: "ساخت حساب",
    cardSubtitle: "سریع، ساده و امن است.",
    fullName: "نام کامل",
    fullNamePlaceholder: "نام و نام خانوادگی خود را وارد کنید",
    email: "آدرس ایمیل",
    emailPlaceholder: "example@email.com",
    password: "گذرواژه",
    passwordPlaceholder: "یک گذرواژه بسازید",
    confirm: "تأیید گذرواژه",
    confirmPlaceholder: "گذرواژه را دوباره وارد کنید",
    showPassword: "نمایش گذرواژه",
    hidePassword: "پنهان‌کردن گذرواژه",
    strength: "قدرت گذرواژه",
    passwordHint: "حداقل ۱۲ کاراکتر؛ ترکیب حروف، عدد و نماد قدرت گذرواژه را بیشتر می‌کند.",
    securityTitle: "امنیت شما برای ما مهم است",
    securityText: "گذرواژه با Argon2id هش می‌شود و متن خام آن در حساب ذخیره نمی‌شود.",
    termsPrefix: "با ساخت حساب،",
    terms: "شرایط استفاده",
    privacy: "سیاست حریم خصوصی",
    termsJoin: "و",
    termsSuffix: "را می‌پذیرم.",
    submit: "ساخت حساب من",
    submitting: "در حال ساخت حساب…",
    nameRequired: "نام کامل را وارد کنید.",
    emailInvalid: "یک آدرس ایمیل معتبر وارد کنید.",
    passwordLength: "گذرواژه باید بین ۱۲ تا ۲۵۶ کاراکتر باشد.",
    passwordMismatch: "تأیید گذرواژه با گذرواژه یکسان نیست.",
    termsRequired: "برای ادامه باید شرایط استفاده و حریم خصوصی را بپذیرید.",
    language: "English",
  } : {
    brand: "French Grammar Mastery",
    existing: "Already have an account?",
    login: "Log in",
    heroTitle: "Create your account and progress in French",
    heroText: "Join a focused learning path and master French grammar step by step with measurable evidence.",
    feature1: "Personalized path",
    feature1Text: "Practice adapted to your level, weaknesses, and goals.",
    feature2: "Progress tracking",
    feature2Text: "See mastery and progress backed by real learning evidence.",
    feature3: "Smart reviews",
    feature3Text: "Revisit mistakes with targeted spaced-review scheduling.",
    cardTitle: "Create an account",
    cardSubtitle: "It’s quick, simple, and secure.",
    fullName: "Full name",
    fullNamePlaceholder: "Enter your full name",
    email: "Email address",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordPlaceholder: "Create a password",
    confirm: "Confirm password",
    confirmPlaceholder: "Re-enter your password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    strength: "Password strength",
    passwordHint: "Use at least 12 characters. A mix of letters, numbers, and symbols improves strength.",
    securityTitle: "Your security matters",
    securityText: "Passwords are hashed with Argon2id; the raw password is not stored in the account record.",
    termsPrefix: "By creating an account, I accept the",
    terms: "Terms of Use",
    privacy: "Privacy Policy",
    termsJoin: "and",
    termsSuffix: ".",
    submit: "Create my account",
    submitting: "Creating account…",
    nameRequired: "Enter your full name.",
    emailInvalid: "Enter a valid email address.",
    passwordLength: "Password must be between 12 and 256 characters.",
    passwordMismatch: "The confirmation does not match the password.",
    termsRequired: "Accept the Terms of Use and Privacy Policy to continue.",
    language: "فارسی",
  };

  function toggleVisibility(field: PasswordField) {
    setVisible((current) => ({...current, [field]: !current[field]}));
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!displayName.trim()) next.displayName = copy.nameRequired;
    const normalizedEmail = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) next.email = copy.emailInvalid;
    if (password.length < 12 || password.length > 256) next.password = copy.passwordLength;
    if (confirmPassword !== password) next.confirmPassword = copy.passwordMismatch;
    if (!acceptedTerms) next.terms = copy.termsRequired;
    return next;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setClientErrors(nextErrors);
    setError(null);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    const normalizedEmail = email.trim().toLocaleLowerCase();
    try {
      await apiRequest("/api/backend/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          display_name: displayName.trim(),
          locale: isFa ? "fa-IR" : "en-CA",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      });

      try {
        await apiRequest("/api/session/login", {
          method: "POST",
          body: JSON.stringify({email: normalizedEmail, password}),
        });
        router.replace(`/${locale}/dashboard`);
        router.refresh();
      } catch {
        router.replace(`/${locale}/login?registered=1`);
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: isFa ? "ساخت حساب ناموفق بود." : "Account creation failed."}));
    } finally {
      setBusy(false);
    }
  }

  const serverNameError = error?.fields.display_name?.join(" ");
  const serverEmailError = error?.fields.email?.join(" ");
  const serverPasswordError = error?.fields.password?.join(" ");

  return (
    <section className={styles.page} aria-labelledby="register-title">
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.logoLockup} aria-label={copy.brand}>
            <BrandMark />
            <span>{copy.brand}</span>
          </div>
          <div className={styles.loginPrompt}>
            <span>{copy.existing}</span>
            <Link href={`/${locale}/login`}>{copy.login}</Link>
          </div>
        </header>

        <div className={styles.mainGrid}>
          <section className={styles.brandPanel} aria-label={isFa ? "مزایای حساب" : "Account benefits"}>
            <div className={styles.brandCopy}>
              <h1 id="register-title">{copy.heroTitle}</h1>
              <p>{copy.heroText}</p>
            </div>
            <div className={styles.features}>
              <article>
                <span className={`${styles.featureIcon} ${styles.featureBlue}`}><Icon name="target" /></span>
                <div><h2>{copy.feature1}</h2><p>{copy.feature1Text}</p></div>
              </article>
              <article>
                <span className={`${styles.featureIcon} ${styles.featureGreen}`}><Icon name="progress" /></span>
                <div><h2>{copy.feature2}</h2><p>{copy.feature2Text}</p></div>
              </article>
              <article>
                <span className={`${styles.featureIcon} ${styles.featureGold}`}><Icon name="review" /></span>
                <div><h2>{copy.feature3}</h2><p>{copy.feature3Text}</p></div>
              </article>
            </div>
            <ParisLineArt />
          </section>

          <section className={styles.formCard} aria-labelledby="register-form-title">
            <div className={styles.formHeading}>
              <h2 id="register-form-title">{copy.cardTitle}</h2>
              <p>{copy.cardSubtitle}</p>
            </div>

            {error ? (
              <StatusPanel title={error.message} tone="danger" requestId={error.requestId}>
                <p>{error.code}</p>
              </StatusPanel>
            ) : null}

            <form className={styles.form} onSubmit={submit} noValidate>
              <label className={styles.field}>
                <span>{copy.fullName}</span>
                <span className={`${styles.inputWrap} ${(clientErrors.displayName || serverNameError) ? styles.invalid : ""}`}>
                  <Icon name="user" />
                  <input
                    name="display_name"
                    autoComplete="name"
                    maxLength={200}
                    value={displayName}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => { setDisplayName(event.target.value); setClientErrors((current) => ({...current, displayName: undefined})); }}
                    placeholder={copy.fullNamePlaceholder}
                    aria-invalid={Boolean(clientErrors.displayName || serverNameError)}
                    aria-describedby={(clientErrors.displayName || serverNameError) ? "register-name-error" : undefined}
                  />
                </span>
                {(clientErrors.displayName || serverNameError) ? <small className={styles.fieldError} id="register-name-error">{clientErrors.displayName || serverNameError}</small> : null}
              </label>

              <label className={styles.field}>
                <span>{copy.email}</span>
                <span className={`${styles.inputWrap} ${(clientErrors.email || serverEmailError) ? styles.invalid : ""}`}>
                  <Icon name="mail" />
                  <input
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={320}
                    dir="ltr"
                    value={email}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => { setEmail(event.target.value); setClientErrors((current) => ({...current, email: undefined})); }}
                    placeholder={copy.emailPlaceholder}
                    aria-invalid={Boolean(clientErrors.email || serverEmailError)}
                    aria-describedby={(clientErrors.email || serverEmailError) ? "register-email-error" : undefined}
                  />
                </span>
                {(clientErrors.email || serverEmailError) ? <small className={styles.fieldError} id="register-email-error">{clientErrors.email || serverEmailError}</small> : null}
              </label>

              <label className={styles.field}>
                <span>{copy.password}</span>
                <span className={`${styles.inputWrap} ${(clientErrors.password || serverPasswordError) ? styles.invalid : ""}`}>
                  <Icon name="lock" />
                  <input
                    name="password"
                    type={visible.password ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={256}
                    dir="ltr"
                    value={password}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => { setPassword(event.target.value); setClientErrors((current) => ({...current, password: undefined})); }}
                    placeholder={copy.passwordPlaceholder}
                    aria-invalid={Boolean(clientErrors.password || serverPasswordError)}
                    aria-describedby={`register-password-hint${(clientErrors.password || serverPasswordError) ? " register-password-error" : ""}`}
                  />
                  <button
                    className={styles.visibilityButton}
                    type="button"
                    onClick={() => toggleVisibility("password")}
                    aria-label={visible.password ? copy.hidePassword : copy.showPassword}
                    aria-pressed={visible.password}
                  >
                    <Icon name={visible.password ? "eyeOff" : "eye"} />
                  </button>
                </span>
                <div className={styles.strengthRow} aria-live="polite">
                  <div className={styles.strengthTrack} role="img" aria-label={`${copy.strength}: ${strength.label}`}>
                    {[0, 1, 2, 3].map((index) => (
                      <i key={index} className={`${styles.strengthSegment} ${index < strength.score ? (styles[`strength${strength.score}`] ?? "") : ""}`} />
                    ))}
                  </div>
                  <strong>{strength.label}</strong>
                </div>
                <small className={styles.passwordHint} id="register-password-hint">{copy.passwordHint}</small>
                {(clientErrors.password || serverPasswordError) ? <small className={styles.fieldError} id="register-password-error">{clientErrors.password || serverPasswordError}</small> : null}
              </label>

              <label className={styles.field}>
                <span>{copy.confirm}</span>
                <span className={`${styles.inputWrap} ${clientErrors.confirmPassword ? styles.invalid : ""}`}>
                  <Icon name="lock" />
                  <input
                    name="confirm_password"
                    type={visible.confirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    dir="ltr"
                    value={confirmPassword}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => { setConfirmPassword(event.target.value); setClientErrors((current) => ({...current, confirmPassword: undefined})); }}
                    placeholder={copy.confirmPlaceholder}
                    aria-invalid={Boolean(clientErrors.confirmPassword)}
                    aria-describedby={clientErrors.confirmPassword ? "register-confirm-error" : undefined}
                  />
                  <button
                    className={styles.visibilityButton}
                    type="button"
                    onClick={() => toggleVisibility("confirmPassword")}
                    aria-label={visible.confirmPassword ? copy.hidePassword : copy.showPassword}
                    aria-pressed={visible.confirmPassword}
                  >
                    <Icon name={visible.confirmPassword ? "eyeOff" : "eye"} />
                  </button>
                </span>
                {clientErrors.confirmPassword ? <small className={styles.fieldError} id="register-confirm-error">{clientErrors.confirmPassword}</small> : null}
              </label>

              <div className={styles.securityBox}>
                <span><Icon name="shield" /></span>
                <div><strong>{copy.securityTitle}</strong><p>{copy.securityText}</p></div>
              </div>

              <div className={`${styles.termsRow} ${clientErrors.terms ? styles.termsInvalid : ""}`}>
                <input
                  id="register-terms"
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => { setAcceptedTerms(event.target.checked); setClientErrors((current) => ({...current, terms: undefined})); }}
                  aria-invalid={Boolean(clientErrors.terms)}
                  aria-describedby={clientErrors.terms ? "register-terms-error" : undefined}
                />
                <label htmlFor="register-terms">
                  {copy.termsPrefix}{" "}
                  <Link href={`/${locale}/terms`} target="_blank">{copy.terms}</Link>{" "}
                  {copy.termsJoin}{" "}
                  <Link href={`/${locale}/privacy`} target="_blank">{copy.privacy}</Link>
                  {copy.termsSuffix}
                </label>
              </div>
              {clientErrors.terms ? <small className={styles.fieldError} id="register-terms-error">{clientErrors.terms}</small> : null}
              <button className={styles.submitButton} type="submit" disabled={busy} aria-busy={busy}>
                {busy ? copy.submitting : copy.submit}
              </button>
            </form>
          </section>
        </div>

        <footer className={styles.footer}>
          <Link className={styles.localeLink} href={`/${otherLocale}/register`} hrefLang={otherLocale}>
            <Icon name="globe" /> {copy.language}
          </Link>
          <nav aria-label={isFa ? "پیوندهای حقوقی" : "Legal links"}>
            <Link href={`/${locale}/privacy`}>{copy.privacy}</Link>
            <Link href={`/${locale}/terms`}>{copy.terms}</Link>
          </nav>
          <span>© {year} Grammar Mastery</span>
        </footer>
      </div>
    </section>
  );
}

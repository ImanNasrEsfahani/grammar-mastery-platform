"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useMemo, useState, type ChangeEvent, type ReactNode} from "react";
import {LogoutButton} from "@/components/navigation/LogoutButton";
import type {Locale} from "@/lib/i18n";
import {
  applyAccessibilityPreferences,
  defaultPreferences,
  readPreferences,
  savePreferences,
  type UserPreferences,
} from "@/lib/preferences";
import {applyThemePreference} from "@/lib/theme";

const copy = {
  fa: {
    eyebrow: "Preferences",
    title: "تنظیمات",
    subtitle: "ظاهر، زبان و ترجیحات تجربه یادگیری خود را مدیریت کنید.",
    save: "ذخیره تغییرات",
    saving: "در حال ذخیره…",
    reset: "بازنشانی",
    revert: "لغو تغییرات",
    saved: "تنظیمات روی این دستگاه ذخیره شد.",
    savedAndMoved: "تنظیمات ذخیره شد؛ زبان رابط در حال تغییر است…",
    storageError: "مرورگر اجازه ذخیره تنظیمات را نداد. فضای ذخیره محلی یا تنظیمات حریم خصوصی مرورگر را بررسی کنید.",
    localNote: "نسخه فعلی API پروژه endpoint اختصاصی برای preferences ندارد؛ بنابراین این تنظیمات به‌صورت versioned روی همین دستگاه ذخیره می‌شوند و هیچ endpoint ساختگی استفاده نشده است.",
    dirty: "تغییرات ذخیره‌نشده دارید.",
    navTitle: "تنظیمات",
    allSettings: "تنظیمات روی تجربه یادگیری، مرور و نمایش رابط اثر می‌گذارند.",
    appearance: "ظاهر",
    language: "زبان رابط",
    learning: "ترجیحات یادگیری",
    review: "مرور و تکرار",
    notifications: "اعلان‌ها",
    accessibility: "دسترسی‌پذیری",
    account: "حساب کاربری",
    theme: "حالت نمایش",
    themeHelp: "تم رابط کاربری را انتخاب کنید.",
    light: "Light",
    dark: "Dark",
    system: "System",
    density: "تراکم رابط",
    densityHelp: "فاصله بین کارت‌ها و کنترل‌ها را تنظیم می‌کند.",
    compact: "فشرده",
    comfortable: "متوسط",
    spacious: "باز",
    reduceMotion: "کاهش حرکت‌های رابط",
    reduceMotionHelp: "انیمیشن‌های غیرضروری را محدود می‌کند.",
    interfaceLanguage: "زبان Interface",
    interfaceLanguageHelp: "محتوای فرانسوی همیشه جهت مستقل LTR خود را حفظ می‌کند.",
    persian: "فارسی",
    english: "English",
    explanationLanguage: "زبان توضیحات",
    explanationLanguageHelp: "زبان پیش‌فرض توضیحات آموزشی و راهنماها.",
    defaultPractice: "حالت تمرین پیش‌فرض",
    defaultPracticeHelp: "هنگام ورود مستقیم به Practice Builder، این انتخاب به‌عنوان مقدار اولیه اعمال می‌شود.",
    adaptive: "Smart / Adaptive",
    adaptiveHelp: "سیستم براساس ضعف، mastery و نیاز مرور انتخاب می‌کند.",
    custom: "Custom",
    customHelp: "کنترل کامل محدوده تمرین را به شما می‌دهد.",
    questionCount: "تعداد سؤال پیشنهادی",
    questionCountHelp: "برای جلسه‌های تمرین عادی.",
    questionUnit: "سؤال",
    difficulty: "سطح سختی ترجیحی",
    difficultyHelp: "Adaptive همچنان محدودیت‌های ایمن backend را رعایت می‌کند.",
    easy: "Easy",
    mixed: "Mixed",
    hard: "Hard",
    spacedReview: "نمایش مرور فاصله‌دار",
    spacedReviewHelp: "موارد زمان‌دار SRS در تجربه مرور نمایش داده شوند؛ برنامه واقعی همچنان سرورمحور است.",
    reviewPriority: "اولویت Review Inbox",
    reviewPriorityHelp: "ترتیب ترجیحی برای نمایش و شروع مرور.",
    mistakesFirst: "خطاهای تکراری اول",
    dueFirst: "سررسیدها اول",
    balanced: "متعادل",
    dailyReviewLimit: "حد روزانه مرور",
    dailyReviewLimitHelp: "سقف پیشنهادی برای یک نوبت مرور؛ backlog واقعی حذف نمی‌شود.",
    recommended: "پیشنهادی",
    dueNotifications: "مرورهای سررسیده",
    dueNotificationsHelp: "یادآوری داخل رابط وقتی آیتم Review موعد دارد.",
    streakNotifications: "هدف روزانه و Streak",
    streakNotificationsHelp: "اعلان پیشرفت هدف روزانه و حفظ زنجیره.",
    weeklyReport: "گزارش هفتگی",
    weeklyReportHelp: "خلاصه mastery و نقاط نیازمند توجه.",
    fontSize: "اندازه متن",
    fontSizeHelp: "بدون تغییر layout اصلی، مقیاس پایه متن را تنظیم می‌کند.",
    highContrast: "کنتراست تقویت‌شده",
    highContrastHelp: "مرز کارت‌ها و متن‌های ثانویه واضح‌تر می‌شوند.",
    keyboard: "Keyboard shortcuts",
    keyboardHelp: "میان‌برهای صفحه Question Runner و کنترل‌های قابل پشتیبانی فعال بمانند.",
    profile: "پروفایل",
    profileHelp: "اطلاعات حساب و پروفایل یادگیرنده.",
    openProfile: "مشاهده پروفایل",
    dashboard: "داشبورد",
    dashboardHelp: "بازگشت به نمای کلی یادگیری.",
    openDashboard: "بازگشت به داشبورد",
    security: "امنیت حساب",
    securityHelp: "قرارداد فعلی Stage 21 endpoint تغییر رمز عبور را تعریف نکرده است؛ این صفحه action جعلی نمایش نمی‌دهد.",
    logout: "خروج از حساب",
    login: "ورود به حساب",
    signedOut: "برای تنظیمات مرتبط با حساب، ابتدا وارد شوید. تنظیمات ظاهر و یادگیری همچنان روی دستگاه قابل ذخیره‌اند.",
    defaultsPrepared: "مقادیر پیش‌فرض آماده شده‌اند؛ برای اعمال دائمی «ذخیره تغییرات» را بزنید.",
  },
  en: {
    eyebrow: "Preferences",
    title: "Settings",
    subtitle: "Manage appearance, language and learning preferences for your experience.",
    save: "Save changes",
    saving: "Saving…",
    reset: "Reset",
    revert: "Revert changes",
    saved: "Settings were saved on this device.",
    savedAndMoved: "Settings saved; switching interface language…",
    storageError: "The browser could not store your settings. Check local-storage or privacy restrictions.",
    localNote: "The current project API has no dedicated preferences endpoint, so these versioned settings are stored on this device without inventing a backend contract.",
    dirty: "You have unsaved changes.",
    navTitle: "Settings",
    allSettings: "These preferences shape learning, review and interface presentation.",
    appearance: "Appearance",
    language: "Interface language",
    learning: "Learning preferences",
    review: "Review & repetition",
    notifications: "Notifications",
    accessibility: "Accessibility",
    account: "Account",
    theme: "Display theme",
    themeHelp: "Choose the interface theme.",
    light: "Light",
    dark: "Dark",
    system: "System",
    density: "Interface density",
    densityHelp: "Controls spacing between cards and controls.",
    compact: "Compact",
    comfortable: "Comfortable",
    spacious: "Spacious",
    reduceMotion: "Reduce interface motion",
    reduceMotionHelp: "Limits non-essential animations.",
    interfaceLanguage: "Interface language",
    interfaceLanguageHelp: "French learning content keeps its own LTR direction independently.",
    persian: "فارسی",
    english: "English",
    explanationLanguage: "Explanation language",
    explanationLanguageHelp: "Preferred language for learning explanations and guidance.",
    defaultPractice: "Default practice mode",
    defaultPracticeHelp: "Applied when you open Practice Builder without an explicit configuration.",
    adaptive: "Smart / Adaptive",
    adaptiveHelp: "Uses weakness, mastery and review need to guide selection.",
    custom: "Custom",
    customHelp: "Gives you full control over the practice scope.",
    questionCount: "Suggested question count",
    questionCountHelp: "For normal practice sessions.",
    questionUnit: "questions",
    difficulty: "Preferred difficulty",
    difficultyHelp: "Adaptive mode still respects safe backend pacing limits.",
    easy: "Easy",
    mixed: "Mixed",
    hard: "Hard",
    spacedReview: "Show spaced review",
    spacedReviewHelp: "Keep scheduled SRS items visible in review; the real schedule remains server-owned.",
    reviewPriority: "Review Inbox priority",
    reviewPriorityHelp: "Your preferred presentation/start order for review.",
    mistakesFirst: "Repeated mistakes first",
    dueFirst: "Due items first",
    balanced: "Balanced",
    dailyReviewLimit: "Daily review limit",
    dailyReviewLimitHelp: "Suggested cap for one review sitting; the real backlog is never deleted.",
    recommended: "Recommended",
    dueNotifications: "Due reviews",
    dueNotificationsHelp: "In-app reminder when Review items become due.",
    streakNotifications: "Daily goal & streak",
    streakNotificationsHelp: "Progress notices for daily goal and learning streak.",
    weeklyReport: "Weekly report",
    weeklyReportHelp: "A summary of mastery and areas needing attention.",
    fontSize: "Text size",
    fontSizeHelp: "Adjusts the base text scale without changing the product structure.",
    highContrast: "Enhanced contrast",
    highContrastHelp: "Makes card borders and secondary text more distinct.",
    keyboard: "Keyboard shortcuts",
    keyboardHelp: "Keep supported Question Runner and control shortcuts enabled.",
    profile: "Profile",
    profileHelp: "Learner account and profile information.",
    openProfile: "View profile",
    dashboard: "Dashboard",
    dashboardHelp: "Return to your learning overview.",
    openDashboard: "Back to dashboard",
    security: "Account security",
    securityHelp: "The current Stage 21 contract does not define a password-change endpoint, so this page does not expose a fake action.",
    logout: "Log out",
    login: "Log in",
    signedOut: "Sign in for account-related settings. Appearance and learning preferences can still be stored on this device.",
    defaultsPrepared: "Default values are prepared; choose “Save changes” to apply them permanently.",
  },
} as const;

type Notice = {tone: "success" | "warning" | "danger"; text: string} | null;
type SettingsSectionId = "appearance" | "language" | "learning" | "review" | "notifications" | "accessibility" | "account";

export function SettingsClient({locale, authenticated}: {locale: Locale; authenticated: boolean}) {
  const isFa = locale === "fa";
  const labels = copy[locale];
  const router = useRouter();
  const [saved, setSaved] = useState<UserPreferences | null>(null);
  const [draft, setDraft] = useState<UserPreferences>(() => defaultPreferences(locale));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");

  useEffect(() => {
    const current = readPreferences(locale);
    setSaved(current);
    setDraft(current);
    applyAccessibilityPreferences(current);
    setReady(true);
  }, [locale]);

  const dirty = useMemo(() => saved !== null && JSON.stringify(saved) !== JSON.stringify(draft), [draft, saved]);

  useEffect(() => {
    const ids: SettingsSectionId[] = ["appearance", "language", "learning", "review", "notifications", "accessibility", "account"];
    const elements = ids.map((id) => document.getElementById(id)).filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))[0];
      if (visible && ids.includes(visible.target.id as SettingsSectionId)) setActiveSection(visible.target.id as SettingsSectionId);
    }, {rootMargin: "-90px 0px -65% 0px", threshold: [0, 0.15, 0.4]});
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  function update<K extends keyof UserPreferences>(section: K, patch: Partial<UserPreferences[K]>) {
    setDraft((current) => ({
      ...current,
      [section]: {...current[section], ...patch},
    }));
    setNotice(null);
  }

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      savePreferences(draft);
      applyThemePreference(draft.appearance.theme, true);
      applyAccessibilityPreferences(draft);
      setSaved(draft);
      const languageChanged = draft.language.interfaceLanguage !== locale;
      setNotice({tone: "success", text: languageChanged ? labels.savedAndMoved : labels.saved});
      if (languageChanged) {
        router.replace(`/${draft.language.interfaceLanguage}/settings`);
        router.refresh();
      }
    } catch {
      setNotice({tone: "danger", text: labels.storageError});
    } finally {
      setBusy(false);
    }
  }

  function resetDefaults() {
    setDraft(defaultPreferences(locale));
    setNotice({tone: "warning", text: labels.defaultsPrepared});
  }

  function revertChanges() {
    if (!saved) return;
    setDraft(saved);
    setNotice(null);
  }

  if (!ready) {
    return <div className="settings-loading surface" role="status">{isFa ? "در حال آماده‌سازی تنظیمات…" : "Preparing settings…"}</div>;
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
        <div className="settings-header-actions">
          {dirty ? <span className="settings-dirty-indicator" role="status">● {labels.dirty}</span> : null}
          {dirty ? <button className="button button-quiet" type="button" onClick={revertChanges}>{labels.revert}</button> : null}
          <button className="button button-secondary" type="button" onClick={resetDefaults}>{labels.reset}</button>
          <button className="button button-primary" type="button" onClick={() => void save()} disabled={!dirty || busy} aria-busy={busy}>
            {busy ? labels.saving : labels.save}
          </button>
        </div>
      </header>

      {notice ? <div className={`settings-notice settings-notice-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</div> : null}

      <div className="settings-layout">
        <aside className="settings-nav surface" aria-label={labels.navTitle}>
          <h2>{labels.navTitle}</h2>
          <nav>
            <a className={activeSection === "appearance" ? "active" : undefined} href="#appearance" onClick={() => setActiveSection("appearance")}><span>🎨</span>{labels.appearance}<b>‹</b></a>
            <a className={activeSection === "language" ? "active" : undefined} href="#language" onClick={() => setActiveSection("language")}><span>🌐</span>{labels.language}<b>‹</b></a>
            <a className={activeSection === "learning" ? "active" : undefined} href="#learning" onClick={() => setActiveSection("learning")}><span>🎯</span>{labels.learning}<b>‹</b></a>
            <a className={activeSection === "review" ? "active" : undefined} href="#review" onClick={() => setActiveSection("review")}><span>🔁</span>{labels.review}<b>‹</b></a>
            <a className={activeSection === "notifications" ? "active" : undefined} href="#notifications" onClick={() => setActiveSection("notifications")}><span>🔔</span>{labels.notifications}<b>‹</b></a>
            <a className={activeSection === "accessibility" ? "active" : undefined} href="#accessibility" onClick={() => setActiveSection("accessibility")}><span>♿</span>{labels.accessibility}<b>‹</b></a>
            <a className={activeSection === "account" ? "active" : undefined} href="#account" onClick={() => setActiveSection("account")}><span>👤</span>{labels.account}<b>‹</b></a>
          </nav>
          <div className="settings-nav-note">
            <strong>{labels.allSettings}</strong>
            <p>{labels.localNote}</p>
          </div>
        </aside>

        <div className="settings-main" aria-label={labels.title}>
          <SettingsSection id="appearance" icon="🎨" title={labels.appearance}>
            <SettingRow title={labels.theme} help={labels.themeHelp}>
              <div className="settings-segmented" role="group" aria-label={labels.theme}>
                {(["light", "dark", "system"] as const).map((theme) => (
                  <button
                    type="button"
                    key={theme}
                    className={draft.appearance.theme === theme ? "selected" : ""}
                    aria-pressed={draft.appearance.theme === theme}
                    onClick={() => update("appearance", {theme})}
                  >
                    {theme === "light" ? labels.light : theme === "dark" ? labels.dark : labels.system}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow title={labels.density} help={labels.densityHelp}>
              <select value={draft.appearance.density} onChange={(event: ChangeEvent<HTMLSelectElement>) => update("appearance", {density: event.target.value as UserPreferences["appearance"]["density"]})}>
                <option value="compact">{labels.compact}</option>
                <option value="comfortable">{labels.comfortable}</option>
                <option value="spacious">{labels.spacious}</option>
              </select>
            </SettingRow>
            <SettingRow title={labels.reduceMotion} help={labels.reduceMotionHelp}>
              <Switch checked={draft.appearance.reduceMotion} label={labels.reduceMotion} onChange={(checked) => update("appearance", {reduceMotion: checked})} />
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="learning" icon="🎯" title={labels.learning}>
            <div className="settings-choice-block">
              <div className="settings-row-copy">
                <strong>{labels.defaultPractice}</strong>
                <small>{labels.defaultPracticeHelp}</small>
              </div>
              <div className="settings-radio-cards">
                <button type="button" className={draft.learning.practiceMode === "adaptive" ? "selected" : ""} onClick={() => update("learning", {practiceMode: "adaptive"})} aria-pressed={draft.learning.practiceMode === "adaptive"}>
                  <span className="radio-dot" />
                  <strong dir="ltr">{labels.adaptive}</strong>
                  <small>{labels.adaptiveHelp}</small>
                </button>
                <button type="button" className={draft.learning.practiceMode === "custom" ? "selected" : ""} onClick={() => update("learning", {practiceMode: "custom"})} aria-pressed={draft.learning.practiceMode === "custom"}>
                  <span className="radio-dot" />
                  <strong dir="ltr">{labels.custom}</strong>
                  <small>{labels.customHelp}</small>
                </button>
              </div>
            </div>
            <SettingRow title={labels.questionCount} help={labels.questionCountHelp}>
              <select value={draft.learning.questionCount} onChange={(event: ChangeEvent<HTMLSelectElement>) => update("learning", {questionCount: Number(event.target.value)})}>
                {[10, 15, 20, 25, 30, 40, 50].map((count) => <option key={count} value={count}>{count} {labels.questionUnit}</option>)}
              </select>
            </SettingRow>
            <SettingRow title={labels.difficulty} help={labels.difficultyHelp}>
              <div className="settings-segmented" role="group" aria-label={labels.difficulty}>
                {(["easy", "mixed", "hard"] as const).map((difficulty) => (
                  <button
                    type="button"
                    key={difficulty}
                    className={draft.learning.difficulty === difficulty ? "selected" : ""}
                    onClick={() => update("learning", {difficulty})}
                    aria-pressed={draft.learning.difficulty === difficulty}
                  >
                    {difficulty === "easy" ? labels.easy : difficulty === "mixed" ? labels.mixed : labels.hard}
                  </button>
                ))}
              </div>
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="review" icon="🔁" title={labels.review}>
            <SettingRow title={labels.spacedReview} help={labels.spacedReviewHelp}>
              <Switch checked={draft.review.showSpacedReview} label={labels.spacedReview} onChange={(checked) => update("review", {showSpacedReview: checked})} />
            </SettingRow>
            <SettingRow title={labels.reviewPriority} help={labels.reviewPriorityHelp}>
              <select value={draft.review.priority} onChange={(event: ChangeEvent<HTMLSelectElement>) => update("review", {priority: event.target.value as UserPreferences["review"]["priority"]})}>
                <option value="mistakes">{labels.mistakesFirst}</option>
                <option value="due">{labels.dueFirst}</option>
                <option value="balanced">{labels.balanced}</option>
              </select>
            </SettingRow>
            <SettingRow title={`${labels.dailyReviewLimit}: ${draft.review.dailyLimit}`} help={labels.dailyReviewLimitHelp}>
              <div className="settings-range-control">
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={draft.review.dailyLimit}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => update("review", {dailyLimit: Number(event.target.value)})}
                  aria-label={labels.dailyReviewLimit}
                />
                {draft.review.dailyLimit === 15 ? <span>{labels.recommended}</span> : null}
              </div>
            </SettingRow>
          </SettingsSection>
        </div>

        <div className="settings-side-stack">
          <SettingsSection id="language" icon="🌐" title={labels.language} compact>
            <SettingRow title={labels.interfaceLanguage} help={labels.interfaceLanguageHelp} stacked>
              <div className="settings-segmented full" role="group" aria-label={labels.interfaceLanguage}>
                <button type="button" className={draft.language.interfaceLanguage === "fa" ? "selected" : ""} onClick={() => update("language", {interfaceLanguage: "fa"})} aria-pressed={draft.language.interfaceLanguage === "fa"}>{labels.persian}</button>
                <button type="button" className={draft.language.interfaceLanguage === "en" ? "selected" : ""} onClick={() => update("language", {interfaceLanguage: "en"})} aria-pressed={draft.language.interfaceLanguage === "en"}>{labels.english}</button>
              </div>
            </SettingRow>
            <SettingRow title={labels.explanationLanguage} help={labels.explanationLanguageHelp} stacked>
              <select value={draft.language.explanationLanguage} onChange={(event: ChangeEvent<HTMLSelectElement>) => update("language", {explanationLanguage: event.target.value as UserPreferences["language"]["explanationLanguage"]})}>
                <option value="fa">{labels.persian} (FA)</option>
                <option value="en">{labels.english} (EN)</option>
              </select>
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="notifications" icon="🔔" title={labels.notifications} compact>
            <SettingRow title={labels.dueNotifications} help={labels.dueNotificationsHelp} stacked>
              <Switch checked={draft.notifications.dueReviews} label={labels.dueNotifications} onChange={(checked) => update("notifications", {dueReviews: checked})} />
            </SettingRow>
            <SettingRow title={labels.streakNotifications} help={labels.streakNotificationsHelp} stacked>
              <Switch checked={draft.notifications.streakAndDailyGoal} label={labels.streakNotifications} onChange={(checked) => update("notifications", {streakAndDailyGoal: checked})} />
            </SettingRow>
            <SettingRow title={labels.weeklyReport} help={labels.weeklyReportHelp} stacked>
              <Switch checked={draft.notifications.weeklyReport} label={labels.weeklyReport} onChange={(checked) => update("notifications", {weeklyReport: checked})} />
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="accessibility" icon="♿" title={labels.accessibility} compact>
            <SettingRow title={labels.fontSize} help={labels.fontSizeHelp} stacked>
              <select value={draft.accessibility.fontScale} onChange={(event: ChangeEvent<HTMLSelectElement>) => update("accessibility", {fontScale: Number(event.target.value) as UserPreferences["accessibility"]["fontScale"]})}>
                {[90, 100, 110, 120, 130].map((scale) => <option key={scale} value={scale}>{scale}%</option>)}
              </select>
            </SettingRow>
            <SettingRow title={labels.highContrast} help={labels.highContrastHelp} stacked>
              <Switch checked={draft.accessibility.highContrast} label={labels.highContrast} onChange={(checked) => update("accessibility", {highContrast: checked})} />
            </SettingRow>
            <SettingRow title={labels.keyboard} help={labels.keyboardHelp} stacked>
              <Switch checked={draft.accessibility.keyboardShortcuts} label={labels.keyboard} onChange={(checked) => update("accessibility", {keyboardShortcuts: checked})} />
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="account" icon="👤" title={labels.account} compact danger>
            {authenticated ? (
              <>
                <SettingRow title={labels.profile} help={labels.profileHelp} stacked>
                  <Link className="button button-secondary settings-account-button" href={`/${locale}/profile`}>{labels.openProfile}</Link>
                </SettingRow>
                <SettingRow title={labels.dashboard} help={labels.dashboardHelp} stacked>
                  <Link className="button button-secondary settings-account-button" href={`/${locale}/dashboard`}>{labels.openDashboard}</Link>
                </SettingRow>
                <SettingRow title={labels.security} help={labels.securityHelp} stacked>
                  <span className="settings-contract-badge">API contract pending</span>
                </SettingRow>
                <SettingRow title={labels.logout} help={isFa ? "جلسه فعلی شما خاتمه پیدا می‌کند." : "Ends your current session."} stacked>
                  <LogoutButton locale={locale} label={labels.logout} />
                </SettingRow>
              </>
            ) : (
              <div className="settings-signed-out">
                <p>{labels.signedOut}</p>
                <Link className="button button-primary" href={`/${locale}/login`}>{labels.login}</Link>
              </div>
            )}
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  id,
  icon,
  title,
  children,
  compact = false,
  danger = false,
}: {
  id: string;
  icon: string;
  title: string;
  children: ReactNode;
  compact?: boolean;
  danger?: boolean;
}) {
  return (
    <section id={id} className={`settings-section surface${compact ? " settings-section-compact" : ""}${danger ? " settings-section-danger" : ""}`}>
      <h2><span aria-hidden="true">{icon}</span>{title}</h2>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function SettingRow({
  title,
  help,
  children,
  stacked = false,
}: {
  title: string;
  help: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={`settings-row${stacked ? " settings-row-stacked" : ""}`}>
      <div className="settings-row-copy">
        <strong>{title}</strong>
        <small>{help}</small>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Switch({checked, onChange, label}: {checked: boolean; onChange: (checked: boolean) => void; label: string}) {
  return (
    <button
      className={`settings-switch${checked ? " is-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

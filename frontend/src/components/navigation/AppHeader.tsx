"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect, useRef, useState} from "react";
import {LogoutButton} from "@/components/navigation/LogoutButton";
import {MobileBottomNavigation} from "@/components/navigation/MobileBottomNavigation";
import {ThemeToggle} from "@/components/navigation/ThemeToggle";
import {apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import {t} from "@/lib/i18n";
import styles from "./AppHeader.module.css";

const NOTIFICATION_UNREAD_KEY = "gmp-notifications-unread-v1";
const NOTIFICATION_CHANGE_EVENT = "gmp-notifications-changed";

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : null;
}

function readReviewDueCount(value: unknown): number | null {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const queue = asRecord(data?.review_queue);
  const due = queue?.due_count;
  if (typeof due === "number" && Number.isFinite(due)) return Math.max(0, Math.floor(due));
  if (typeof due === "string" && due.trim() && Number.isFinite(Number(due))) {
    return Math.max(0, Math.floor(Number(due)));
  }
  return null;
}

function AuthBrandMark() {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M5 5.5h7.8c1.5 0 2.7.6 3.2 1.6.6-1 1.8-1.6 3.3-1.6H23v16h-4.2c-1.8 0-3.1.6-3.8 1.6-.7-1-2-1.6-3.8-1.6H5v-16Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15 7.2v15.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.5 10.2c0-3.25 2.05-5.45 5.5-5.45s5.5 2.2 5.5 5.45v3.25l1.6 2.35H4.9l1.6-2.35V10.2Z" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" />
      <path d="M9.7 18.2c.45.72 1.22 1.05 2.3 1.05s1.85-.33 2.3-1.05" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.25" r="3.25" stroke="currentColor" strokeWidth="1.65" />
      <path d="M5.8 19.1c.7-3.25 2.75-5 6.2-5s5.5 1.75 6.2 5" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m7.5 5.5 4.5 4.5-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppHeader({locale, authenticated}: {locale: Locale; authenticated: boolean}) {
  const labels = t(locale);
  const isFa = locale === "fa";
  const otherLocale = locale === "fa" ? "en" : "fa";
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(true);
  const [reviewDueCount, setReviewDueCount] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);

  const segments = pathname.split("/").filter(Boolean);
  const isFocusedAttempt = segments.length === 3 && segments[1] === "attempts";
  const isServiceUnavailableSurface = segments[1] === "error";
  const isAuthSurface = ["login", "register", "forgot-password", "reset-password"].includes(segments[1] ?? "");

  useEffect(() => {
    const syncUnread = () => {
      try {
        const stored = window.localStorage.getItem(NOTIFICATION_UNREAD_KEY);
        setHasUnreadNotifications(stored === null ? true : Number(stored) > 0);
      } catch {
        setHasUnreadNotifications(true);
      }
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    syncUnread();
    window.addEventListener("storage", syncUnread);
    window.addEventListener(NOTIFICATION_CHANGE_EVENT, syncUnread);
    return () => {
      window.removeEventListener("storage", syncUnread);
      window.removeEventListener(NOTIFICATION_CHANGE_EVENT, syncUnread);
    };
  }, []);

  useEffect(() => {
    if (!authenticated || isFocusedAttempt) return;
    let cancelled = false;
    void (async () => {
      try {
        const dashboard = await apiRequest<unknown>("/api/backend/dashboard");
        const due = readReviewDueCount(dashboard);
        if (!cancelled && due !== null) setReviewDueCount(due);
      } catch {
        // Navigation remains fully usable if the badge source is temporarily unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, isFocusedAttempt, pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";

    const drawer = drawerRef.current;
    const focusable = drawer
      ? Array.from(drawer.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"))
      : [];
    focusable[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAccountOpen(false);
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      (avatarRef.current ?? previousFocus)?.focus();
    };
  }, [accountOpen]);

  if (isFocusedAttempt) return null;

  if (isAuthSurface || isServiceUnavailableSurface) {
    const routeTail = segments.slice(1).join("/") || "login";
    const brandHref = isServiceUnavailableSurface && authenticated ? `/${locale}/dashboard` : `/${locale}/login`;
    return (
      <header className={styles.authHeader}>
        <div className={styles.authHeaderInner}>
          <Link className={styles.authBrand} href={brandHref}>
            <span className={styles.authBrandMark}><AuthBrandMark /></span>
            <span className={styles.authBrandLabel} aria-label="Grammar Mastery">
              <strong>GRAMMAR</strong>
              <small>MASTERY</small>
            </span>
          </Link>
          <div className={styles.authHeaderActions}>
            <ThemeToggle locale={locale} />
            <Link className={styles.authLocaleSwitch} href={`/${otherLocale}/${routeTail}`} hrefLang={otherLocale}>
              {otherLocale.toUpperCase()} <span aria-hidden="true">▾</span>
            </Link>
            {isServiceUnavailableSurface ? (
              <Link className={styles.authPrimaryLink} href={authenticated ? `/${locale}/dashboard` : `/${locale}/login`}>
                {authenticated ? labels.dashboard : labels.login}
              </Link>
            ) : null}
          </div>
        </div>
      </header>
    );
  }

  const navigation = (
    <ul className="nav-list">
      <li><Link href={`/${locale}/dashboard`} prefetch={authenticated}>{labels.dashboard}</Link></li>
      <li><Link href={`/${locale}/tests/new`} prefetch={authenticated}>{labels.practice}</Link></li>
      <li><Link href={`/${locale}/review`} prefetch={authenticated}>{labels.review}</Link></li>
      <li><Link href={`/${locale}/lessons`} prefetch={authenticated}>{labels.lessons}</Link></li>
      <li><Link href={`/${locale}/progress`} prefetch={authenticated}>{labels.progress}</Link></li>
    </ul>
  );

  const accountActions = (
    <>
      <Link className={styles.notificationLink} href={`/${locale}/notifications`} prefetch={authenticated} aria-label={labels.notifications} title={labels.notifications}>
        <BellIcon />
        {hasUnreadNotifications ? <span className={styles.notificationDot} aria-hidden="true" /> : null}
        <span className={styles.notificationLabel}>{labels.notifications}</span>
      </Link>
      <ThemeToggle locale={locale} />
      <Link className="locale-switch" href={`/${otherLocale}/dashboard`} hrefLang={otherLocale} prefetch={authenticated}>
        {otherLocale === "fa" ? "فارسی" : "English"}
      </Link>
      {authenticated ? <LogoutButton locale={locale} label={labels.logout} /> : (
        <Link className="button button-quiet" href={`/${locale}/login`}>{labels.login}</Link>
      )}
    </>
  );

  const drawerLinks = [
    {href: `/${locale}/profile`, label: isFa ? "پروفایل" : "Profile", code: "P"},
    {href: `/${locale}/history`, label: isFa ? "تاریخچه" : "History", code: "H"},
    {href: `/${locale}/settings`, label: isFa ? "تنظیمات" : "Settings", code: "S"},
    {href: `/${locale}/notifications`, label: labels.notifications, code: "N"},
  ];

  return (
    <>
      <header className={`app-header ${styles.appChrome}`}>
        <div className={`header-inner ${styles.headerInner}`}>
          <Link className={`brand ${styles.desktopBrand}`} href={`/${locale}/dashboard`} prefetch={authenticated}>
            <span className="brand-mark" aria-hidden="true">G</span>
            <span className="brand-label">{labels.productName}</span>
          </Link>

          <Link className={styles.mobileBrand} href={`/${locale}/dashboard`} prefetch={authenticated} aria-label="Grammar Mastery">
            <span className={styles.mobileBrandMark}><AuthBrandMark /></span>
            <span className={styles.mobileBrandLabel}>
              <strong>GRAMMAR</strong>
              <small>MASTERY</small>
            </span>
          </Link>

          <nav className="desktop-nav" aria-label={isFa ? "ناوبری اصلی" : "Primary navigation"}>{navigation}</nav>
          <div className="desktop-header-actions">{accountActions}</div>

          <div className={styles.mobileHeaderActions}>
            <Link className={`${styles.notificationLink} ${styles.mobileNotificationLink}`} href={`/${locale}/notifications`} prefetch={authenticated} aria-label={labels.notifications} title={labels.notifications}>
              <BellIcon />
              {hasUnreadNotifications ? <span className={styles.notificationDot} aria-hidden="true" /> : null}
            </Link>
            {authenticated ? (
              <button
                ref={avatarRef}
                className={styles.mobileAvatarButton}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={accountOpen}
                aria-controls="mobile-account-drawer"
                aria-label={isFa ? "باز کردن منوی حساب" : "Open account menu"}
                onClick={() => setAccountOpen(true)}
              >
                <UserIcon />
                {hasUnreadNotifications ? <span className={styles.avatarUnreadDot} aria-hidden="true" /> : null}
              </button>
            ) : (
              <Link className={styles.mobileAvatarButton} href={`/${locale}/login`} aria-label={labels.login}>
                <UserIcon />
              </Link>
            )}
          </div>
        </div>
      </header>

      <MobileBottomNavigation
        locale={locale}
        pathname={pathname}
        authenticated={authenticated}
        reviewDueCount={reviewDueCount}
      />

      {authenticated && accountOpen ? (
        <div className={styles.drawerLayer}>
          <button className={styles.drawerBackdrop} type="button" aria-label={isFa ? "بستن منوی حساب" : "Close account menu"} onClick={() => setAccountOpen(false)} />
          <div
            id="mobile-account-drawer"
            ref={drawerRef}
            className={styles.mobileAccountDrawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-account-title"
          >
            <div className={styles.drawerHandle} aria-hidden="true" />
            <div className={styles.drawerSummary}>
              <span className={styles.drawerAvatar}><UserIcon /></span>
              <div>
                <strong id="mobile-account-title">Grammar Mastery</strong>
                <span dir="ltr">B1 → B2</span>
              </div>
              <button className={styles.drawerClose} type="button" onClick={() => setAccountOpen(false)} aria-label={isFa ? "بستن" : "Close"}>×</button>
            </div>

            <nav className={styles.drawerNav} aria-label={isFa ? "منوی حساب کاربری" : "Account menu"}>
              {drawerLinks.map((item) => (
                <Link key={item.href} href={item.href} prefetch={authenticated} onClick={() => setAccountOpen(false)}>
                  <span className={styles.drawerItemCode} aria-hidden="true">{item.code}</span>
                  <span>{item.label}</span>
                  <span className={styles.drawerChevron}><ChevronIcon /></span>
                </Link>
              ))}
            </nav>

            <div className={styles.drawerLogout}>
              <LogoutButton locale={locale} label={labels.logout} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

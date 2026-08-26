"use client";

import Link from "next/link";
import {usePathname, useSearchParams} from "next/navigation";
import {useEffect, useRef, useState} from "react";
import {ThemeToggle} from "@/components/navigation/ThemeToggle";
import {UserMenu} from "@/components/navigation/UserMenu";
import type {Locale} from "@/lib/i18n";
import {t} from "@/lib/i18n";
import styles from "./AppHeader.module.css";

const NOTIFICATION_UNREAD_KEY = "gmp-notifications-unread-v1";
const NOTIFICATION_CHANGE_EVENT = "gmp-notifications-changed";

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

export function AppHeader({locale, authenticated}: {locale: Locale; authenticated: boolean}) {
  const labels = t(locale);
  const otherLocale = locale === "fa" ? "en" : "fa";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const headerRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(1);

  const segments = pathname.split("/").filter(Boolean);
  const isFocusedAttempt = segments.length === 3 && segments[1] === "attempts";
  const isServiceUnavailableSurface = segments[1] === "error";
  const isAuthSurface = ["login", "register", "forgot-password", "reset-password"].includes(segments[1] ?? "");

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [menuOpen]);

  useEffect(() => {
    const syncUnread = () => {
      try {
        const stored = window.localStorage.getItem(NOTIFICATION_UNREAD_KEY);
        setUnreadNotificationCount(stored === null ? 1 : Math.max(0, Number(stored) || 0));
      } catch {
        setUnreadNotificationCount(1);
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

  if (isFocusedAttempt) return null;

  if (isAuthSurface || isServiceUnavailableSurface) {
    const routeTail = segments.slice(1).join("/") || "login";
    const queryString = searchParams.toString();
    const authLocaleHref = `/${otherLocale}/${routeTail}${queryString ? `?${queryString}` : ""}`;
    const brandHref = isServiceUnavailableSurface && authenticated ? `/${locale}/dashboard` : `/${locale}/login`;
    return (
      <header className={styles.authHeader} ref={headerRef}>
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
            <Link className={styles.authLocaleSwitch} href={authLocaleHref} hrefLang={otherLocale}>
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

  const notificationAction = (
    <Link className={styles.notificationLink} href={`/${locale}/notifications`} prefetch={authenticated} aria-label={labels.notifications} title={labels.notifications}>
      <BellIcon />
      {unreadNotificationCount > 0 ? <span className={styles.notificationDot} aria-hidden="true" /> : null}
      <span className={styles.notificationLabel}>{labels.notifications}</span>
    </Link>
  );

  const localeSwitch = (
    <Link className="locale-switch" href={`/${otherLocale}/dashboard`} hrefLang={otherLocale} prefetch={authenticated}>
      {otherLocale === "fa" ? "فارسی" : "English"}
    </Link>
  );

  const desktopAccountActions = (
    <>
      {notificationAction}
      <ThemeToggle locale={locale} />
      {localeSwitch}
      {authenticated ? (
        <UserMenu locale={locale} unreadCount={unreadNotificationCount} />
      ) : (
        <Link className="button button-quiet" href={`/${locale}/login`}>{labels.login}</Link>
      )}
    </>
  );

  const mobilePanelActions = (
    <>
      {notificationAction}
      <ThemeToggle locale={locale} />
      {localeSwitch}
      {!authenticated ? <Link className="button button-quiet" href={`/${locale}/login`}>{labels.login}</Link> : null}
    </>
  );

  return (
    <header className="app-header" ref={headerRef}>
      <div className="header-inner">
        <Link className="brand" href={`/${locale}/dashboard`} prefetch={authenticated}>
          <span className="brand-mark" aria-hidden="true">G</span>
          <span className="brand-label">{labels.productName}</span>
        </Link>
        <nav className="desktop-nav" aria-label={locale === "fa" ? "ناوبری اصلی" : "Primary navigation"}>{navigation}</nav>
        <div className="desktop-header-actions">{desktopAccountActions}</div>
        <button
          className="mobile-menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          aria-label={menuOpen ? (locale === "fa" ? "بستن منو" : "Close menu") : (locale === "fa" ? "باز کردن منو" : "Open menu")}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span className="menu-icon" aria-hidden="true"><span /><span /><span /></span>
        </button>
        {authenticated ? (
          <div className={styles.mobileAccountTrigger}>
            <UserMenu locale={locale} unreadCount={unreadNotificationCount} />
          </div>
        ) : null}
        <div id="mobile-navigation" className={`mobile-nav-panel${menuOpen ? " mobile-nav-open" : ""}`} onClick={() => setMenuOpen(false)}>
          <nav aria-label={locale === "fa" ? "ناوبری موبایل" : "Mobile navigation"}>{navigation}</nav>
          <div className="mobile-header-actions">{mobilePanelActions}</div>
        </div>
      </div>
    </header>
  );
}

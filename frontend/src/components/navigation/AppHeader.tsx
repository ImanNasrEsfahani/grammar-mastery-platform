"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect, useRef, useState} from "react";
import {LogoutButton} from "@/components/navigation/LogoutButton";
import {ThemeToggle} from "@/components/navigation/ThemeToggle";
import type {Locale} from "@/lib/i18n";
import {t} from "@/lib/i18n";
import styles from "./AppHeader.module.css";

function AuthBrandMark() {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M5 5.5h7.8c1.5 0 2.7.6 3.2 1.6.6-1 1.8-1.6 3.3-1.6H23v16h-4.2c-1.8 0-3.1.6-3.8 1.6-.7-1-2-1.6-3.8-1.6H5v-16Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15 7.2v15.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AppHeader({locale, authenticated}: {locale: Locale; authenticated: boolean}) {
  const labels = t(locale);
  const otherLocale = locale === "fa" ? "en" : "fa";
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const segments = pathname.split("/").filter(Boolean);
  const isFocusedAttempt = segments.length === 3 && segments[1] === "attempts";
  const isWeaknessDetail = segments[1] === "weakness";
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

  // Weakness detail owns the reference header because its approved design uses a
  // full-width 1440px shell that differs from the standard application header.
  if (isFocusedAttempt || isWeaknessDetail) return null;

  if (isAuthSurface || isServiceUnavailableSurface) {
    const routeTail = segments.slice(1).join("/") || "login";
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
    </ul>
  );

  const accountActions = (
    <>
      <ThemeToggle locale={locale} />
      <Link className="locale-switch" href={`/${otherLocale}/dashboard`} hrefLang={otherLocale} prefetch={authenticated}>
        {otherLocale === "fa" ? "فارسی" : "English"}
      </Link>
      {authenticated ? <LogoutButton locale={locale} label={labels.logout} /> : (
        <Link className="button button-quiet" href={`/${locale}/login`}>{labels.login}</Link>
      )}
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
        <div className="desktop-header-actions">{accountActions}</div>
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
        <div id="mobile-navigation" className={`mobile-nav-panel${menuOpen ? " mobile-nav-open" : ""}`} onClick={() => setMenuOpen(false)}>
          <nav aria-label={locale === "fa" ? "ناوبری موبایل" : "Mobile navigation"}>{navigation}</nav>
          <div className="mobile-header-actions">{accountActions}</div>
        </div>
      </div>
    </header>
  );
}

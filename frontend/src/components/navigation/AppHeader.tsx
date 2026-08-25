"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect, useRef, useState} from "react";
import {LogoutButton} from "@/components/navigation/LogoutButton";
import {ThemeToggle} from "@/components/navigation/ThemeToggle";
import type {Locale} from "@/lib/i18n";
import {t} from "@/lib/i18n";

export function AppHeader({locale, authenticated}: {locale: Locale; authenticated: boolean}) {
  const labels = t(locale);
  const otherLocale = locale === "fa" ? "en" : "fa";
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const segments = pathname.split("/").filter(Boolean);
  const isFocusedAttempt = segments.length === 3 && segments[1] === "attempts";

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

  if (isFocusedAttempt) return null;

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

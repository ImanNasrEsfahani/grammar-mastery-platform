"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {ThemeToggle} from "@/components/navigation/ThemeToggle";
import type {Locale} from "@/lib/i18n";
import {t} from "@/lib/i18n";

export function NotFoundContent() {
  const pathname = usePathname();
  const locale: Locale = pathname?.split("/")[1] === "en" ? "en" : "fa";
  const isFa = locale === "fa";
  const labels = t(locale);
  const otherLocale = locale === "fa" ? "en" : "fa";

  const nav = [
    [labels.dashboard, `/${locale}/dashboard`],
    [labels.practice, `/${locale}/tests/new`],
    [labels.review, `/${locale}/review`],
    [labels.lessons, `/${locale}/lessons`],
    [labels.progress, `/${locale}/progress`],
  ] as const;

  return (
    <div className="not-found-page" lang={locale === "fa" ? "fa-IR" : "en-CA"} dir={isFa ? "rtl" : "ltr"}>
      <header className="not-found-header">
        <Link className="brand" href={`/${locale}/dashboard`}>
          <span className="brand-mark" aria-hidden="true">G</span>
          <span className="brand-label">{labels.productName}</span>
        </Link>
        <nav className="not-found-nav" aria-label={isFa ? "میانبرهای اصلی" : "Primary shortcuts"}>
          {nav.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className="not-found-header-actions">
          <ThemeToggle locale={locale} />
          <Link className="locale-switch" href={`/${otherLocale}/dashboard`} hrefLang={otherLocale}>{otherLocale === "fa" ? "FA" : "EN"}</Link>
        </div>
      </header>

      <main className="not-found-main">
        <section className="not-found-shell" aria-labelledby="not-found-title">
          <div className="not-found-visual" aria-hidden="true">
            <strong>404</strong>
            <svg viewBox="0 0 420 300" fill="none">
              <path className="not-found-line-soft" d="M62 188c55-92 173-72 181 22 3 42-17 68-43 83" />
              <path className="not-found-line" d="M286 82 240 251M286 82l48 169M258 181h56M250 213h74" />
              <path className="not-found-line" d="M70 219h83v60H70zM70 219l41 27 42-27" />
              <path className="not-found-line-soft" d="M154 177c-38 42-43 99 4 126" />
            </svg>
            <p>{isFa ? "مسیر پیدا نشد؛ اما یادگیری ادامه دارد." : "The route is missing; your learning path is not."}</p>
          </div>

          <div className="not-found-copy">
            <p className="eyebrow">404 · NOT FOUND</p>
            <h1 id="not-found-title">{isFa ? "این صفحه پیدا نشد" : "This page could not be found"}</h1>
            <p>{isFa ? "ممکن است لینک قدیمی باشد، صفحه حذف شده باشد یا آدرس به‌درستی وارد نشده باشد. از اینجا می‌توانید سریع به مسیر یادگیری برگردید." : "The link may be outdated, removed, or mistyped. Use one of the real learning routes below to get back on track."}</p>
            <div className="not-found-actions">
              <Link className="button button-primary" href={`/${locale}/dashboard`}>{isFa ? "بازگشت به داشبورد" : "Back to dashboard"}</Link>
              <Link className="button button-secondary" href={`/${locale}/lessons`}>{isFa ? "رفتن به درس‌ها" : "Browse lessons"}</Link>
            </div>
            <Link className="not-found-search-shortcut" href={`/${locale}/lessons`}>
              <span aria-hidden="true">⌕</span>
              <span>{isFa ? "پیدا کردن موضوع گرامری در نقشه درس‌ها" : "Find a grammar topic in the lesson map"}</span>
            </Link>
            <div className="not-found-shortcuts">
              <span>{isFa ? "میانبرها:" : "Shortcuts:"}</span>
              <Link href={`/${locale}/review`}>{isFa ? "صندوق بازبینی" : "Review Inbox"}</Link>
              <span aria-hidden="true">•</span>
              <Link href={`/${locale}/tests/new`}>{isFa ? "تمرین" : "Practice"}</Link>
              <span aria-hidden="true">•</span>
              <Link href={`/${locale}/progress`}>{isFa ? "پیشرفت" : "Progress"}</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="not-found-footer"><span>© 2026 Grammar Mastery</span></footer>
    </div>
  );
}

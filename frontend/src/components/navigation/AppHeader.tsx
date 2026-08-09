import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

export function AppHeader({locale}: {locale: Locale}) {
  const labels = t(locale);
  const otherLocale = locale === "fa" ? "en" : "fa";

  return (
    <header className="app-header">
      <div className="header-inner">
        <Link className="brand" href={`/${locale}/dashboard`}>
          <span className="brand-mark" aria-hidden="true">G</span>
          <span>{labels.productName}</span>
        </Link>
        <nav aria-label={locale === "fa" ? "ناوبری اصلی" : "Primary navigation"}>
          <ul className="nav-list">
            <li><Link href={`/${locale}/dashboard`}>{labels.dashboard}</Link></li>
            <li><Link href={`/${locale}/tests/new`}>{labels.practice}</Link></li>
            <li><Link href={`/${locale}/review`}>{labels.review}</Link></li>
            <li><Link href={`/${locale}/lessons`}>{labels.lessons}</Link></li>
          </ul>
        </nav>
        <Link className="locale-switch" href={`/${otherLocale}/dashboard`} hrefLang={otherLocale}>
          {otherLocale === "fa" ? "فارسی" : "English"}
        </Link>
      </div>
    </header>
  );
}

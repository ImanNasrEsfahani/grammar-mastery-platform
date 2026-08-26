import Link from "next/link";
import type {Locale} from "@/lib/i18n";
import styles from "./MobileBottomNavigation.module.css";

type NavId = "dashboard" | "lessons" | "practice" | "review" | "progress";

type NavItem = {
  id: NavId;
  suffix: string;
  label: string;
};

function NavIcon({id}: {id: NavId}) {
  if (id === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4.75 10.4 12 4.75l7.25 5.65v8.1a.75.75 0 0 1-.75.75H5.5a.75.75 0 0 1-.75-.75v-8.1Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M9.1 19.25v-5.6h5.8v5.6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }

  if (id === "lessons") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4.5 5.25h6.1c1.35 0 2.4.52 2.9 1.4.5-.88 1.55-1.4 2.9-1.4h3.1v13.5h-3.65c-1.15 0-1.95.4-2.35 1.05-.4-.65-1.2-1.05-2.35-1.05H4.5V5.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M13.5 6.65v13.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (id === "practice") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m8.35 5.9 10.1 6.1-10.1 6.1V5.9Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }

  if (id === "review") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M18.6 8.6A7.1 7.1 0 1 0 19 15.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M18.6 4.95V8.6h-3.65" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.25 17.8 9.2 13.9l3.15 2.65 6.4-7.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.9 9.45h3.85v3.85" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function activeIdForPath(pathname: string): NavId | null {
  const segments = pathname.split("/").filter(Boolean);
  const section = segments[1] ?? "";
  if (section === "dashboard") return "dashboard";
  if (section === "lessons") return "lessons";
  if (section === "tests") return "practice";
  if (section === "review") return "review";
  if (section === "progress") return "progress";
  return null;
}

export function MobileBottomNavigation({
  locale,
  pathname,
  authenticated,
  reviewDueCount,
}: {
  locale: Locale;
  pathname: string;
  authenticated: boolean;
  reviewDueCount: number;
}) {
  const isFa = locale === "fa";
  const items: NavItem[] = [
    {id: "dashboard", suffix: "dashboard", label: isFa ? "داشبورد" : "Dashboard"},
    {id: "lessons", suffix: "lessons", label: isFa ? "درس‌ها" : "Lessons"},
    {id: "practice", suffix: "tests/new", label: isFa ? "تمرین" : "Practice"},
    {id: "review", suffix: "review", label: isFa ? "مرور" : "Review"},
    {id: "progress", suffix: "progress", label: isFa ? "پیشرفت" : "Progress"},
  ];
  const activeId = activeIdForPath(pathname);
  const due = Number.isFinite(reviewDueCount) ? Math.max(0, Math.floor(reviewDueCount)) : 0;
  const badge = due > 99 ? "99+" : String(due);

  return (
    <div className={styles.dock}>
      <nav className={styles.nav} aria-label={isFa ? "ناوبری پایین موبایل" : "Mobile bottom navigation"}>
        {items.map((item) => {
          const active = item.id === activeId;
          const isReview = item.id === "review";
          return (
            <Link
              key={item.id}
              className={`${styles.item}${active ? ` ${styles.itemActive}` : ""}`}
              href={`/${locale}/${item.suffix}`}
              prefetch={authenticated}
              aria-current={active ? "page" : undefined}
            >
              <span className={styles.iconWrap}>
                <NavIcon id={item.id} />
                {isReview && due > 0 ? <span className={styles.badge} aria-hidden="true">{badge}</span> : null}
              </span>
              <span className={styles.label}>{item.label}</span>
              {isReview && due > 0 ? (
                <span className={styles.srOnly}>
                  {isFa ? `، ${due} مرور سررسیدشده` : `, ${due} reviews due`}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

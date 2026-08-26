"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {apiRequest} from "@/lib/api/client";
import type {DashboardEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import styles from "./UserMenu.module.css";

type UserMenuProps = {
  locale: Locale;
  displayName?: string;
  email?: string | null;
  levelPath?: string;
  unreadCount?: number;
};

const NOTIFICATION_UNREAD_KEY = "gmp-notifications-unread-v1";
const NOTIFICATION_CHANGE_EVENT = "gmp-notifications-changed";

type MenuIconName = "profile" | "history" | "settings" | "notifications" | "logout";

function Icon({name}: {name: MenuIconName}) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true as const,
  };
  switch (name) {
    case "profile":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M4 4v4.6h4.6M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
          <path d="m19 13.5 1.2 1-.9 2-1.6-.2a7 7 0 0 1-1.4 1.4l.2 1.6-2 .9-1-1.2a7 7 0 0 1-2 0l-1 1.2-2-.9.2-1.6a7 7 0 0 1-1.4-1.4l-1.6.2-.9-2 1.2-1a7 7 0 0 1 0-2l-1.2-1 .9-2 1.6.2a7 7 0 0 1 1.4-1.4l-.2-1.6 2-.9 1 1.2a7 7 0 0 1 2 0l1-1.2 2 .9-.2 1.6a7 7 0 0 1 1.4 1.4l1.6-.2.9 2-1.2 1a7 7 0 0 1 0 2Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        </svg>
      );
    case "notifications":
      return (
        <svg {...common}>
          <path d="M6.5 10.2c0-3.25 2.05-5.45 5.5-5.45s5.5 2.2 5.5 5.45v3.25l1.6 2.35H4.9l1.6-2.35V10.2Z" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" />
          <path d="M9.7 18.2c.45.72 1.22 1.05 2.3 1.05s1.85-.33 2.3-1.05" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0]?.slice(0, 1).toUpperCase() ?? "U";
  return `${parts[0]?.slice(0, 1) ?? ""}${parts.at(-1)?.slice(0, 1) ?? ""}`.toUpperCase();
}

function isMobileViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
}

export function UserMenu({
  locale,
  displayName,
  email = null,
  levelPath = "B1 → B2",
  unreadCount,
}: UserMenuProps) {
  const isFa = locale === "fa";
  const router = useRouter();
  const reactId = useId();
  const panelId = `user-menu-${reactId.replaceAll(":", "")}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storedUnreadCount, setStoredUnreadCount] = useState(0);
  const [masteryPct, setMasteryPct] = useState<number | null>(null);
  const masteryRequestedRef = useRef(false);

  const name = displayName?.trim() || (isFa ? "زبان‌آموز" : "Learner");
  const effectiveUnreadCount = unreadCount ?? storedUnreadCount;
  const hasUnread = effectiveUnreadCount > 0;

  const copy = useMemo(() => ({
    menu: isFa ? "منوی حساب کاربری" : "User account menu",
    trigger: isFa ? "باز کردن منوی حساب کاربری" : "Open user account menu",
    close: isFa ? "بستن منوی حساب کاربری" : "Close user account menu",
    account: isFa ? "حساب کاربری" : "Account",
    mastery: isFa ? "تسلط" : "Mastery",
    profile: isFa ? "پروفایل" : "Profile",
    profileHint: isFa ? "مشاهده و ویرایش حساب" : "View and edit your account",
    history: isFa ? "تاریخچه" : "History",
    historyHint: isFa ? "تمرین‌ها و نتایج گذشته" : "Past practice and results",
    settings: isFa ? "تنظیمات" : "Settings",
    settingsHint: isFa ? "ترجیحات و تنظیمات حساب" : "Preferences and account settings",
    logout: isFa ? "خروج" : "Log out",
    logoutHint: isFa ? "خروج امن از حساب" : "Sign out securely",
    loggingOut: isFa ? "در حال خروج…" : "Logging out…",
    notifications: isFa ? "اعلان‌ها" : "Notifications",
    notificationsHint: isFa ? "اعلان‌ها و یادآوری‌های یادگیری" : "Learning alerts and reminders",
    unread: isFa ? `${effectiveUnreadCount} اعلان خوانده‌نشده` : `${effectiveUnreadCount} unread notifications`,
  }), [effectiveUnreadCount, isFa]);

  const closeMenu = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    if (unreadCount !== undefined) return;
    const syncUnread = () => {
      try {
        const stored = window.localStorage.getItem(NOTIFICATION_UNREAD_KEY);
        setStoredUnreadCount(stored === null ? 1 : Math.max(0, Number(stored) || 0));
      } catch {
        setStoredUnreadCount(1);
      }
    };
    // Keep the user-menu unread state synchronized with the existing notification center.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    syncUnread();
    window.addEventListener("storage", syncUnread);
    window.addEventListener(NOTIFICATION_CHANGE_EVENT, syncUnread);
    return () => {
      window.removeEventListener("storage", syncUnread);
      window.removeEventListener(NOTIFICATION_CHANGE_EVENT, syncUnread);
    };
  }, [unreadCount]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const mobile = isMobileViewport();
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";

    const focusable = () => Array.from(
      panel?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hasAttribute("aria-hidden"));

    window.setTimeout(() => focusable()[0]?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "Tab" || !mobile) return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (mobile) return;
      if (!rootRef.current?.contains(event.target as Node)) closeMenu(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      if (mobile) document.body.style.overflow = previousOverflow;
    };
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open || masteryRequestedRef.current) return;
    let cancelled = false;
    masteryRequestedRef.current = true;
    void apiRequest<DashboardEnvelope>("/api/backend/dashboard")
      .then((dashboard) => {
        if (cancelled || !dashboard) return;
        const evidence = dashboard.data.mastery.filter(
          (item) => item.confidence > 0 && item.coverage_ratio > 0,
        );
        if (!evidence.length) return;
        const value = evidence.reduce((sum, item) => sum + item.mastery_score_pct, 0) / evidence.length;
        setMasteryPct(Math.round(value));
      })
      .catch(() => {
        // The account menu remains fully usable when dashboard enrichment is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/session/logout", {method: "POST", cache: "no-store"});
    } finally {
      router.replace(`/${locale}/login`);
      router.refresh();
    }
  }

  const items = [
    {key: "profile", icon: "profile" as const, href: `/${locale}/profile`, label: copy.profile, hint: copy.profileHint},
    {key: "history", icon: "history" as const, href: `/${locale}/history`, label: copy.history, hint: copy.historyHint},
    {key: "settings", icon: "settings" as const, href: `/${locale}/settings`, label: copy.settings, hint: copy.settingsHint},
    {key: "notifications", icon: "notifications" as const, href: `/${locale}/notifications`, label: copy.notifications, hint: copy.notificationsHint},
  ];

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${open ? copy.close : copy.trigger}${hasUnread ? `, ${copy.unread}` : ""}`}
        data-unread={hasUnread ? "true" : "false"}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>
        {hasUnread ? <span className={styles.unreadDot} aria-hidden="true" /> : null}
        <span className={styles.triggerCopy}>
          <strong>{name}</strong>
          <small dir="ltr">{levelPath}</small>
        </span>
        <svg className={styles.chevron} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m7 9.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {hasUnread ? <span className={styles.srOnly}>{copy.unread}</span> : null}
      </button>

      {open ? (
        <>
          <button className={styles.backdrop} type="button" aria-label={copy.close} onClick={() => closeMenu(true)} />
          <div
            id={panelId}
            ref={panelRef}
            className={styles.panel}
            role="menu"
            aria-label={copy.menu}
          >
            <div className={styles.summary}>
              <span className={styles.summaryAvatar} aria-hidden="true">{initials(name)}</span>
              <div className={styles.summaryCopy}>
                <strong>{name}</strong>
                <span>{email || copy.account}</span>
                <div className={styles.summaryMeta}>
                  <span className={styles.levelChip} dir="ltr">{levelPath}</span>
                  <span className={styles.masteryChip}>
                    {masteryPct === null ? `${copy.mastery}: —` : `${masteryPct}%`}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.separator} />

            <div className={styles.items}>
              {items.map((item) => (
                <Link
                  key={item.key}
                  className={styles.item}
                  href={item.href}
                  role="menuitem"
                  onClick={() => closeMenu(false)}
                >
                  <span className={styles.itemIcon}><Icon name={item.icon} /></span>
                  <span className={styles.itemCopy}>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                  <span className={styles.itemArrow} aria-hidden="true">›</span>
                </Link>
              ))}
            </div>

            <div className={styles.separator} />

            <button
              className={`${styles.item} ${styles.logout}`}
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={busy}
              aria-busy={busy}
            >
              <span className={styles.itemIcon}><Icon name="logout" /></span>
              <span className={styles.itemCopy}>
                <strong>{busy ? copy.loggingOut : copy.logout}</strong>
                <small>{copy.logoutHint}</small>
              </span>
              <span className={styles.itemArrow} aria-hidden="true">›</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

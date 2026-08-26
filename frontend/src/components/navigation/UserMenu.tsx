"use client";

import Link from "next/link";
import {usePathname, useRouter} from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {apiRequest} from "@/lib/api/client";
import type {DashboardEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import styles from "./UserMenu.module.css";

type AccountData = {
  id: string;
  email: string;
  display_name: string | null;
  locale: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  provider_version: string;
};

type AccountEnvelope = {
  data: AccountData;
  meta: {request_id: string; api_version: string};
};

type CachedAccountMenu = {
  savedAt: string;
  account: AccountData;
  overallMastery: number | null;
};

type MenuCopy = {
  account: string;
  profile: string;
  profileHint: string;
  history: string;
  historyHint: string;
  settings: string;
  settingsHint: string;
  notifications: string;
  notificationsHint: string;
  logout: string;
  logoutHint: string;
  logoutConfirm: string;
  cancel: string;
  loggingOut: string;
  learnerFallback: string;
  openMenu: string;
  closeMenu: string;
  unread: string;
};

const CACHE_KEY = "gmp-account-menu-safe-snapshot-v1";
const CURRENT_LEVEL = "B1";
const TARGET_LEVEL = "B2";

function copyFor(locale: Locale): MenuCopy {
  if (locale === "fa") {
    return {
      account: "حساب کاربری",
      profile: "پروفایل",
      profileHint: "مشاهده پروفایل",
      history: "تاریخچه",
      historyHint: "تاریخچه تمرین‌ها",
      settings: "تنظیمات",
      settingsHint: "تنظیمات حساب",
      notifications: "اعلان‌ها",
      notificationsHint: "مرکز اعلان‌ها",
      logout: "خروج",
      logoutHint: "خروج از حساب",
      logoutConfirm: "برای خروج از این حساب مطمئن هستید؟",
      cancel: "انصراف",
      loggingOut: "در حال خروج…",
      learnerFallback: "زبان‌آموز",
      openMenu: "باز کردن منوی حساب کاربری",
      closeMenu: "بستن منوی حساب کاربری",
      unread: "اعلان خوانده‌نشده",
    };
  }
  return {
    account: "Account",
    profile: "Profile",
    profileHint: "View your profile",
    history: "History",
    historyHint: "Practice history",
    settings: "Settings",
    settingsHint: "Account settings",
    notifications: "Notifications",
    notificationsHint: "Notification center",
    logout: "Log out",
    logoutHint: "Sign out of this account",
    logoutConfirm: "Are you sure you want to sign out?",
    cancel: "Cancel",
    loggingOut: "Logging out…",
    learnerFallback: "Learner",
    openMenu: "Open account menu",
    closeMenu: "Close account menu",
    unread: "Unread notification",
  };
}

function overallMastery(dashboard: DashboardEnvelope | null): number | null {
  if (!dashboard) return null;
  const evidence = dashboard.data.mastery.filter(
    (item) => item.confidence > 0 && item.coverage_ratio > 0,
  );
  if (!evidence.length) return null;
  return Math.round(
    evidence.reduce((sum, item) => sum + item.mastery_score_pct, 0) / evidence.length,
  );
}

function displayName(account: AccountData | null, fallback: string): string {
  const explicit = account?.display_name?.trim();
  if (explicit) return explicit;
  const emailName = account?.email?.split("@", 1)[0]?.trim();
  return emailName || fallback;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "G";
  const value = parts.slice(0, 2).map((part) => part.slice(0, 1)).join("");
  return value.toLocaleUpperCase();
}

function Chevron({down = false}: {down?: boolean}) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {down ? (
        <path d="m6.5 8 3.5 3.5L13.5 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="m8 6.5 3.5 3.5L8 13.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.2 18.5c.55-3.1 2.55-4.85 5.8-4.85s5.25 1.75 5.8 4.85" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.2 7.4V4.8m0 0h2.7m-2.7 0 2.15 2.1A7.4 7.4 0 1 1 4.8 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8.4v4l2.7 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.55" />
      <path d="M19.2 13.5v-3l-2-.55a7 7 0 0 0-.72-1.72l1.02-1.8-2.12-2.12-1.82 1.02A7 7 0 0 0 11.85 4L11.3 2h-3l-.55 2a7 7 0 0 0-1.72.72L4.2 3.7 2.1 5.82l1.02 1.82a7 7 0 0 0-.72 1.71l-2 .55v3l2 .55c.16.6.4 1.18.72 1.72L2.1 17l2.12 2.12 1.82-1.02c.54.32 1.11.56 1.71.72l.55 2h3l.55-2a7 7 0 0 0 1.72-.72l1.8 1.02L17.5 17l-1.02-1.82c.32-.54.56-1.11.72-1.68l2-.55Z" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" transform="translate(2.2 .6) scale(.82)" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.5 10.2c0-3.25 2.05-5.45 5.5-5.45s5.5 2.2 5.5 5.45v3.25l1.6 2.35H4.9l1.6-2.35V10.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9.7 18.2c.45.72 1.22 1.05 2.3 1.05s1.85-.33 2.3-1.05" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10.2 5H6.7A1.7 1.7 0 0 0 5 6.7v10.6A1.7 1.7 0 0 0 6.7 19h3.5" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
      <path d="M13 8.2 16.8 12 13 15.8M16.5 12H9.3" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccountAvatar({name, unread, compact = false}: {name: string; unread: boolean; compact?: boolean}) {
  return (
    <span className={`${styles.avatar}${compact ? ` ${styles.avatarCompact}` : ""}`} aria-hidden="true">
      <span>{initials(name)}</span>
      {unread ? <i className={styles.avatarUnreadDot} /> : null}
    </span>
  );
}

function AccountSummary({
  account,
  name,
  mastery,
  unread,
}: {
  account: AccountData | null;
  name: string;
  mastery: number | null;
  unread: boolean;
}) {
  return (
    <div className={styles.summary}>
      <AccountAvatar name={name} unread={unread} />
      <div className={styles.summaryCopy}>
        <strong dir="auto">{name}</strong>
        <span dir="ltr">{account?.email ?? ""}</span>
        <div className={styles.summaryBadges}>
          <span className={styles.levelBadge} dir="ltr">{CURRENT_LEVEL} → {TARGET_LEVEL}</span>
          {mastery !== null ? <span className={styles.masteryBadge}>{mastery}%</span> : null}
        </div>
      </div>
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  hint,
  active,
  badge,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  hint: string;
  active: boolean;
  badge?: number | null;
  onNavigate: () => void;
}) {
  return (
    <Link
      className={`${styles.menuItem}${active ? ` ${styles.menuItemActive}` : ""}`}
      href={href}
      role="menuitem"
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <span className={styles.menuIcon}>{icon}</span>
      <span className={styles.menuCopy}>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      {typeof badge === "number" && badge > 0 ? (
        <span className={styles.unreadBadge}>{Math.min(badge, 99)}</span>
      ) : null}
      <span className={styles.chevron}><Chevron /></span>
    </Link>
  );
}

export function UserMenu({
  locale,
  unreadCount,
}: {
  locale: Locale;
  unreadCount: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const copy = useMemo(() => copyFor(locale), [locale]);
  const isFa = locale === "fa";
  const rootRef = useRef<HTMLDivElement>(null);
  const desktopTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [mastery, setMastery] = useState<number | null>(null);

  const hasUnread = unreadCount === null ? true : unreadCount > 0;
  const name = displayName(account, copy.learnerFallback);

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      const accountPromise = apiRequest<AccountEnvelope>("/api/backend/account");
      const dashboardPromise = apiRequest<DashboardEnvelope>("/api/backend/dashboard");
      const [accountResult, dashboardResult] = await Promise.allSettled([
        accountPromise,
        dashboardPromise,
      ] as const);

      if (cancelled) return;

      let nextAccount: AccountData | null = null;
      let nextMastery: number | null = null;

      if (accountResult.status === "fulfilled" && accountResult.value) {
        nextAccount = accountResult.value.data;
      }
      if (dashboardResult.status === "fulfilled" && dashboardResult.value) {
        nextMastery = overallMastery(dashboardResult.value);
      }

      if (nextAccount) {
        setAccount(nextAccount);
        setMastery(nextMastery);
        try {
          const cached: CachedAccountMenu = {
            savedAt: new Date().toISOString(),
            account: nextAccount,
            overallMastery: nextMastery,
          };
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(cached));
        } catch {
          // Session storage can be blocked; live account data is still usable.
        }
        return;
      }

      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return;
        const cached = JSON.parse(raw) as CachedAccountMenu;
        if (!cached?.account?.email) return;
        setAccount(cached.account);
        setMastery(cached.overallMastery ?? null);
      } catch {
        // A corrupt/blocked cache must never stop the header from rendering.
      }
    }

    void loadAccount();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!desktopOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setDesktopOpen(false);
        setLogoutConfirm(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDesktopOpen(false);
      setLogoutConfirm(false);
      desktopTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [desktopOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const drawer = drawerRef.current;
    const focusables = () => Array.from(
      drawer?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((node) => !node.hasAttribute("hidden"));

    requestAnimationFrame(() => focusables()[0]?.focus());

    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        setLogoutConfirm(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items.at(0);
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

    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [mobileOpen]);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function closeAll() {
    setDesktopOpen(false);
    setMobileOpen(false);
    setLogoutConfirm(false);
  }

  function openDesktopFromKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    setDesktopOpen(true);
    requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
  }

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await fetch("/api/session/logout", {method: "POST", cache: "no-store"});
    } finally {
      closeAll();
      router.replace(`/${locale}/login`);
      router.refresh();
      setLogoutBusy(false);
    }
  }

  const profileHref = `/${locale}/profile`;
  const historyHref = `/${locale}/history`;
  const settingsHref = `/${locale}/settings`;
  const notificationsHref = `/${locale}/notifications`;

  const desktopItems = (
    <>
      <MenuLink href={profileHref} icon={<PersonIcon />} label={copy.profile} hint={copy.profileHint} active={isActive(profileHref)} onNavigate={closeAll} />
      <MenuLink href={historyHref} icon={<HistoryIcon />} label={copy.history} hint={copy.historyHint} active={isActive(historyHref)} onNavigate={closeAll} />
      <MenuLink href={settingsHref} icon={<SettingsIcon />} label={copy.settings} hint={copy.settingsHint} active={isActive(settingsHref)} onNavigate={closeAll} />
    </>
  );

  const mobileItems = (
    <>
      {desktopItems}
      <MenuLink
        href={notificationsHref}
        icon={<BellIcon />}
        label={copy.notifications}
        hint={copy.notificationsHint}
        active={isActive(notificationsHref)}
        badge={unreadCount}
        onNavigate={closeAll}
      />
    </>
  );

  const logoutBlock = logoutConfirm ? (
    <div className={styles.logoutConfirm} role="alert">
      <p>{copy.logoutConfirm}</p>
      <div>
        <button type="button" className={styles.cancelButton} onClick={() => setLogoutConfirm(false)} disabled={logoutBusy}>
          {copy.cancel}
        </button>
        <button type="button" className={styles.confirmButton} onClick={() => void logout()} disabled={logoutBusy}>
          {logoutBusy ? copy.loggingOut : copy.logout}
        </button>
      </div>
    </div>
  ) : (
    <button type="button" className={`${styles.menuItem} ${styles.logoutItem}`} role="menuitem" onClick={() => setLogoutConfirm(true)}>
      <span className={`${styles.menuIcon} ${styles.logoutIcon}`}><LogoutIcon /></span>
      <span className={styles.menuCopy}>
        <strong>{copy.logout}</strong>
        <small>{copy.logoutHint}</small>
      </span>
      <span className={styles.chevron}><Chevron /></span>
    </button>
  );

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={desktopTriggerRef}
        className={`${styles.trigger} ${desktopOpen ? styles.triggerOpen : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={desktopOpen}
        aria-controls="account-user-menu"
        aria-label={desktopOpen ? copy.closeMenu : copy.openMenu}
        onClick={() => {
          setDesktopOpen((current) => !current);
          setLogoutConfirm(false);
        }}
        onKeyDown={openDesktopFromKeyboard}
      >
        <AccountAvatar name={name} unread={hasUnread} compact />
        <span className={styles.triggerCopy}>
          <strong dir="auto">{name}</strong>
          <small dir="ltr">{CURRENT_LEVEL} → {TARGET_LEVEL}</small>
        </span>
        <span className={styles.triggerChevron}><Chevron down /></span>
      </button>

      <button
        className={styles.mobileTrigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
        aria-controls="mobile-account-drawer"
        aria-label={mobileOpen ? copy.closeMenu : copy.openMenu}
        title={copy.account}
        onClick={() => {
          setMobileOpen(true);
          setLogoutConfirm(false);
        }}
      >
        <AccountAvatar name={name} unread={hasUnread} compact />
      </button>

      {desktopOpen ? (
        <div
          id="account-user-menu"
          className={`${styles.popover}${isFa ? ` ${styles.rtl}` : ""}`}
          role="menu"
          aria-label={copy.account}
        >
          <AccountSummary account={account} name={name} mastery={mastery} unread={hasUnread} />
          <div className={styles.separator} />
          <div className={styles.menuList}>{desktopItems}{logoutBlock}</div>
        </div>
      ) : null}

      {mobileOpen ? (
        <div className={styles.drawerLayer}>
          <button className={styles.backdrop} type="button" aria-label={copy.closeMenu} onClick={() => closeAll()} />
          <div
            id="mobile-account-drawer"
            ref={drawerRef}
            className={`${styles.drawer}${isFa ? ` ${styles.rtl}` : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={copy.account}
          >
            <div className={styles.drawerTopbar}>
              <strong>{copy.account}</strong>
              <button className={styles.drawerClose} type="button" onClick={() => closeAll()} aria-label={copy.closeMenu}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <AccountSummary account={account} name={name} mastery={mastery} unread={hasUnread} />
            <div className={styles.separator} />
            <nav className={styles.drawerNav} aria-label={copy.account}>
              {mobileItems}
              {logoutBlock}
            </nav>
            {hasUnread ? <p className={styles.drawerUnreadNote}><span aria-hidden="true" />{copy.unread}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

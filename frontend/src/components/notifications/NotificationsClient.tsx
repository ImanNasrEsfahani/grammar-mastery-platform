"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useCallback, useEffect, useMemo, useState} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import styles from "./NotificationsClient.module.css";

type NotificationFilter = "all" | "unread" | "learning" | "system";
type NotificationKind = "learning" | "system" | "general";
type NotificationTone = "review" | "streak" | "improvement" | "practice" | "result" | "summary" | "system";

type NotificationItem = {
  id: string;
  kind: NotificationKind;
  tone: NotificationTone;
  action_required: boolean;
  title_fa: string;
  title_en: string;
  body_fa: string;
  body_en: string;
  href: string | null;
  cta_fa: string | null;
  cta_en: string | null;
  french_scope: string | null;
  source_type: string;
  source_key: string;
  payload: Record<string, unknown>;
  seen_at: string | null;
  read_at: string | null;
  created_at: string;
  unread: boolean;
};

type NotificationEnvelope = {
  data: {
    items: NotificationItem[];
    unread_count: number;
    provider_version: string;
  };
  meta: {request_id: string; api_version: string};
};

type MutationEnvelope = {
  data: {unread_count: number};
  meta: {request_id: string; api_version: string};
};

const CHANGE_EVENT = "gmp-notifications-changed";

function dispatchNotificationChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function localHref(locale: Locale, href: string | null) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  const normalized = href.startsWith("/") ? href : `/${href}`;
  return `/${locale}${normalized}`;
}

function relativeTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  let divisor = 1;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  if (abs >= 86400) { divisor = 86400; unit = "day"; }
  else if (abs >= 3600) { divisor = 3600; unit = "hour"; }
  else if (abs >= 60) { divisor = 60; unit = "minute"; }
  return new Intl.RelativeTimeFormat(locale === "fa" ? "fa-IR" : "en", {numeric: "auto"}).format(Math.round(seconds / divisor), unit);
}

export function NotificationsClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const router = useRouter();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [payload, setPayload] = useState<NotificationEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<NotificationEnvelope>("/api/backend/notifications");
      if (!result) throw new ApiError({status: 502, code: "EMPTY_NOTIFICATIONS", message: "Notification data was empty."});
      setPayload(result);
      // Viewing the notification center means the items were seen, but they are
      // intentionally NOT marked read. Only an explicit open/read action does that.
      void apiRequest<MutationEnvelope>("/api/backend/notifications/seen", {method: "POST"}).catch(() => null);
      dispatchNotificationChange();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Notifications could not be loaded."}));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = payload?.data.items ?? [];
  const counts = useMemo(() => ({
    all: items.length,
    unread: items.filter((item) => item.unread).length,
    learning: items.filter((item) => item.kind === "learning").length,
    system: items.filter((item) => item.kind === "system").length,
  }), [items]);

  const visible = useMemo(() => items.filter((item) => {
    if (filter === "unread") return item.unread;
    if (filter === "learning") return item.kind === "learning";
    if (filter === "system") return item.kind === "system";
    return true;
  }), [filter, items]);

  const updateReadLocally = (id: string, unreadCount: number) => {
    setPayload((current) => current ? {
      ...current,
      data: {
        ...current.data,
        unread_count: unreadCount,
        items: current.data.items.map((item) => item.id === id ? {...item, unread: false, read_at: item.read_at ?? new Date().toISOString()} : item),
      },
    } : current);
    dispatchNotificationChange();
  };

  const markRead = async (item: NotificationItem, navigate = false) => {
    const href = localHref(locale, item.href);
    if (!item.unread) {
      if (navigate && href) router.push(href);
      return;
    }
    try {
      const result = await apiRequest<{data: {unread_count: number}}>(`/api/backend/notifications/${item.id}/read`, {method: "POST"});
      updateReadLocally(item.id, result?.data.unread_count ?? Math.max(0, counts.unread - 1));
      if (navigate && href) router.push(href);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
      if (navigate && href) router.push(href);
    }
  };

  const markAllRead = async () => {
    if (counts.unread === 0 || busy) return;
    setBusy(true);
    try {
      await apiRequest<MutationEnvelope>("/api/backend/notifications/read-all", {method: "POST"});
      setPayload((current) => current ? {
        ...current,
        data: {...current.data, unread_count: 0, items: current.data.items.map((item) => ({...item, unread: false, read_at: item.read_at ?? new Date().toISOString()}))},
      } : current);
      dispatchNotificationChange();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page} dir={isFa ? "rtl" : "ltr"}>
      <div className={styles.shell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>{isFa ? "اعلان‌ها" : "Notifications"}</h1>
            <p>{isFa ? "فقط رویدادهای واقعی ثبت‌شده برای حساب شما" : "Only real events recorded for your account"}</p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>{isFa ? "تازه‌سازی" : "Refresh"}</button>
            <button type="button" className={styles.primaryButton} onClick={() => void markAllRead()} disabled={busy || counts.unread === 0}>{isFa ? "همه را خواندم" : "Mark all read"}</button>
            <Link className={styles.settingsLink} href={`/${locale}/settings`}>{isFa ? "تنظیمات" : "Settings"}</Link>
          </div>
        </header>

        <section className={styles.summary} aria-label={isFa ? "خلاصه اعلان‌ها" : "Notification summary"}>
          <strong>{isFa ? `${counts.unread.toLocaleString("fa-IR")} خوانده‌نشده` : `${counts.unread} unread`}</strong>
          <span>{isFa ? `${counts.all.toLocaleString("fa-IR")} اعلان واقعی` : `${counts.all} real notifications`}</span>
        </section>

        <nav className={styles.filters} aria-label={isFa ? "فیلتر اعلان‌ها" : "Notification filters"}>
          {(["all", "unread", "learning", "system"] as const).map((key) => {
            const labels = isFa ? {all: "همه", unread: "خوانده‌نشده", learning: "یادگیری", system: "سیستم"} : {all: "All", unread: "Unread", learning: "Learning", system: "System"};
            return <button key={key} type="button" className={filter === key ? styles.activeFilter : undefined} onClick={() => setFilter(key)}>{labels[key]} <b>{counts[key]}</b></button>;
          })}
        </nav>

        {error ? <div className={styles.error} role="alert"><strong>{isFa ? "خطا در اعلان‌ها" : "Notification error"}</strong><span>{error.message}</span></div> : null}

        {loading && !payload ? <div className={styles.state}>{isFa ? "در حال دریافت اعلان‌های واقعی…" : "Loading real notifications…"}</div> : null}

        {!loading && visible.length === 0 ? (
          <section className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">✓</span>
            <h2>{filter === "unread" ? (isFa ? "اعلان خوانده‌نشده‌ای ندارید" : "No unread notifications") : (isFa ? "فعلاً اعلان واقعی‌ای وجود ندارد" : "No real notifications yet")}</h2>
            <p>{isFa ? "اعلان ساختگی نمایش داده نمی‌شود. برای نمونه، اعلان ۷ روز Streak فقط بعد از رسیدن واقعی به ۷ روز ساخته می‌شود." : "No mock notification is shown. For example, a 7-day streak alert is created only after the real streak reaches 7 days."}</p>
          </section>
        ) : null}

        <div className={styles.list}>
          {visible.map((item) => {
            const title = isFa ? item.title_fa : item.title_en;
            const body = isFa ? item.body_fa : item.body_en;
            const cta = isFa ? item.cta_fa : item.cta_en;
            const href = localHref(locale, item.href);
            return (
              <article key={item.id} className={`${styles.card} ${item.unread ? styles.unread : ""}`}>
                <div className={`${styles.tone} ${styles[`tone_${item.tone}`]}`} aria-hidden="true">{item.tone === "streak" ? "🔥" : item.kind === "system" ? "⚙" : "●"}</div>
                <div className={styles.cardBody}>
                  <div className={styles.cardTop}>
                    <div>
                      <h2>{item.french_scope ? <>{title} <span lang="fr">{item.french_scope}</span></> : title}</h2>
                      <p>{body}</p>
                    </div>
                    {item.unread ? <span className={styles.unreadBadge}>{isFa ? "جدید" : "New"}</span> : null}
                  </div>
                  <div className={styles.meta}>
                    <time dateTime={item.created_at}>{relativeTime(item.created_at, locale)}</time>
                    <span>{item.source_type === "STREAK_MILESTONE" ? "Streak" : item.kind}</span>
                  </div>
                  <div className={styles.cardActions}>
                    {href ? <button type="button" className={styles.openButton} onClick={() => void markRead(item, true)}>{cta || (isFa ? "باز کردن" : "Open")}</button> : null}
                    {item.unread ? <button type="button" className={styles.readButton} onClick={() => void markRead(item)}>{isFa ? "خوانده شد" : "Mark read"}</button> : <span className={styles.readState}>✓ {isFa ? "خوانده‌شده" : "Read"}</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}

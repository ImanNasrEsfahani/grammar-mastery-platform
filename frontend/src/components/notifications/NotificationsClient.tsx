"use client";

import Link from "next/link";
import {useEffect, useMemo, useState, type ReactNode} from "react";
import type {Locale} from "@/lib/i18n";
import styles from "./NotificationsClient.module.css";

type NotificationFilter = "all" | "unread" | "learning" | "system";
type QuickFilter = "today" | "week" | "action" | "passive" | null;
type NotificationKind = "learning" | "system" | "general";
type NotificationGroup = "today" | "earlier";
type NotificationTone = "review" | "streak" | "improvement" | "practice" | "result" | "summary" | "system";

type NotificationItem = {
  id: string;
  kind: NotificationKind;
  group: NotificationGroup;
  tone: NotificationTone;
  actionRequired: boolean;
  initialUnread: boolean;
  titleFa: string;
  titleEn: string;
  bodyFa: string;
  bodyEn: string;
  timeFa: string;
  timeEn: string;
  tagFa: string;
  tagEn: string;
  href?: string;
  ctaFa?: string;
  ctaEn?: string;
  frenchScope?: string;
};

const READ_STATE_KEY = "gmp-notifications-read-v1";
const UNREAD_COUNT_KEY = "gmp-notifications-unread-v1";
const CHANGE_EVENT = "gmp-notifications-changed";

const NOTIFICATIONS: readonly NotificationItem[] = [
  {
    id: "review-ready-today",
    kind: "learning",
    group: "today",
    tone: "review",
    actionRequired: true,
    initialUnread: true,
    titleFa: "مرورهای امروز آماده‌اند",
    titleEn: "Today’s reviews are ready",
    bodyFa: "۱۲ سؤال برای مرور فاصله‌دار آماده است.",
    bodyEn: "12 questions are ready for spaced review.",
    timeFa: "۱۰ دقیقه پیش",
    timeEn: "10 min ago",
    tagFa: "مرور",
    tagEn: "Review",
    href: "/review",
    ctaFa: "Review Inbox",
    ctaEn: "Review Inbox",
  },
  {
    id: "seven-day-streak",
    kind: "general",
    group: "today",
    tone: "streak",
    actionRequired: false,
    initialUnread: true,
    titleFa: "۷ روز متوالی!",
    titleEn: "7-day streak!",
    bodyFa: "زنجیره‌ی تمرین روزانه‌تان به ۷ روز رسید.",
    bodyEn: "Your daily practice streak has reached 7 days.",
    timeFa: "۱ ساعت پیش",
    timeEn: "1 hour ago",
    tagFa: "Streak",
    tagEn: "Streak",
    href: "/progress",
    ctaFa: "مشاهده پیشرفت",
    ctaEn: "View progress",
  },
  {
    id: "relative-progress",
    kind: "learning",
    group: "today",
    tone: "improvement",
    actionRequired: false,
    initialUnread: false,
    titleFa: "پیشرفت در",
    titleEn: "Progress in",
    bodyFa: "تسلط شما از ۴۸٪ به ۵۵٪ رسیده است.",
    bodyEn: "Your mastery moved from 48% to 55%.",
    timeFa: "۳ ساعت پیش",
    timeEn: "3 hours ago",
    tagFa: "پیشرفت",
    tagEn: "Progress",
    href: "/progress",
    ctaFa: "جزئیات تسلط",
    ctaEn: "Mastery details",
    frenchScope: "Les pronoms relatifs",
  },
  {
    id: "recommended-practice",
    kind: "learning",
    group: "today",
    tone: "practice",
    actionRequired: true,
    initialUnread: true,
    titleFa: "تمرین پیشنهادی",
    titleEn: "Recommended practice",
    bodyFa: "برای dont و que یک تمرین ۱۰ سؤالی پیشنهاد شده است.",
    bodyEn: "A 10-question practice set for dont and que is recommended.",
    timeFa: "۵ ساعت پیش",
    timeEn: "5 hours ago",
    tagFa: "پیشنهاد",
    tagEn: "Suggested",
    href: "/tests/new",
    ctaFa: "Practice Builder",
    ctaEn: "Practice Builder",
  },
  {
    id: "practice-result-saved",
    kind: "learning",
    group: "earlier",
    tone: "result",
    actionRequired: false,
    initialUnread: false,
    titleFa: "نتیجه تمرین ثبت شد",
    titleEn: "Practice result saved",
    bodyFa: "تمرین Passé composé با دقت ۸۰٪ تکمیل شد.",
    bodyEn: "Your Passé composé practice was completed at 80% accuracy.",
    timeFa: "دیروز",
    timeEn: "Yesterday",
    tagFa: "نتیجه",
    tagEn: "Result",
    href: "/history",
    ctaFa: "مشاهده تاریخچه",
    ctaEn: "View history",
  },
  {
    id: "weekly-learning-summary",
    kind: "learning",
    group: "earlier",
    tone: "summary",
    actionRequired: false,
    initialUnread: false,
    titleFa: "خلاصه یادگیری هفتگی آماده است",
    titleEn: "Your weekly learning summary is ready",
    bodyFa: "مرور، تمرین و روند تسلط این هفته در صفحه پیشرفت جمع‌بندی شده است.",
    bodyEn: "This week’s review, practice, and mastery trend are summarized in Progress.",
    timeFa: "۲ روز پیش",
    timeEn: "2 days ago",
    tagFa: "گزارش",
    tagEn: "Summary",
    href: "/progress",
    ctaFa: "مشاهده پیشرفت",
    ctaEn: "View progress",
  },
  {
    id: "system-update",
    kind: "system",
    group: "earlier",
    tone: "system",
    actionRequired: true,
    initialUnread: false,
    titleFa: "به‌روزرسانی سیستم",
    titleEn: "System update",
    bodyFa: "تنظیمات اعلان و ظاهر اکنون از صفحه تنظیمات در دسترس است.",
    bodyEn: "Notification and appearance preferences are now available in Settings.",
    timeFa: "۳ روز پیش",
    timeEn: "3 days ago",
    tagFa: "سیستم",
    tagEn: "System",
    href: "/settings",
    ctaFa: "تنظیمات",
    ctaEn: "Settings",
  },
  {
    id: "account-safety",
    kind: "system",
    group: "earlier",
    tone: "system",
    actionRequired: false,
    initialUnread: false,
    titleFa: "یادآوری حساب کاربری",
    titleEn: "Account reminder",
    bodyFa: "برای حفظ تنظیمات و پیشرفت، از یک نشست معتبر استفاده کنید.",
    bodyEn: "Use a valid session to keep your preferences and learning progress synchronized.",
    timeFa: "۵ روز پیش",
    timeEn: "5 days ago",
    tagFa: "سیستم",
    tagEn: "System",
    href: "/profile",
    ctaFa: "پروفایل",
    ctaEn: "Profile",
  },
] as const;

function defaultReadIds() {
  return NOTIFICATIONS.filter((item) => !item.initialUnread).map((item) => item.id);
}

function safeReadIds(raw: string | null): Set<string> {
  if (!raw) return new Set(defaultReadIds());
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(defaultReadIds());
    const validIds = new Set(NOTIFICATIONS.map((item) => item.id));
    return new Set(parsed.filter((value): value is string => typeof value === "string" && validIds.has(value)));
  } catch {
    return new Set(defaultReadIds());
  }
}

function scopedHref(locale: Locale, href?: string) {
  return href ? `/${locale}${href}` : undefined;
}

export function NotificationsClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(defaultReadIds()));
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    const next = safeReadIds(window.localStorage.getItem(READ_STATE_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReadIds(next);
    try {
      window.localStorage.setItem(READ_STATE_KEY, JSON.stringify([...next]));
      window.localStorage.setItem(UNREAD_COUNT_KEY, String(NOTIFICATIONS.filter((item) => !next.has(item.id)).length));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      // Storage can be unavailable by browser policy; the in-memory UI still works.
    }
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [openMenuId]);

  const persistReadIds = (next: Set<string>) => {
    setReadIds(next);
    try {
      window.localStorage.setItem(READ_STATE_KEY, JSON.stringify([...next]));
      window.localStorage.setItem(UNREAD_COUNT_KEY, String(NOTIFICATIONS.filter((item) => !next.has(item.id)).length));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      // Storage failure does not block marking notifications in the current session.
    }
  };

  const counts = useMemo(() => ({
    all: NOTIFICATIONS.length,
    unread: NOTIFICATIONS.filter((item) => !readIds.has(item.id)).length,
    learning: NOTIFICATIONS.filter((item) => item.kind === "learning").length,
    system: NOTIFICATIONS.filter((item) => item.kind === "system").length,
  }), [readIds]);

  const visible = useMemo(() => NOTIFICATIONS.filter((item) => {
    const categoryMatch = filter === "all"
      || (filter === "unread" && !readIds.has(item.id))
      || (filter === "learning" && item.kind === "learning")
      || (filter === "system" && item.kind === "system");

    if (!categoryMatch) return false;
    if (quickFilter === "today") return item.group === "today";
    if (quickFilter === "week") return true;
    if (quickFilter === "action") return item.actionRequired;
    if (quickFilter === "passive") return !item.actionRequired;
    return true;
  }), [filter, quickFilter, readIds]);

  const today = visible.filter((item) => item.group === "today");
  const earlier = visible.filter((item) => item.group === "earlier");
  const denominator = Math.max(counts.all, 1);
  const readLearningCount = NOTIFICATIONS.filter((item) => item.kind === "learning" && readIds.has(item.id)).length;
  const unreadAngle = (counts.unread / denominator) * 360;
  const readLearningAngle = (readLearningCount / denominator) * 360;
  const learningEnd = Math.min(360, unreadAngle + readLearningAngle);

  const markAllRead = () => persistReadIds(new Set(NOTIFICATIONS.map((item) => item.id)));
  const toggleRead = (item: NotificationItem) => {
    const next = new Set(readIds);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    persistReadIds(next);
    setOpenMenuId(null);
  };

  return (
    <div className={styles.viewportEscape}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div className={styles.headingCopy}>
            <h1>{isFa ? "اعلان‌ها" : "Notifications"}</h1>
            <p>{isFa ? "رویدادهای مهم یادگیری، مرورها و پیشرفت شما" : "Important learning events, reviews, and progress updates"}</p>
          </div>
          <Link className={styles.settingsButton} href={`/${locale}/settings`}>
            <SettingsIcon />
            <span>{isFa ? "تنظیمات اعلان‌ها" : "Notification settings"}</span>
          </Link>
        </header>

        <div className={styles.layout}>
          <aside className={`${styles.panel} ${styles.filterPanel}`} aria-labelledby="notification-center-title">
            <div className={styles.panelTitleRow}>
              <h2 id="notification-center-title">{isFa ? "مرکز اعلان‌ها" : "Notification center"}</h2>
            </div>
            <ul className={styles.filterList} aria-label={isFa ? "فیلتر اعلان‌ها" : "Notification filters"}>
              <li><FilterButton active={filter === "all"} onClick={() => setFilter("all")} label={isFa ? "همه اعلان‌ها" : "All notifications"} count={counts.all} icon={<InboxIcon />} /></li>
              <li><FilterButton active={filter === "unread"} onClick={() => setFilter("unread")} label={isFa ? "خوانده‌نشده" : "Unread"} count={counts.unread} icon={<UnreadIcon />} /></li>
              <li><FilterButton active={filter === "learning"} onClick={() => setFilter("learning")} label={isFa ? "یادگیری" : "Learning"} count={counts.learning} icon={<LearningIcon />} /></li>
              <li><FilterButton active={filter === "system"} onClick={() => setFilter("system")} label={isFa ? "سیستم" : "System"} count={counts.system} icon={<SystemIcon />} /></li>
            </ul>

            <div className={styles.divider} />
            <p className={styles.quickLabel}>{isFa ? "فیلتر سریع" : "Quick filter"}</p>
            <ul className={styles.quickFilterList}>
              <li><QuickFilterButton active={quickFilter === "today"} onClick={() => setQuickFilter(quickFilter === "today" ? null : "today")}>{isFa ? "امروز" : "Today"}</QuickFilterButton></li>
              <li><QuickFilterButton active={quickFilter === "week"} onClick={() => setQuickFilter(quickFilter === "week" ? null : "week")}>{isFa ? "این هفته" : "This week"}</QuickFilterButton></li>
              <li><QuickFilterButton active={quickFilter === "action"} onClick={() => setQuickFilter(quickFilter === "action" ? null : "action")}>{isFa ? "نیازمند اقدام" : "Action needed"}</QuickFilterButton></li>
              <li><QuickFilterButton active={quickFilter === "passive"} onClick={() => setQuickFilter(quickFilter === "passive" ? null : "passive")}>{isFa ? "بدون اقدام" : "No action"}</QuickFilterButton></li>
            </ul>
          </aside>

          <section className={styles.feedPanel} aria-labelledby="notification-feed-title">
            <div className={styles.feedHeader}>
              <div className={styles.feedHeaderCopy}>
                <h2 id="notification-feed-title">{feedTitle(filter, isFa)}</h2>
                <p>{isFa ? `${counts.unread} اعلان خوانده‌نشده` : `${counts.unread} ${counts.unread === 1 ? "unread notification" : "unread notifications"}`}</p>
              </div>
              <button className={styles.markAllButton} type="button" onClick={markAllRead} disabled={counts.unread === 0}>
                {isFa ? "خواندن همه" : "Mark all read"}
              </button>
            </div>

            {visible.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon} aria-hidden="true"><CheckIcon /></span>
                <h3>{isFa ? "اعلانی در این فیلتر نیست" : "No notifications in this filter"}</h3>
                <p>{isFa ? "فیلتر دیگری را انتخاب کنید یا بعداً دوباره سر بزنید." : "Choose another filter or check back later."}</p>
                <button className={styles.emptyAction} type="button" onClick={() => { setFilter("all"); setQuickFilter(null); }}>
                  {isFa ? "نمایش همه اعلان‌ها" : "Show all notifications"}
                </button>
              </div>
            ) : (
              <>
                {today.length > 0 ? (
                  <NotificationGroupSection title={isFa ? "امروز" : "Today"} items={today} locale={locale} readIds={readIds} openMenuId={openMenuId} onMenuToggle={(id) => setOpenMenuId((current) => current === id ? null : id)} onToggleRead={toggleRead} />
                ) : null}
                {earlier.length > 0 ? (
                  <NotificationGroupSection title={isFa ? "قبل‌تر" : "Earlier"} items={earlier} locale={locale} readIds={readIds} openMenuId={openMenuId} onMenuToggle={(id) => setOpenMenuId((current) => current === id ? null : id)} onToggleRead={toggleRead} />
                ) : null}
              </>
            )}
          </section>

          <aside className={`${styles.panel} ${styles.summaryPanel}`} aria-labelledby="notification-summary-title">
            <div className={styles.summaryHeading}>
              <div>
                <h2 id="notification-summary-title">{isFa ? "خلاصه اعلان‌ها" : "Notification summary"}</h2>
                <p>{isFa ? "نمای سریع وضعیت فعلی" : "A quick view of the current state"}</p>
              </div>
            </div>

            <div className={styles.donutBlock}>
              <div
                className={styles.donut}
                style={{background: `conic-gradient(var(--notify-coral) 0deg ${unreadAngle}deg, var(--notify-blue) ${unreadAngle}deg ${learningEnd}deg, var(--notify-gold) ${learningEnd}deg 360deg)`}}
                role="img"
                aria-label={isFa ? `${counts.all} اعلان، ${counts.unread} خوانده‌نشده` : `${counts.all} notifications, ${counts.unread} unread`}
              >
                <div className={styles.donutCenter}><strong>{counts.all}</strong><span>{isFa ? "اعلان" : "total"}</span></div>
              </div>
              <ul className={styles.legendList}>
                <LegendRow dotClass={styles.dotUnread ?? ""} label={isFa ? "خوانده‌نشده" : "Unread"} value={counts.unread} />
                <LegendRow dotClass={styles.dotLearning ?? ""} label={isFa ? "یادگیری" : "Learning"} value={counts.learning} />
                <LegendRow dotClass={styles.dotSystem ?? ""} label={isFa ? "سیستم" : "System"} value={counts.system} />
              </ul>
            </div>

            <div className={styles.divider} />
            <section className={styles.prioritySection} aria-labelledby="priority-title">
              <h3 id="priority-title">{isFa ? "اولویت‌های فعلی" : "Current priorities"}</h3>
              <ul className={styles.priorityList}>
                <li><PriorityRow label={isFa ? "۱۲ مرور برای امروز" : "12 reviews for today"} note={<bdi dir="ltr">Review Inbox</bdi>} priority={isFa ? "بالا" : "High"} badgeClass={styles.priorityHigh ?? ""} /></li>
                <li><PriorityRow label={isFa ? <>تمرین <bdi lang="fr" dir="ltr">dont / que</bdi></> : "dont / que practice"} note={isFa ? "۱۰ سؤال پیشنهادی" : "10 suggested questions"} priority={isFa ? "متوسط" : "Medium"} badgeClass={styles.priorityMedium ?? ""} /></li>
                <li><PriorityRow label={isFa ? <><bdi dir="ltr">Streak</bdi> روزانه</> : "Daily streak"} note={isFa ? "۷ روز متوالی" : "7 consecutive days"} priority={isFa ? "کم" : "Low"} badgeClass={styles.priorityLow ?? ""} /></li>
              </ul>
            </section>

            <Link className={styles.secondaryButton} href={`/${locale}/settings`}>
              <SettingsIcon />
              {isFa ? "مشاهده تنظیمات اعلان‌ها" : "View notification settings"}
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FilterButton({active, onClick, label, count, icon}: {active: boolean; onClick: () => void; label: string; count: number; icon: ReactNode}) {
  return (
    <button className={`${styles.filterButton} ${active ? styles.filterActive : ""}`} type="button" aria-pressed={active} onClick={onClick}>
      <span className={styles.filterIcon} aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <span className={styles.filterCount}>{count}</span>
    </button>
  );
}

function QuickFilterButton({active, onClick, children}: {active: boolean; onClick: () => void; children: ReactNode}) {
  return <button className={`${styles.quickFilterButton} ${active ? styles.quickActive : ""}`} type="button" aria-pressed={active} onClick={onClick}>{children}</button>;
}

function NotificationGroupSection({title, items, locale, readIds, openMenuId, onMenuToggle, onToggleRead}: {
  title: string;
  items: readonly NotificationItem[];
  locale: Locale;
  readIds: Set<string>;
  openMenuId: string | null;
  onMenuToggle: (id: string) => void;
  onToggleRead: (item: NotificationItem) => void;
}) {
  return (
    <section className={styles.group}>
      <div className={styles.sectionHeader}><h3>{title}</h3><span>{items.length}</span></div>
      <ul className={styles.notificationList}>
        {items.map((item) => (
          <li key={item.id}>
            <NotificationCard item={item} locale={locale} read={readIds.has(item.id)} menuOpen={openMenuId === item.id} onMenuToggle={() => onMenuToggle(item.id)} onToggleRead={() => onToggleRead(item)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotificationCard({item, locale, read, menuOpen, onMenuToggle, onToggleRead}: {
  item: NotificationItem;
  locale: Locale;
  read: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onToggleRead: () => void;
}) {
  const isFa = locale === "fa";
  const href = scopedHref(locale, item.href);
  const cta = isFa ? item.ctaFa : item.ctaEn;
  const ctaIsLtr = Boolean(cta && /^[\x00-\x7F\s]+$/.test(cta));
  return (
    <article className={`${styles.notificationCard} ${!read ? styles.unreadCard : ""}`} data-read={read ? "true" : "false"}>
      <span className={`${styles.iconBubble} ${toneClass(item.tone)}`} aria-hidden="true"><ToneIcon tone={item.tone} /></span>
      <div className={styles.cardCopy}>
        <div className={styles.cardTitleRow}>
          <strong>
            {isFa ? item.titleFa : item.titleEn}
            {item.frenchScope ? <> <bdi lang="fr" dir="ltr">{item.frenchScope}</bdi></> : null}
          </strong>
          {!read ? <span className={styles.unreadLabel}>{isFa ? "جدید" : "New"}</span> : null}
        </div>
        <p>{renderBody(item, isFa)}</p>
        {href && cta ? <Link className={styles.cardAction} href={href} dir={ctaIsLtr ? "ltr" : undefined}>{cta}</Link> : null}
      </div>
      <div className={styles.cardMeta}>
        <time className={styles.time}>{isFa ? item.timeFa : item.timeEn}</time>
        <span className={`${styles.typeBadge} ${kindBadgeClass(item.kind)}`} dir={/^[\x00-\x7F\s]+$/.test(isFa ? item.tagFa : item.tagEn) ? "ltr" : undefined}>{isFa ? item.tagFa : item.tagEn}</span>
      </div>
      <div className={styles.moreWrap}>
        <button className={styles.moreButton} type="button" aria-label={isFa ? "گزینه‌های اعلان" : "Notification options"} aria-expanded={menuOpen} onClick={onMenuToggle}><MoreIcon /></button>
        {menuOpen ? (
          <div className={styles.cardMenu} role="menu">
            <button role="menuitem" type="button" onClick={onToggleRead}>{read ? (isFa ? "علامت‌گذاری به‌عنوان خوانده‌نشده" : "Mark as unread") : (isFa ? "علامت‌گذاری به‌عنوان خوانده‌شده" : "Mark as read")}</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function LegendRow({dotClass, label, value}: {dotClass: string; label: string; value: number}) {
  return <li className={styles.legendItem}><span className={`${styles.legendDot} ${dotClass}`} aria-hidden="true" /><span>{label}</span><strong>{value}</strong></li>;
}

function PriorityRow({label, note, priority, badgeClass}: {label: ReactNode; note: ReactNode; priority: string; badgeClass: string}) {
  return (
    <div className={styles.priorityRow}>
      <div className={styles.priorityCopy}><strong>{label}</strong><small>{note}</small></div>
      <span className={`${styles.priorityBadge} ${badgeClass}`}>{priority}</span>
    </div>
  );
}

function renderBody(item: NotificationItem, isFa: boolean): ReactNode {
  if (!isFa) return item.bodyEn;
  if (item.id === "recommended-practice") return <>برای <bdi lang="fr" dir="ltr">dont / que</bdi> یک تمرین ۱۰ سؤالی پیشنهاد شده است.</>;
  if (item.id === "practice-result-saved") return <>تمرین <bdi lang="fr" dir="ltr">Passé composé</bdi> با دقت ۸۰٪ تکمیل شد.</>;
  return item.bodyFa;
}

function feedTitle(filter: NotificationFilter, isFa: boolean) {
  if (filter === "unread") return isFa ? "اعلان‌های خوانده‌نشده" : "Unread notifications";
  if (filter === "learning") return isFa ? "اعلان‌های یادگیری" : "Learning notifications";
  if (filter === "system") return isFa ? "اعلان‌های سیستم" : "System notifications";
  return isFa ? "همه اعلان‌ها" : "All notifications";
}


function toneClass(tone: NotificationTone) {
  if (tone === "review") return styles.tone_review;
  if (tone === "streak") return styles.tone_streak;
  if (tone === "improvement") return styles.tone_improvement;
  if (tone === "practice") return styles.tone_practice;
  if (tone === "result") return styles.tone_result;
  if (tone === "summary") return styles.tone_summary;
  return styles.tone_system;
}

function kindBadgeClass(kind: NotificationKind) {
  if (kind === "learning") return styles.badge_learning;
  if (kind === "system") return styles.badge_system;
  return styles.badge_general;
}

function ToneIcon({tone}: {tone: NotificationTone}) {
  if (tone === "review") return <ReviewIcon />;
  if (tone === "streak") return <FlameIcon />;
  if (tone === "improvement") return <TrendIcon />;
  if (tone === "practice") return <PracticeIcon />;
  if (tone === "result") return <ResultIcon />;
  if (tone === "summary") return <SummaryIcon />;
  return <SystemIcon />;
}

function SettingsIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z" stroke="currentColor" strokeWidth="1.7"/><path d="M19 13.5v-3l-2.1-.55a7 7 0 0 0-.65-1.56l1.1-1.87-2.12-2.12-1.88 1.1A7 7 0 0 0 11.8 4.85L11.25 2.75h-3l-.55 2.1a7 7 0 0 0-1.56.65L4.27 4.4 2.15 6.52l1.1 1.87a7 7 0 0 0-.65 1.56L.5 10.5v3l2.1.55c.15.55.37 1.08.65 1.56l-1.1 1.87 2.12 2.12 1.87-1.1c.49.28 1.01.5 1.56.65l.55 2.1h3l.55-2.1a7 7 0 0 0 1.55-.65l1.88 1.1 2.12-2.12-1.1-1.87c.28-.48.5-1.01.65-1.56L19 13.5Z" stroke="currentColor" strokeWidth="1.3" transform="translate(2.25 0) scale(.82)"/></svg>; }
function InboxIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M4 5.5h16v13H4z" stroke="currentColor" strokeWidth="1.7"/><path d="M4 14h4l1.2 2h5.6l1.2-2h4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>; }
function UnreadIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M4.5 6.5h15v11h-15z" stroke="currentColor" strokeWidth="1.7"/><path d="m5 7 7 5 7-5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>; }
function LearningIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="m3 9 9-4 9 4-9 4-9-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M6.5 11v5c2.9 2.1 8.1 2.1 11 0v-5" stroke="currentColor" strokeWidth="1.7"/></svg>; }
function SystemIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.64 5.64l1.55 1.55M16.81 16.81l1.55 1.55M18.36 5.64l-1.55 1.55M7.19 16.81l-1.55 1.55" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7"/></svg>; }
function ReviewIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M7 4h10v16H7z" stroke="currentColor" strokeWidth="1.7"/><path d="M9.5 8h5M9.5 12h5M9.5 16h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>; }
function FlameIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M13.7 3.5c.4 3-1.9 4.1-1.1 6.4.5 1.5 2.2 1.6 2.8.1.6 1.1 1.5 2.4 1.5 4.2A4.9 4.9 0 0 1 12 19.1a4.9 4.9 0 0 1-4.9-4.9c0-2.7 1.8-4.5 3.5-6.2.1 2 .8 2.7 1.4 2.9-1-3.3 1.5-4.5 1.7-7.4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>; }
function TrendIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M5 17 10 12l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M15.5 8H19v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function PracticeIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M5 4.5h14v15H5z" stroke="currentColor" strokeWidth="1.7"/><path d="M8 8h8M8 12h5M8 16h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>; }
function ResultIcon() { return <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7"/><path d="m8.5 12 2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SummaryIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="M5 19V9M10 19V5M15 19v-7M20 19V8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" fill="none"><path d="m6 12.5 3.5 3.5L18 7.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function MoreIcon() { return <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>; }

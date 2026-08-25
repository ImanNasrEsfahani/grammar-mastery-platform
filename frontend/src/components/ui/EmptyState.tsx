"use client";

import Link from "next/link";
import {useId} from "react";
import type {Locale} from "@/lib/i18n";
import styles from "./EmptyState.module.css";

export type EmptyStateKind =
  | "review"
  | "search"
  | "history"
  | "weakness"
  | "achievement"
  | "filtered";

export type EmptyStateAction =
  | {type: "link"; href: string; label?: string}
  | {type: "button"; onClick: () => void; label?: string};

type Copy = {
  title: string;
  description: string;
  action: string;
};

const COPY: Record<Locale, Record<EmptyStateKind, Copy>> = {
  fa: {
    review: {
      title: "مروری برای امروز ندارید",
      description: "همه چیز به‌روز است. می‌توانید یک تمرین کوتاه شروع کنید.",
      action: "شروع تمرین",
    },
    search: {
      title: "نتیجه‌ای پیدا نشد",
      description: "عبارت جستجو یا فیلترها را تغییر دهید و دوباره امتحان کنید.",
      action: "پاک کردن فیلترها",
    },
    history: {
      title: "هنوز سابقه‌ای ندارید",
      description: "اولین تمرین شما پس از تکمیل در اینجا نمایش داده می‌شود.",
      action: "شروع اولین تمرین",
    },
    weakness: {
      title: "نقطه ضعف فعالی ندارید",
      description: "عملکرد اخیر شما پایدار بوده است. به تمرین منظم ادامه دهید.",
      action: "مشاهده پیشرفت",
    },
    achievement: {
      title: "هنوز دستاوردی ثبت نشده",
      description: "با ادامه تمرین، milestoneهای شما در این بخش ظاهر می‌شوند.",
      action: "مشاهده اهداف",
    },
    filtered: {
      title: "این فهرست خالی است",
      description: "هیچ موردی با فیلترهای انتخاب‌شده مطابقت ندارد.",
      action: "نمایش همه",
    },
  },
  en: {
    review: {
      title: "Nothing is due for review",
      description: "Everything is up to date. You can start a short practice session.",
      action: "Start practice",
    },
    search: {
      title: "No results found",
      description: "Change the search term or filters, then try again.",
      action: "Clear filters",
    },
    history: {
      title: "No history yet",
      description: "Your first completed practice session will appear here.",
      action: "Start first practice",
    },
    weakness: {
      title: "No active weakness detected",
      description: "Your recent performance is stable. Keep practicing consistently.",
      action: "View progress",
    },
    achievement: {
      title: "No achievements yet",
      description: "Your learning milestones will appear here as you keep practicing.",
      action: "View goals",
    },
    filtered: {
      title: "This list is empty",
      description: "Nothing matches the filters you selected.",
      action: "Show all",
    },
  },
};

function classes(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

function StateIcon({kind}: {kind: EmptyStateKind}) {
  const common = {
    width: 30,
    height: 30,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (kind === "review") return <svg {...common}><path d="m5 12 4 4 10-10" /></svg>;
  if (kind === "search") return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>;
  if (kind === "history") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 7v5H8" /></svg>;
  if (kind === "weakness") return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="m12 12 5-5" /></svg>;
  if (kind === "achievement") return <svg {...common}><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>;
  return <svg {...common}><path d="M6 7h12M6 12h12M6 17h12" /><path d="M3.5 7h.01M3.5 12h.01M3.5 17h.01" /></svg>;
}

export function EmptyState({
  kind,
  locale,
  action,
  title,
  description,
  compact = false,
  className,
}: {
  kind: EmptyStateKind;
  locale: Locale;
  action: EmptyStateAction;
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
}) {
  const titleId = useId();
  const copy = COPY[locale][kind];
  const actionLabel = action.label ?? copy.action;
  const emphasized = kind === "review" || kind === "history";

  return (
    <section
      className={classes(styles.root, compact && styles.compact, className)}
      data-empty-kind={kind}
      aria-labelledby={titleId}
    >
      <div className={styles.iconWrap} aria-hidden="true">
        <StateIcon kind={kind} />
      </div>
      <div className={styles.copy} aria-live="polite" aria-atomic="true">
        <h3 id={titleId}>{title ?? copy.title}</h3>
        <p>{description ?? copy.description}</p>
      </div>
      <div className={styles.divider} aria-hidden="true" />
      {action.type === "link" ? (
        <Link
          className={classes(styles.action, emphasized ? styles.primaryAction : styles.secondaryAction)}
          href={action.href}
        >
          {actionLabel}
        </Link>
      ) : (
        <button
          className={classes(styles.action, emphasized ? styles.primaryAction : styles.secondaryAction)}
          type="button"
          onClick={action.onClick}
        >
          {actionLabel}
        </button>
      )}
    </section>
  );
}

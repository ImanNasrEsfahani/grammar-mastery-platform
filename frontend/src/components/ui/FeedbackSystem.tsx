"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {Locale} from "@/lib/i18n";
import styles from "./FeedbackSystem.module.css";

export {ConfirmModal, DestructiveModal} from "./ModalDrawerSystem";

export type FeedbackTone = "success" | "info" | "warning" | "error";

export type FeedbackAction =
  | {
      label: string;
      href: string;
      onClick?: never;
      dismissOnAction?: boolean;
      onError?: (error: unknown) => void;
    }
  | {
      label: string;
      onClick: () => void | Promise<void>;
      href?: never;
      dismissOnAction?: boolean;
      onError?: (error: unknown) => void;
    };

export type ToastInput = {
  tone: FeedbackTone;
  title?: string;
  message: ReactNode;
  action?: FeedbackAction;
  /** null keeps the toast visible until it is dismissed. Timed values are clamped to 4–6 seconds. */
  durationMs?: number | null;
  dismissible?: boolean;
};

type ToastRecord = ToastInput & {
  id: string;
  durationMs: number | null;
};

type FeedbackApi = {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

type SharedFeedbackProps = {
  tone?: FeedbackTone;
  locale?: Locale;
  label?: string;
  title?: string;
  children: ReactNode;
  action?: FeedbackAction;
  requestId?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
};

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_DURATION_MS = 5000;
const ACTION_DURATION_MS = 6000;
const MIN_DURATION_MS = 4000;
const MAX_DURATION_MS = 6000;

const labels = {
  fa: {
    success: "موفقیت",
    info: "اطلاعات",
    warning: "هشدار",
    error: "خطا",
    dismiss: "بستن پیام",
    busy: "در حال انجام…",
  },
  en: {
    success: "Success",
    info: "Info",
    warning: "Warning",
    error: "Error",
    dismiss: "Dismiss message",
    busy: "Working…",
  },
} as const;

const FeedbackContext = createContext<FeedbackApi | null>(null);
let toastSequence = 0;

function createToastId() {
  toastSequence += 1;
  return `gmp-feedback-${Date.now()}-${toastSequence}`;
}

function normalizeDuration(value: number | null | undefined, hasAction: boolean) {
  if (value === null) return null;
  if (value === undefined) return hasAction ? ACTION_DURATION_MS : DEFAULT_DURATION_MS;
  if (!Number.isFinite(value)) return DEFAULT_DURATION_MS;
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(value)));
}

function toneClass(tone: FeedbackTone) {
  switch (tone) {
    case "success": return styles.toneSuccess;
    case "info": return styles.toneInfo;
    case "warning": return styles.toneWarning;
    case "error": return styles.toneError;
  }
}

function toneRole(tone: FeedbackTone): "alert" | "status" {
  return tone === "error" || tone === "warning" ? "alert" : "status";
}

function toneLive(tone: FeedbackTone): "assertive" | "polite" {
  return tone === "error" || tone === "warning" ? "assertive" : "polite";
}

function ToneIcon({tone}: {tone: FeedbackTone}) {
  const glyph = tone === "success" ? "✓" : tone === "info" ? "i" : tone === "warning" ? "!" : "×";
  return <span className={styles.toneIcon} aria-hidden="true">{glyph}</span>;
}

function ActionControl({
  action,
  onConsumed,
  className,
}: {
  action: FeedbackAction;
  onConsumed?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const shouldDismiss = action.dismissOnAction !== false;

  if ("href" in action) {
    return (
      <Link
        className={className}
        href={action.href}
        onClick={() => {
          if (shouldDismiss) onConsumed?.();
        }}
      >
        {action.label}
      </Link>
    );
  }

  const onClick = action.onClick;

  async function run() {
    if (busy || !onClick) return;
    setBusy(true);
    try {
      await onClick();
      if (shouldDismiss) onConsumed?.();
    } catch (error) {
      action.onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={className}
      type="button"
      onClick={() => void run()}
      disabled={busy}
      aria-busy={busy}
    >
      {action.label}
    </button>
  );
}

function ToastCard({toast, locale, dismiss}: {toast: ToastRecord; locale: Locale; dismiss: (id: string) => void}) {
  const copy = labels[locale];
  const dismissible = toast.dismissible !== false;

  return (
    <article
      className={`${styles.toast} ${toneClass(toast.tone)}`}
      role={toneRole(toast.tone)}
      aria-live={toneLive(toast.tone)}
      aria-atomic="true"
      data-feedback-tone={toast.tone}
    >
      <ToneIcon tone={toast.tone} />
      <div className={styles.toastCopy}>
        <strong className={styles.toastTitle}>{toast.title ?? copy[toast.tone]}</strong>
        <div className={styles.toastMessage} dir="auto">{toast.message}</div>
      </div>
      <div className={styles.toastControls}>
        {toast.action ? (
          <ActionControl
            action={toast.action}
            onConsumed={() => dismiss(toast.id)}
            className={`${styles.toastAction} ${toast.tone === "error" ? styles.toastActionDanger : ""}`}
          />
        ) : null}
        {dismissible ? (
          <button
            className={styles.dismissButton}
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label={copy.dismiss}
          >
            ×
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ToastViewport({toasts, locale, dismiss}: {toasts: ToastRecord[]; locale: Locale; dismiss: (id: string) => void}) {
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS);
  if (visible.length === 0) return null;

  return (
    <div className={styles.viewport} aria-label={locale === "fa" ? "پیام‌های سیستم" : "System feedback"}>
      {visible.map((toast) => (
        <ToastCard key={toast.id} toast={toast} locale={locale} dismiss={dismiss} />
      ))}
    </div>
  );
}

export function FeedbackProvider({children, locale}: {children: ReactNode; locale: Locale}) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
    setToasts([]);
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = createToastId();
    const durationMs = normalizeDuration(input.durationMs, Boolean(input.action));
    const record: ToastRecord = {...input, id, durationMs};
    setToasts((current) => [...current, record]);

    if (durationMs !== null) {
      const timer = window.setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (let index = toasts.length - 1; index >= 0; index -= 1) {
        const candidate = toasts[index];
        if (candidate && candidate.dismissible !== false) {
          event.preventDefault();
          dismiss(candidate.id);
          break;
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss, toasts]);

  return (
    <FeedbackContext.Provider value={{toast, dismiss, dismissAll}}>
      {children}
      <ToastViewport toasts={toasts} locale={locale} dismiss={dismiss} />
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback must be used inside FeedbackProvider.");
  return value;
}

function FeedbackBlock({
  variant,
  tone = "info",
  locale = "en",
  label,
  title,
  children,
  action,
  requestId,
  dismissible = false,
  onDismiss,
  className,
}: SharedFeedbackProps & {variant: "inline" | "banner"}) {
  const copy = labels[locale];
  const visibleLabel = label ?? copy[tone];

  return (
    <section
      className={`${styles.feedbackBlock} ${variant === "banner" ? styles.banner : styles.inlineAlert} ${toneClass(tone)} ${className ?? ""}`}
      role={toneRole(tone)}
      aria-live={toneLive(tone)}
      aria-atomic="true"
      data-feedback-tone={tone}
    >
      <ToneIcon tone={tone} />
      <div className={styles.blockCopy}>
        <div className={styles.blockHeading}>
          <strong className={styles.blockLabel}>{visibleLabel}</strong>
          {title ? <strong className={styles.blockTitle} dir="auto">{title}</strong> : null}
        </div>
        <div className={styles.blockMessage} dir="auto">{children}</div>
        {requestId ? <code className={styles.requestId}>{requestId}</code> : null}
      </div>
      <div className={styles.blockActions}>
        {action ? <ActionControl action={action} className={styles.blockAction} /> : null}
        {dismissible && onDismiss ? (
          <button className={styles.dismissButton} type="button" onClick={onDismiss} aria-label={copy.dismiss}>×</button>
        ) : null}
      </div>
    </section>
  );
}

export function InlineAlert(props: Omit<SharedFeedbackProps, "className"> & {className?: string}) {
  return <FeedbackBlock {...props} variant="inline" />;
}

export function PersistentBanner(props: Omit<SharedFeedbackProps, "className"> & {className?: string}) {
  return <FeedbackBlock {...props} variant="banner" />;
}

export function ConfirmationStrip({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
  ariaLabel = "Confirmation",
  onConfirmError,
}: {
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  destructive?: boolean;
  ariaLabel?: string;
  onConfirmError?: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch (error) {
      onConfirmError?.(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`${styles.confirmationStrip} ${destructive ? styles.confirmationDestructive : ""}`}
      role="group"
      aria-label={ariaLabel}
    >
      <span className={styles.confirmationIcon} aria-hidden="true">!</span>
      <strong className={styles.confirmationMessage} dir="auto">{message}</strong>
      <div className={styles.confirmationActions}>
        <button className={styles.cancelButton} type="button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button
          className={`${styles.confirmButton} ${destructive ? styles.destructiveButton : ""}`}
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          aria-busy={busy}
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  );
}

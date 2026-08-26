"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {Locale} from "@/lib/i18n";
import styles from "./FeedbackSystem.module.css";

export type FeedbackTone = "success" | "info" | "warning" | "error";

export type FeedbackAction = {
  label: string;
  href?: string;
  onClick?: () => void | Promise<void>;
  dismissOnAction?: boolean;
};

export type ToastInput = {
  id?: string;
  tone: FeedbackTone;
  title?: string;
  message: string;
  action?: FeedbackAction;
  durationMs?: number | null;
};

type ToastRecord = ToastInput & {
  id: string;
  title: string;
  durationMs: number | null;
};

type ToastOptions = Omit<ToastInput, "tone" | "message">;

type FeedbackContextValue = {
  push: (toast: ToastInput) => string;
  success: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  warning: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const DEFAULT_DURATION: Record<FeedbackTone, number> = {
  success: 4500,
  info: 4500,
  warning: 6000,
  error: 8000,
};

const TYPE_LABELS: Record<FeedbackTone, {fa: string; en: string}> = {
  success: {fa: "موفقیت", en: "Success"},
  info: {fa: "اطلاعات", en: "Info"},
  warning: {fa: "هشدار", en: "Warning"},
  error: {fa: "خطا", en: "Error"},
};

const TYPE_ICONS: Record<FeedbackTone, string> = {
  success: "✓",
  info: "i",
  warning: "!",
  error: "×",
};

function makeToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toneLabel(tone: FeedbackTone, locale: Locale) {
  return TYPE_LABELS[tone][locale === "fa" ? "fa" : "en"];
}

function toneStyle(tone: FeedbackTone) {
  if (tone === "success") return styles.tone_success;
  if (tone === "info") return styles.tone_info;
  if (tone === "warning") return styles.tone_warning;
  return styles.tone_error;
}

export function FeedbackProvider({
  children,
  locale,
  maxVisible = 3,
}: {
  children: ReactNode;
  locale: Locale;
  maxVisible?: number;
}) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const clear = useCallback(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    setToasts([]);
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = input.id ?? makeToastId();
    const toast: ToastRecord = {
      ...input,
      id,
      title: input.title?.trim() || toneLabel(input.tone, locale),
      durationMs: input.durationMs === undefined ? DEFAULT_DURATION[input.tone] : input.durationMs,
    };

    setToasts((current) => {
      const withoutSameId = current.filter((item) => item.id !== id);
      const next = [...withoutSameId, toast];
      return next.slice(-Math.max(1, maxVisible));
    });
    return id;
  }, [locale, maxVisible]);

  const convenience = useCallback((tone: FeedbackTone, message: string, options?: ToastOptions) => {
    return push({
      ...options,
      tone,
      message,
    });
  }, [push]);

  const success = useCallback((message: string, options?: ToastOptions) => convenience("success", message, options), [convenience]);
  const info = useCallback((message: string, options?: ToastOptions) => convenience("info", message, options), [convenience]);
  const warning = useCallback((message: string, options?: ToastOptions) => convenience("warning", message, options), [convenience]);
  const error = useCallback((message: string, options?: ToastOptions) => convenience("error", message, options), [convenience]);

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));
    timers.current.forEach((timer, id) => {
      if (!activeIds.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    });

    toasts.forEach((toast) => {
      if (toast.durationMs === null || toast.durationMs <= 0 || timers.current.has(toast.id)) return;
      const timer = setTimeout(() => dismiss(toast.id), toast.durationMs);
      timers.current.set(toast.id, timer);
    });
  }, [dismiss, toasts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const latest = toasts[toasts.length - 1];
      if (latest) dismiss(latest.id);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss, toasts]);

  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
  }, []);

  const value = useMemo<FeedbackContextValue>(() => ({
    push,
    success,
    info,
    warning,
    error,
    dismiss,
    clear,
  }), [clear, dismiss, error, info, push, success, warning]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div
        className={styles.toastViewport}
        aria-label={locale === "fa" ? "پیام‌های سیستم" : "System feedback"}
      >
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            locale={locale}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used inside FeedbackProvider");
  return context;
}

function ToastCard({
  toast,
  locale,
  onDismiss,
}: {
  toast: ToastRecord;
  locale: Locale;
  onDismiss: () => void;
}) {
  const isUrgent = toast.tone === "warning" || toast.tone === "error";

  const runAction = () => {
    const action = toast.action;
    if (!action?.onClick) {
      if (action?.dismissOnAction !== false) onDismiss();
      return;
    }
    void Promise.resolve(action.onClick()).finally(() => {
      if (action.dismissOnAction !== false) onDismiss();
    });
  };

  return (
    <article
      className={`${styles.toast} ${toneStyle(toast.tone)}`}
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className={styles.toastIcon} aria-hidden="true">{TYPE_ICONS[toast.tone]}</span>
      <div className={styles.toastCopy}>
        <strong>{toast.title}</strong>
        <p dir="auto">{toast.message}</p>
      </div>
      {toast.action ? (
        toast.action.href ? (
          <a className={styles.toastAction} href={toast.action.href} onClick={() => {
            if (toast.action?.dismissOnAction !== false) onDismiss();
          }}>
            {toast.action.label}
          </a>
        ) : (
          <button className={styles.toastAction} type="button" onClick={runAction}>
            {toast.action.label}
          </button>
        )
      ) : null}
      <button
        className={styles.dismissButton}
        type="button"
        onClick={onDismiss}
        aria-label={locale === "fa" ? "بستن پیام" : "Dismiss notification"}
      >
        <span aria-hidden="true">×</span>
      </button>
    </article>
  );
}

export function InlineAlert({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: FeedbackTone;
  title?: string;
  children: ReactNode;
  action?: FeedbackAction;
  className?: string;
}) {
  const urgent = tone === "warning" || tone === "error";
  return (
    <section
      className={`${styles.inlineAlert} ${toneStyle(tone)}${className ? ` ${className}` : ""}`}
      role={urgent ? "alert" : "status"}
    >
      <span className={styles.inlineIcon} aria-hidden="true">{TYPE_ICONS[tone]}</span>
      <div className={styles.inlineCopy}>
        {title ? <strong>{title}</strong> : null}
        <div dir="auto">{children}</div>
      </div>
      {action ? <FeedbackActionControl action={action} className={styles.inlineAction} /> : null}
    </section>
  );
}

export function PersistentBanner({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  dismissLabel,
}: {
  tone?: FeedbackTone;
  title?: string;
  children: ReactNode;
  action?: FeedbackAction;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <section className={`${styles.banner} ${toneStyle(tone)}`} role={tone === "error" ? "alert" : "status"}>
      <span className={styles.inlineIcon} aria-hidden="true">{TYPE_ICONS[tone]}</span>
      <div className={styles.inlineCopy}>
        {title ? <strong>{title}</strong> : null}
        <div dir="auto">{children}</div>
      </div>
      <div className={styles.bannerActions}>
        {action ? <FeedbackActionControl action={action} className={styles.inlineAction} /> : null}
        {onDismiss ? (
          <button className={styles.bannerDismiss} type="button" onClick={onDismiss}>
            {dismissLabel ?? "Dismiss"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function ConfirmationStrip({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  onConfirmError,
  tone = "danger",
  disabled = false,
}: {
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  onConfirmError?: (error: unknown) => void;
  tone?: "danger" | "default";
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch (error) {
      onConfirmError?.(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${styles.confirmationStrip} ${tone === "danger" ? styles.confirmationDanger : ""}`} role="group">
      <strong className={styles.confirmationMessage} dir="auto">{message}</strong>
      <div className={styles.confirmationActions}>
        <button className={styles.cancelButton} type="button" onClick={onCancel} disabled={busy || disabled}>
          {cancelLabel}
        </button>
        <button className={styles.confirmButton} type="button" onClick={() => { void handleConfirm(); }} disabled={busy || disabled}>
          {busy ? <span className={styles.buttonSpinner} aria-hidden="true" /> : null}
          {confirmLabel}
        </button>
      </div>
    </section>
  );
}

function FeedbackActionControl({action, className}: {action: FeedbackAction; className?: string}) {
  if (action.href) {
    return <a className={className} href={action.href}>{action.label}</a>;
  }
  return (
    <button className={className} type="button" onClick={() => { void action.onClick?.(); }}>
      {action.label}
    </button>
  );
}

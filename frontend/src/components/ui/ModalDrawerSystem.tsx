"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {createPortal} from "react-dom";
import styles from "./ModalDrawerSystem.module.css";

export type OverlayDismissReason = "escape" | "backdrop" | "close-button" | "cancel";
export type ModalVariant = "default" | "confirm" | "destructive" | "info" | "form";
export type ModalSize = "sm" | "md" | "lg";
export type DrawerPlacement = "right" | "bottom";

export type OverlayChangeHandler = (open: boolean, reason?: OverlayDismissReason) => void;

type SharedOverlayProps = {
  open: boolean;
  onOpenChange: OverlayChangeHandler;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
  className?: string;
  testId?: string;
  portalContainer?: Element | null;
};

export type ModalProps = SharedOverlayProps & {
  variant?: ModalVariant;
  size?: ModalSize;
};

export type DrawerProps = SharedOverlayProps & {
  placement?: DrawerPlacement;
  showHandle?: boolean;
  width?: "sm" | "md" | "lg";
};

export type ConfirmModalProps = Omit<ModalProps, "variant" | "footer"> & {
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  pendingLabel?: string;
};

export type DestructiveModalProps = Omit<ModalProps, "variant" | "footer"> & {
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  pendingLabel?: string;
};

export type InfoModalProps = Omit<ModalProps, "variant" | "footer"> & {
  acknowledgeLabel: string;
  icon?: ReactNode;
};

export type FormModalProps = Omit<ModalProps, "variant">;
export type RightDrawerProps = Omit<DrawerProps, "placement">;
export type FilterDrawerProps = Omit<DrawerProps, "placement" | "width">;
export type MobileBottomDrawerProps = Omit<DrawerProps, "placement" | "showHandle">;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const overlayStack: string[] = [];
let scrollLockCount = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";

function addToOverlayStack(id: string) {
  const existing = overlayStack.indexOf(id);
  if (existing >= 0) overlayStack.splice(existing, 1);
  overlayStack.push(id);
}

function removeFromOverlayStack(id: string) {
  const existing = overlayStack.indexOf(id);
  if (existing >= 0) overlayStack.splice(existing, 1);
}

function isTopOverlay(id: string) {
  return overlayStack[overlayStack.length - 1] === id;
}

function lockDocumentScroll() {
  if (typeof document === "undefined") return;
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousBodyPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
  }
  scrollLockCount += 1;
}

function unlockDocumentScroll() {
  if (typeof document === "undefined" || scrollLockCount === 0) return;
  scrollLockCount -= 1;
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
    document.body.style.paddingRight = previousBodyPaddingRight;
  }
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.hasAttribute("inert")) return false;
    return true;
  });
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function useOverlayBehavior({
  open,
  onOpenChange,
  closeOnEscape,
  initialFocusRef,
  restoreFocus,
}: {
  open: boolean;
  onOpenChange: OverlayChangeHandler;
  closeOnEscape: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus: boolean;
}) {
  const reactId = useId();
  const stackId = useMemo(() => `grammar-overlay-${reactId}`, [reactId]);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    addToOverlayStack(stackId);
    lockDocumentScroll();
    return () => {
      removeFromOverlayStack(stackId);
      unlockDocumentScroll();
    };
  }, [open, stackId]);

  useEffect(() => {
    if (!open || !mounted) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const initial = initialFocusRef?.current;
      if (initial && panel.contains(initial)) {
        initial.focus();
        return;
      }
      const focusable = getFocusableElements(panel);
      (focusable[0] ?? panel).focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      if (restoreFocus && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [initialFocusRef, mounted, open, restoreFocus]);

  useEffect(() => {
    if (!open || !mounted || !closeOnEscape) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopOverlay(stackId)) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false, "escape");
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeOnEscape, mounted, onOpenChange, open, stackId]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !isTopOverlay(stackId)) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = getFocusableElements(panel);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return {mounted, panelRef, stackId, trapFocus};
}

function CloseButton({label, onClick}: {label: string; onClick: () => void}) {
  return (
    <button className={styles.closeButton} type="button" aria-label={label} onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function OverlayHeader({
  title,
  description,
  titleId,
  descriptionId,
  showCloseButton,
  closeLabel,
  onClose,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  titleId: string;
  descriptionId?: string;
  showCloseButton: boolean;
  closeLabel: string;
  onClose: () => void;
  icon?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      {icon ? <div className={styles.headerIcon} aria-hidden="true">{icon}</div> : null}
      <div className={styles.headerCopy}>
        <h2 id={titleId}>{title}</h2>
        {description ? <div id={descriptionId} className={styles.description}>{description}</div> : null}
      </div>
      {showCloseButton ? <CloseButton label={closeLabel} onClick={onClose} /> : null}
    </header>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = "Close",
  showCloseButton = true,
  closeOnBackdrop = false,
  closeOnEscape = true,
  initialFocusRef,
  restoreFocus = true,
  className,
  testId,
  portalContainer,
  variant = "default",
  size = "md",
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const {mounted, panelRef, trapFocus} = useOverlayBehavior({
    open,
    onOpenChange,
    closeOnEscape,
    initialFocusRef,
    restoreFocus,
  });

  if (!open || !mounted) return null;

  const content = (
    <div
      className={styles.backdrop}
      data-testid={testId ? `${testId}-backdrop` : undefined}
      onPointerDown={(event) => {
        if (!closeOnBackdrop || event.target !== event.currentTarget) return;
        onOpenChange(false, "backdrop");
      }}
    >
      <div
        ref={panelRef}
        className={joinClasses(
          styles.modal,
          styles[`modalSize_${size}`],
          styles[`variant_${variant}`],
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={trapFocus}
      >
        <OverlayHeader
          title={title}
          description={description}
          titleId={titleId}
          descriptionId={description ? descriptionId : undefined}
          showCloseButton={showCloseButton}
          closeLabel={closeLabel}
          onClose={() => onOpenChange(false, "close-button")}
        />
        {children ? <div className={styles.body}>{children}</div> : null}
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>
  );

  return createPortal(content, portalContainer ?? document.body);
}

export function ConfirmModal({
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy = false,
  pendingLabel,
  initialFocusRef,
  closeOnBackdrop = false,
  showCloseButton = false,
  ...props
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const effectiveInitialRef = initialFocusRef ?? confirmRef;
  return (
    <Modal
      {...props}
      variant="confirm"
      closeOnBackdrop={closeOnBackdrop}
      showCloseButton={showCloseButton}
      initialFocusRef={effectiveInitialRef}
      footer={
        <>
          <button className={styles.secondaryAction} type="button" disabled={busy} onClick={() => props.onOpenChange(false, "cancel")}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} className={styles.primaryAction} type="button" disabled={busy} onClick={onConfirm}>
            {busy && pendingLabel ? pendingLabel : confirmLabel}
          </button>
        </>
      }
    />
  );
}

export function DestructiveModal({
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy = false,
  pendingLabel,
  initialFocusRef,
  closeOnBackdrop = false,
  showCloseButton = false,
  ...props
}: DestructiveModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const effectiveInitialRef = initialFocusRef ?? cancelRef;
  return (
    <Modal
      {...props}
      variant="destructive"
      closeOnBackdrop={closeOnBackdrop}
      showCloseButton={showCloseButton}
      initialFocusRef={effectiveInitialRef}
      footer={
        <>
          <button ref={cancelRef} className={styles.secondaryAction} type="button" disabled={busy} onClick={() => props.onOpenChange(false, "cancel")}>
            {cancelLabel}
          </button>
          <button className={styles.dangerAction} type="button" disabled={busy} onClick={onConfirm}>
            {busy && pendingLabel ? pendingLabel : confirmLabel}
          </button>
        </>
      }
    />
  );
}

export function InfoModal({
  acknowledgeLabel,
  icon,
  initialFocusRef,
  closeOnBackdrop = true,
  showCloseButton = false,
  ...props
}: InfoModalProps) {
  const acknowledgeRef = useRef<HTMLButtonElement>(null);
  const effectiveInitialRef = initialFocusRef ?? acknowledgeRef;
  return (
    <Modal
      {...props}
      variant="info"
      closeOnBackdrop={closeOnBackdrop}
      showCloseButton={showCloseButton}
      initialFocusRef={effectiveInitialRef}
      footer={
        <button ref={acknowledgeRef} className={styles.primaryAction} type="button" onClick={() => props.onOpenChange(false, "cancel")}>
          {acknowledgeLabel}
        </button>
      }
    >
      <div className={styles.infoBody}>
        <div className={styles.infoIcon} aria-hidden="true">
          {icon ?? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 10v7M12 7h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          )}
        </div>
        {props.children ? <div className={styles.infoCopy}>{props.children}</div> : null}
      </div>
    </Modal>
  );
}

export function FormModal({closeOnBackdrop = false, showCloseButton = false, ...props}: FormModalProps) {
  return <Modal {...props} variant="form" closeOnBackdrop={closeOnBackdrop} showCloseButton={showCloseButton} />;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = "Close",
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocusRef,
  restoreFocus = true,
  className,
  testId,
  portalContainer,
  placement = "right",
  showHandle = placement === "bottom",
  width = "md",
}: DrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const {mounted, panelRef, trapFocus} = useOverlayBehavior({
    open,
    onOpenChange,
    closeOnEscape,
    initialFocusRef,
    restoreFocus,
  });

  if (!open || !mounted) return null;

  const content = (
    <div
      className={joinClasses(styles.backdrop, styles.drawerBackdrop, styles[`drawerBackdrop_${placement}`])}
      data-testid={testId ? `${testId}-backdrop` : undefined}
      onPointerDown={(event) => {
        if (!closeOnBackdrop || event.target !== event.currentTarget) return;
        onOpenChange(false, "backdrop");
      }}
    >
      <aside
        ref={panelRef}
        className={joinClasses(
          styles.drawer,
          styles[`drawer_${placement}`],
          placement === "right" && styles[`drawerWidth_${width}`],
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={trapFocus}
      >
        {showHandle ? <div className={styles.drawerHandle} aria-hidden="true"><span /></div> : null}
        <OverlayHeader
          title={title}
          description={description}
          titleId={titleId}
          descriptionId={description ? descriptionId : undefined}
          showCloseButton={showCloseButton}
          closeLabel={closeLabel}
          onClose={() => onOpenChange(false, "close-button")}
        />
        {children ? <div className={styles.drawerBody}>{children}</div> : null}
        {footer ? <footer className={styles.drawerFooter}>{footer}</footer> : null}
      </aside>
    </div>
  );

  return createPortal(content, portalContainer ?? document.body);
}

export function RightDrawer(props: RightDrawerProps) {
  return <Drawer {...props} placement="right" />;
}

export function FilterDrawer(props: FilterDrawerProps) {
  return <Drawer {...props} placement="right" width="md" />;
}

export function MobileBottomDrawer(props: MobileBottomDrawerProps) {
  return <Drawer {...props} placement="bottom" showHandle />;
}

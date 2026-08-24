"use client";

import {useEffect, useState} from "react";
import type {Locale} from "@/lib/i18n";
import {t} from "@/lib/i18n";

type Theme = "light" | "dark";

const STORAGE_KEY = "gmp-theme";
const THEME_EVENT = "gmp-theme-change";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

function systemTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function currentTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  if (isTheme(applied)) return applied;
  return storedTheme() ?? systemTheme();
}

function applyTheme(theme: Theme, persist: boolean) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme switching must still work when storage is unavailable.
    }
  }
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, {detail: theme}));
}

function ThemeIcon({target}: {target: Theme}) {
  if (target === "dark") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20.2 15.3A8.3 8.3 0 0 1 8.7 3.8a8.4 8.4 0 1 0 11.5 11.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ThemeToggle({locale}: {locale: Locale}) {
  const labels = t(locale);
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const syncFromDocument = () => setTheme(currentTheme());
    const handleThemeEvent = (event: Event) => {
      const next = (event as CustomEvent<Theme>).detail;
      setTheme(isTheme(next) ? next : currentTheme());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = isTheme(event.newValue) ? event.newValue : systemTheme();
      applyTheme(next, false);
    };

    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const handleSystemTheme = () => {
      if (storedTheme()) return;
      applyTheme(systemTheme(), false);
    };

    syncFromDocument();
    window.addEventListener(THEME_EVENT, handleThemeEvent as EventListener);
    window.addEventListener("storage", handleStorage);
    media?.addEventListener("change", handleSystemTheme);

    return () => {
      window.removeEventListener(THEME_EVENT, handleThemeEvent as EventListener);
      window.removeEventListener("storage", handleStorage);
      media?.removeEventListener("change", handleSystemTheme);
    };
  }, []);

  const activeTheme = theme ?? "light";
  const targetTheme: Theme = activeTheme === "dark" ? "light" : "dark";
  const actionLabel = targetTheme === "dark" ? labels.enableDarkTheme : labels.enableLightTheme;

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={theme ? actionLabel : labels.themeChange}
      aria-pressed={activeTheme === "dark"}
      title={actionLabel}
      onClick={() => {
        applyTheme(targetTheme, true);
        setTheme(targetTheme);
      }}
    >
      <span className="theme-toggle-icon"><ThemeIcon target={targetTheme} /></span>
      <span className="theme-toggle-label">{actionLabel}</span>
    </button>
  );
}

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "gmp-theme";
export const THEME_EVENT = "gmp-theme-change";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return isTheme(value) || value === "system";
}

export function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function storedThemePreference(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

export function currentThemePreference(): ThemePreference {
  if (typeof document !== "undefined") {
    const appliedPreference = document.documentElement.dataset.themePreference;
    if (isThemePreference(appliedPreference)) return appliedPreference;
  }
  return storedThemePreference() ?? "system";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

export function currentTheme(): Theme {
  if (typeof document !== "undefined") {
    const applied = document.documentElement.dataset.theme;
    if (isTheme(applied)) return applied;
  }
  return resolveTheme(currentThemePreference());
}

export function applyThemePreference(preference: ThemePreference, persist = true) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // The current page can still switch themes when storage is unavailable.
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, {detail: resolved}));
  }
}

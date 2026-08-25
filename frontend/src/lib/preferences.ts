import type {Locale} from "@/lib/i18n";
import type {ThemePreference} from "@/lib/theme";
import {currentThemePreference, isThemePreference} from "@/lib/theme";

export const SETTINGS_STORAGE_KEY = "gmp-settings-v1";
export const SETTINGS_EVENT = "gmp-settings-change";
export const SETTINGS_SCHEMA_VERSION = "settings-v1.0.0";

export type InterfaceDensity = "compact" | "comfortable" | "spacious";
export type ExplanationLanguage = "fa" | "en";
export type PracticeModePreference = "adaptive" | "custom";
export type DifficultyPreference = "easy" | "mixed" | "hard";
export type ReviewPriority = "mistakes" | "due" | "balanced";

export type UserPreferences = {
  appearance: {
    theme: ThemePreference;
    density: InterfaceDensity;
    reduceMotion: boolean;
  };
  language: {
    interfaceLanguage: Locale;
    explanationLanguage: ExplanationLanguage;
  };
  learning: {
    practiceMode: PracticeModePreference;
    questionCount: number;
    difficulty: DifficultyPreference;
  };
  review: {
    showSpacedReview: boolean;
    priority: ReviewPriority;
    dailyLimit: number;
  };
  notifications: {
    dueReviews: boolean;
    streakAndDailyGoal: boolean;
    weeklyReport: boolean;
  };
  accessibility: {
    fontScale: 90 | 100 | 110 | 120 | 130;
    highContrast: boolean;
    keyboardShortcuts: boolean;
  };
};

type StoredPreferencesEnvelope = {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  savedAt: string;
  settings: UserPreferences;
};

const densities: readonly InterfaceDensity[] = ["compact", "comfortable", "spacious"];
const explanationLanguages: readonly ExplanationLanguage[] = ["fa", "en"];
const practiceModes: readonly PracticeModePreference[] = ["adaptive", "custom"];
const difficultyPreferences: readonly DifficultyPreference[] = ["easy", "mixed", "hard"];
const reviewPriorities: readonly ReviewPriority[] = ["mistakes", "due", "balanced"];
const fontScales = [90, 100, 110, 120, 130] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLocaleValue(value: unknown): value is Locale {
  return value === "fa" || value === "en";
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value)
    : fallback;
}

export function defaultPreferences(locale: Locale): UserPreferences {
  return {
    appearance: {
      theme: "system",
      density: "comfortable",
      reduceMotion: false,
    },
    language: {
      interfaceLanguage: locale,
      explanationLanguage: locale,
    },
    learning: {
      practiceMode: "adaptive",
      questionCount: 20,
      difficulty: "mixed",
    },
    review: {
      showSpacedReview: true,
      priority: "mistakes",
      dailyLimit: 15,
    },
    notifications: {
      dueReviews: true,
      streakAndDailyGoal: true,
      weeklyReport: false,
    },
    accessibility: {
      fontScale: 100,
      highContrast: false,
      keyboardShortcuts: true,
    },
  };
}

function normalizePreferences(value: unknown, locale: Locale): UserPreferences {
  const fallback = defaultPreferences(locale);
  const root = isObject(value) ? value : {};
  const appearance = isObject(root.appearance) ? root.appearance : {};
  const language = isObject(root.language) ? root.language : {};
  const learning = isObject(root.learning) ? root.learning : {};
  const review = isObject(root.review) ? root.review : {};
  const notifications = isObject(root.notifications) ? root.notifications : {};
  const accessibility = isObject(root.accessibility) ? root.accessibility : {};

  const storedFontScale = fontScales.includes(accessibility.fontScale as (typeof fontScales)[number])
    ? accessibility.fontScale as UserPreferences["accessibility"]["fontScale"]
    : fallback.accessibility.fontScale;

  return {
    appearance: {
      theme: isThemePreference(appearance.theme) ? appearance.theme : fallback.appearance.theme,
      density: oneOf(appearance.density, densities) ? appearance.density : fallback.appearance.density,
      reduceMotion: booleanOr(appearance.reduceMotion, fallback.appearance.reduceMotion),
    },
    language: {
      interfaceLanguage: isLocaleValue(language.interfaceLanguage) ? language.interfaceLanguage : fallback.language.interfaceLanguage,
      explanationLanguage: oneOf(language.explanationLanguage, explanationLanguages)
        ? language.explanationLanguage
        : fallback.language.explanationLanguage,
    },
    learning: {
      practiceMode: oneOf(learning.practiceMode, practiceModes) ? learning.practiceMode : fallback.learning.practiceMode,
      questionCount: numberInRange(learning.questionCount, fallback.learning.questionCount, 5, 100),
      difficulty: oneOf(learning.difficulty, difficultyPreferences) ? learning.difficulty : fallback.learning.difficulty,
    },
    review: {
      showSpacedReview: booleanOr(review.showSpacedReview, fallback.review.showSpacedReview),
      priority: oneOf(review.priority, reviewPriorities) ? review.priority : fallback.review.priority,
      dailyLimit: numberInRange(review.dailyLimit, fallback.review.dailyLimit, 5, 50),
    },
    notifications: {
      dueReviews: booleanOr(notifications.dueReviews, fallback.notifications.dueReviews),
      streakAndDailyGoal: booleanOr(notifications.streakAndDailyGoal, fallback.notifications.streakAndDailyGoal),
      weeklyReport: booleanOr(notifications.weeklyReport, fallback.notifications.weeklyReport),
    },
    accessibility: {
      fontScale: storedFontScale,
      highContrast: booleanOr(accessibility.highContrast, fallback.accessibility.highContrast),
      keyboardShortcuts: booleanOr(accessibility.keyboardShortcuts, fallback.accessibility.keyboardShortcuts),
    },
  };
}

export function readPreferences(locale: Locale): UserPreferences {
  const fallback = defaultPreferences(locale);
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        ...fallback,
        appearance: {...fallback.appearance, theme: currentThemePreference()},
      };
    }
    const parsed = JSON.parse(raw) as unknown;
    const envelope = isObject(parsed) && parsed.schemaVersion === SETTINGS_SCHEMA_VERSION && isObject(parsed.settings)
      ? parsed.settings
      : parsed;
    const normalized = normalizePreferences(envelope, locale);
    return {
      ...normalized,
      appearance: {...normalized.appearance, theme: currentThemePreference()},
    };
  } catch {
    return {
      ...fallback,
      appearance: {...fallback.appearance, theme: currentThemePreference()},
    };
  }
}

export function savePreferences(settings: UserPreferences) {
  if (typeof window === "undefined") return;
  const envelope: StoredPreferencesEnvelope = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    settings,
  };
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    throw new Error("SETTINGS_STORAGE_UNAVAILABLE");
  }
  window.dispatchEvent(new CustomEvent<UserPreferences>(SETTINGS_EVENT, {detail: settings}));
}

export function applyAccessibilityPreferences(settings: UserPreferences) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.uiDensity = settings.appearance.density;
  root.dataset.fontScale = String(settings.accessibility.fontScale);
  root.dataset.highContrast = String(settings.accessibility.highContrast);
  root.dataset.reduceMotion = String(settings.appearance.reduceMotion);
  root.dataset.keyboardShortcuts = String(settings.accessibility.keyboardShortcuts);
}

export function practiceQueryDefaults(settings: UserPreferences) {
  return {
    mode: settings.learning.practiceMode,
    count: String(settings.learning.questionCount),
    difficulty: settings.learning.difficulty === "mixed" ? "all" : settings.learning.difficulty,
  } as const;
}

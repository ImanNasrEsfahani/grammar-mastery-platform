export const locales = ["fa", "en"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function localeDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}

export function localeLanguage(locale: Locale): "fa-IR" | "en-CA" {
  return locale === "fa" ? "fa-IR" : "en-CA";
}

const copy = {
  fa: {
    productName: "تسلط بر گرامر فرانسه",
    skip: "رفتن به محتوای اصلی",
    dashboard: "داشبورد",
    practice: "تمرین جدید",
    review: "مرور",
    lessons: "درس‌ها",
    progress: "پیشرفت",
    login: "ورود",
    logout: "خروج",
    loading: "در حال بارگذاری…",
    retry: "تلاش دوباره",
    submit: "ثبت پاسخ",
    next: "سؤال بعدی",
    exit: "خروج از آزمون",
    question: "سؤال",
    selectAnswer: "یک گزینه را انتخاب کنید.",
    correct: "پاسخ درست است",
    incorrect: "پاسخ نادرست است",
    queued: "پاسخ شما محفوظ است و پس از اتصال دوباره ارسال می‌شود.",
    explanation: "توضیح پاسخ",
    requestId: "شناسه پیگیری",
    themeChange: "تغییر پوسته",
    enableDarkTheme: "فعال‌کردن حالت تاریک",
    enableLightTheme: "فعال‌کردن حالت روشن",
  },
  en: {
    productName: "French Grammar Mastery",
    skip: "Skip to main content",
    dashboard: "Dashboard",
    practice: "New practice",
    review: "Review",
    lessons: "Lessons",
    progress: "Progress",
    login: "Log in",
    logout: "Log out",
    loading: "Loading…",
    retry: "Retry",
    submit: "Submit answer",
    next: "Next question",
    exit: "Exit test",
    question: "Question",
    selectAnswer: "Choose one option.",
    correct: "Correct answer",
    incorrect: "Incorrect answer",
    queued: "Your answer is safe and will retry when the connection returns.",
    explanation: "Explanation",
    requestId: "Request ID",
    themeChange: "Change theme",
    enableDarkTheme: "Enable dark theme",
    enableLightTheme: "Enable light theme",
  },
} as const;

export function t(locale: Locale) {
  return copy[locale];
}

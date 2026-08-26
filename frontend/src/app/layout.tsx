import type {Metadata} from "next";
import "./globals.css";
import "./fonts.css";
import "./dashboard.css";
import "./theme-menu.css";
import "./settings.css";
import "./mobile-header-direction.css";

export const metadata: Metadata = {
  title: {
    default: "French Grammar Mastery",
    template: "%s · French Grammar Mastery",
  },
  description: "Mobile-first French grammar practice with evidence-aware review.",
};

const preferenceInitializer = `
(function () {
  try {
    var themeKey = "gmp-theme";
    var settingsKey = "gmp-settings-v1";
    var storedTheme = window.localStorage.getItem(themeKey);
    var rawSettings = window.localStorage.getItem(settingsKey);
    var settings = null;
    if (rawSettings) {
      try {
        var parsed = JSON.parse(rawSettings);
        settings = parsed && parsed.settings ? parsed.settings : parsed;
      } catch (_) {}
    }

    var settingsTheme = settings && settings.appearance ? settings.appearance.theme : null;
    var preference = storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
      ? storedTheme
      : (settingsTheme === "light" || settingsTheme === "dark" || settingsTheme === "system" ? settingsTheme : "system");
    var system = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var theme = preference === "system" ? system : preference;

    document.documentElement.dataset.themePreference = preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    if (settings) {
      var density = settings.appearance && settings.appearance.density;
      if (density === "compact" || density === "comfortable" || density === "spacious") {
        document.documentElement.dataset.uiDensity = density;
      }
      var scale = settings.accessibility && Number(settings.accessibility.fontScale);
      if ([90, 100, 110, 120, 130].indexOf(scale) >= 0) {
        document.documentElement.dataset.fontScale = String(scale);
      }
      document.documentElement.dataset.highContrast = String(Boolean(settings.accessibility && settings.accessibility.highContrast));
      document.documentElement.dataset.keyboardShortcuts = String(settings.accessibility ? settings.accessibility.keyboardShortcuts !== false : true);
      document.documentElement.dataset.reduceMotion = String(Boolean(settings.appearance && settings.appearance.reduceMotion));
    }
  } catch (_) {
    document.documentElement.dataset.themePreference = "system";
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();`;

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/iranyekan/subset-IRANYekan.2cadc674.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{__html: preferenceInitializer}} />
      </head>
      <body>{children}</body>
    </html>
  );
}

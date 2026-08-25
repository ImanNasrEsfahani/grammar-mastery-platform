import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";
import "./theme-menu.css";

export const metadata: Metadata = {
  title: {
    default: "French Grammar Mastery",
    template: "%s · French Grammar Mastery",
  },
  description: "Mobile-first French grammar practice with evidence-aware review.",
};

const themeInitializer = `
(function () {
  try {
    var key = "gmp-theme";
    var stored = window.localStorage.getItem(key);
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();`;

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html: themeInitializer}} />
      </head>
      <body>{children}</body>
    </html>
  );
}

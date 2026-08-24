import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";

export const metadata: Metadata = {
  title: {
    default: "French Grammar Mastery",
    template: "%s · French Grammar Mastery",
  },
  description: "Mobile-first French grammar practice with evidence-aware review.",
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

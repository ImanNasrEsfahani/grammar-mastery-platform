import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { StatusPanel } from "@/components/ui/StatusPanel";

export function UnavailableSurface({locale, title, description, code = "API_RESOURCE_NOT_EXPOSED"}: {locale: Locale; title: string; description: string; code?: string}) {
  const isFa = locale === "fa";
  return (
    <div className="runner-shell">
      <header className="page-heading"><h1>{title}</h1><p>{description}</p></header>
      <StatusPanel title={isFa ? "این صفحه هنوز منبع API کامل ندارد" : "This page does not yet have a complete API resource"} tone="warning">
        <p><code>{code}</code></p>
        <p>{isFa ? "صفحه عمداً داده ساختگی نمایش نمی‌دهد. این وابستگی برای مرحله بعد ثبت شده است." : "The page intentionally shows no fabricated data. The dependency is recorded for the next API revision."}</p>
      </StatusPanel>
      <p><Link href={`/${locale}/dashboard`}>{isFa ? "بازگشت به داشبورد" : "Return to dashboard"}</Link></p>
    </div>
  );
}

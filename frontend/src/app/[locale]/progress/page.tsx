import { notFound } from "next/navigation";
import { UnavailableSurface } from "@/components/product/UnavailableSurface";
import { isLocale } from "@/lib/i18n";

export default async function ProgressPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params; if (!isLocale(locale)) notFound();
  return <UnavailableSurface locale={locale} code="PROGRESS_VISUALIZATION_DEFERRED" title={locale === "fa" ? "روند پیشرفت" : "Progress over time"} description={locale === "fa" ? "نمایش snapshotهای واقعی بدون پر کردن دوره‌های گمشده." : "Show persisted snapshots without inventing missing periods."} />;
}

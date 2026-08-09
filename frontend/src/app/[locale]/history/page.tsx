import { notFound } from "next/navigation";
import { UnavailableSurface } from "@/components/product/UnavailableSurface";
import { isLocale } from "@/lib/i18n";

export default async function HistoryPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params; if (!isLocale(locale)) notFound();
  return <UnavailableSurface locale={locale} title={locale === "fa" ? "تاریخچه آزمون‌ها" : "Attempt history"} description={locale === "fa" ? "مرور تلاش‌های قبلی و باز کردن نتیجه هر آزمون." : "Browse previous attempts and open their results."} />;
}

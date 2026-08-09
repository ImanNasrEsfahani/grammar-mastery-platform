import { notFound } from "next/navigation";
import { UnavailableSurface } from "@/components/product/UnavailableSurface";
import { isLocale } from "@/lib/i18n";

export default async function SettingsPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params; if (!isLocale(locale)) notFound();
  return <UnavailableSurface locale={locale} title={locale === "fa" ? "تنظیمات" : "Settings"} description={locale === "fa" ? "مدیریت زبان، منطقه زمانی و ترجیحات تمرین." : "Manage language, timezone and practice preferences."} />;
}

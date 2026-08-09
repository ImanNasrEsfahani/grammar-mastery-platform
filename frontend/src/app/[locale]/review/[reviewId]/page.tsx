import { notFound } from "next/navigation";
import { UnavailableSurface } from "@/components/product/UnavailableSurface";
import { isLocale } from "@/lib/i18n";

export default async function ReviewItemPage({params}: {params: Promise<{locale: string; reviewId: string}>}) {
  const {locale} = await params; if (!isLocale(locale)) notFound();
  return <UnavailableSurface locale={locale} code="REVIEW_RUNNER_ADAPTER_DEFERRED" title={locale === "fa" ? "مرور یک مورد" : "Review item"} description={locale === "fa" ? "پاسخ تا زمان تلاش مجدد یا reveal صریح مخفی می‌ماند." : "Feedback remains hidden until retry or explicit reveal."} />;
}

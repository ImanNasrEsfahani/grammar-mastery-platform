import {notFound} from "next/navigation";
import {SubcategoryDetailClient} from "@/components/product/SubcategoryDetailClient";
import {isLocale} from "@/lib/i18n";

export default async function SubcategoryDetailPage({
  params,
}: {
  params: Promise<{locale: string; subcategoryId: string}>;
}) {
  const {locale, subcategoryId} = await params;
  if (!isLocale(locale) || !subcategoryId) notFound();
  return <SubcategoryDetailClient locale={locale} subcategoryId={subcategoryId} />;
}

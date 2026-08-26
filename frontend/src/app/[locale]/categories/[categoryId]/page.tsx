import {notFound} from "next/navigation";
import {CategoryDetailClient} from "@/components/product/CategoryDetailClient";
import {isLocale} from "@/lib/i18n";

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{locale: string; categoryId: string}>;
}) {
  const {locale, categoryId} = await params;
  if (!isLocale(locale) || !categoryId) notFound();

  return <CategoryDetailClient locale={locale} categoryId={categoryId} />;
}

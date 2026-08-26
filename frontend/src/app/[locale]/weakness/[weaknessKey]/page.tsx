import {notFound} from "next/navigation";
import {WeaknessDetailClient} from "@/components/weakness/WeaknessDetailClient";
import {isLocale} from "@/lib/i18n";

type QueryParams = Record<string, string | string[] | undefined>;

export default async function WeaknessDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string; weaknessKey: string}>;
  searchParams: Promise<QueryParams>;
}) {
  const [{locale, weaknessKey}, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  return <WeaknessDetailClient locale={locale} weaknessKey={weaknessKey} query={query} />;
}

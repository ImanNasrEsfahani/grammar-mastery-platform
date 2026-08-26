import {notFound} from "next/navigation";
import {StreakDetailClient} from "@/components/streak/StreakDetailClient";
import {isLocale} from "@/lib/i18n";

export default async function StreakDetailPage({
  params,
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <StreakDetailClient locale={locale} />;
}

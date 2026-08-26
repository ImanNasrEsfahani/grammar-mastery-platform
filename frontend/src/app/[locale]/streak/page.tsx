import {resolveServerLocale} from "@/lib/i18n";
import {StreakDetailClient} from "@/components/streak/StreakDetailClient";

export default async function StreakDetailPage({
  params,
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale: rawLocale} = await params;
  const locale = resolveServerLocale(rawLocale);
  return <StreakDetailClient locale={locale} />;
}

import {notFound} from "next/navigation";
import {AchievementsClient} from "@/components/achievements/AchievementsClient";
import {isLocale} from "@/lib/i18n";

export default async function AchievementsPage({
  params,
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <AchievementsClient locale={locale} />;
}

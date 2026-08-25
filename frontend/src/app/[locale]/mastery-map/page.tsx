import {notFound} from "next/navigation";
import {MasteryMapClient} from "@/components/mastery/MasteryMapClient";
import {isLocale} from "@/lib/i18n";

export default async function MasteryMapPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <MasteryMapClient locale={locale} />;
}

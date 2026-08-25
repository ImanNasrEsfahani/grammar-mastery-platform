import {notFound} from "next/navigation";
import {HistoryClient} from "@/components/product/HistoryClient";
import {isLocale} from "@/lib/i18n";

export default async function HistoryPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <HistoryClient locale={locale} />;
}

import {notFound} from "next/navigation";
import {ProgressClient} from "@/components/progress/ProgressClient";
import {isLocale} from "@/lib/i18n";

export default async function ProgressPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <ProgressClient locale={locale} />;
}

import {notFound} from "next/navigation";
import {AttemptResultClient} from "@/components/product/AttemptResultClient";
import {isLocale} from "@/lib/i18n";

export default async function ResultPage({params}: {params: Promise<{locale: string; attemptId: string}>}) {
  const {locale, attemptId} = await params;
  if (!isLocale(locale)) notFound();
  return <AttemptResultClient attemptId={attemptId} locale={locale} />;
}

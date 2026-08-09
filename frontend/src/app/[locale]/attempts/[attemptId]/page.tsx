import { notFound } from "next/navigation";
import { AttemptRunner } from "@/components/runner/AttemptRunner";
import { isLocale } from "@/lib/i18n";

export default async function AttemptPage({params}: {params: Promise<{locale: string; attemptId: string}>}) {
  const {locale, attemptId} = await params;
  if (!isLocale(locale)) notFound();
  return <AttemptRunner attemptId={attemptId} locale={locale} />;
}

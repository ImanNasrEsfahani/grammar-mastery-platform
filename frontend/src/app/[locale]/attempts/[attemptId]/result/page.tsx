import { notFound } from "next/navigation";
import { AttemptResultClient } from "@/components/product/AttemptResultClient";
import { isLocale } from "@/lib/i18n";

export default async function ResultPage({params}: {params: Promise<{locale: string; attemptId: string}>}) {
  const {locale, attemptId} = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div className="runner-shell">
      <header className="page-heading"><h1>{locale === "fa" ? "نتیجه آزمون" : "Attempt result"}</h1></header>
      <AttemptResultClient attemptId={attemptId} locale={locale} />
    </div>
  );
}

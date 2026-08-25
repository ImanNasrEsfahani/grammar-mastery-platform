import {notFound} from "next/navigation";
import {TestBuilder} from "@/components/tests/TestBuilder";
import {isLocale} from "@/lib/i18n";

export default async function NewTestPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <TestBuilder locale={locale} />;
}

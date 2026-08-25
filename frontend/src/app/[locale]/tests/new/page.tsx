import {notFound} from "next/navigation";
import {PreferencesAwareTestBuilder} from "@/components/tests/PreferencesAwareTestBuilder";
import {isLocale} from "@/lib/i18n";

export default async function NewTestPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <PreferencesAwareTestBuilder locale={locale} />;
}

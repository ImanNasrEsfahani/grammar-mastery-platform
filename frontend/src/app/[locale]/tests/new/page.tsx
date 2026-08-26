import {notFound} from "next/navigation";
import {
  PreferencesAwareTestBuilder,
  type BuilderSearchParams,
} from "@/components/tests/PreferencesAwareTestBuilder";
import {isLocale} from "@/lib/i18n";

export default async function NewTestPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<BuilderSearchParams>;
}) {
  const [{locale}, initialSearchParams] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  return (
    <PreferencesAwareTestBuilder
      locale={locale}
      initialSearchParams={initialSearchParams}
    />
  );
}

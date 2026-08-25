import {cookies} from "next/headers";
import {notFound} from "next/navigation";
import {SettingsClient} from "@/components/settings/SettingsClient";
import {isLocale} from "@/lib/i18n";

export default async function SettingsPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();

  const cookieStore = await cookies();
  const authenticated = Boolean(cookieStore.get("gmp_access_token")?.value);

  return <SettingsClient locale={locale} authenticated={authenticated} />;
}

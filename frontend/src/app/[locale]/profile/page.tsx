import {notFound} from "next/navigation";
import {ProfileClient} from "@/components/product/ProfileClient";
import {isLocale} from "@/lib/i18n";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <ProfileClient locale={locale} />;
}

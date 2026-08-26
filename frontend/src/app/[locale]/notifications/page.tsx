import {notFound} from "next/navigation";
import {NotificationsClient} from "@/components/notifications/NotificationsClient";
import {isLocale} from "@/lib/i18n";

export default async function NotificationsPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <NotificationsClient locale={locale} />;
}

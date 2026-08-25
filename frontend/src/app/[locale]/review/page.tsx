import {notFound} from "next/navigation";
import {ReviewInbox} from "@/components/review/ReviewInbox";
import {isLocale} from "@/lib/i18n";

export default async function ReviewPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <ReviewInbox locale={locale} />;
}

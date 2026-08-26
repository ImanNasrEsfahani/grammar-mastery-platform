import {notFound} from "next/navigation";
import {FeedbackShowcase} from "@/components/ui/feedback/FeedbackShowcase";
import {isLocale} from "@/lib/i18n";

export default async function FeedbackSystemPage({
  params,
}: {
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <FeedbackShowcase locale={locale} />;
}

import {notFound} from "next/navigation";
import {ReviewRunnerClient} from "@/components/product/ReviewRunnerClient";
import {isLocale} from "@/lib/i18n";

export default async function ReviewItemPage({
  params,
}: {
  params: Promise<{locale: string; reviewId: string}>;
}) {
  const {locale, reviewId} = await params;
  if (!isLocale(locale)) notFound();
  return <ReviewRunnerClient locale={locale} reviewId={reviewId} />;
}

import {notFound} from "next/navigation";
import {ReviewRunnerClient} from "@/components/product/ReviewRunnerClient";
import {isLocale} from "@/lib/i18n";

export default async function ReviewItemPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string; reviewId: string}>;
  searchParams: Promise<{mode?: string | string[]; fresh?: string | string[]}>;
}) {
  const [{locale, reviewId}, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  const modeValue = Array.isArray(query.mode) ? query.mode[0] : query.mode;
  const freshValue = Array.isArray(query.fresh) ? query.fresh[0] : query.fresh;
  const sessionMode = modeValue === "due" ? "due" : "single";
  const forceFresh = freshValue === "1";

  return (
    <ReviewRunnerClient
      locale={locale}
      reviewId={reviewId}
      sessionMode={sessionMode}
      forceFresh={forceFresh}
    />
  );
}

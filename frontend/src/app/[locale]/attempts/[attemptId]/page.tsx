import {notFound} from "next/navigation";
import {AttemptRunner} from "@/components/runner/AttemptRunner";
import {isLocale} from "@/lib/i18n";

export default async function AttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string; attemptId: string}>;
  searchParams?: Promise<{total?: string | string[]}>;
}) {
  const {locale, attemptId} = await params;
  if (!isLocale(locale)) notFound();
  const query = searchParams ? await searchParams : {};
  const rawTotal = Array.isArray(query.total) ? query.total[0] : query.total;
  const parsedTotal = rawTotal ? Number(rawTotal) : NaN;
  const expectedTotal = Number.isInteger(parsedTotal) && parsedTotal > 0 && parsedTotal <= 100 ? parsedTotal : undefined;
  return <AttemptRunner attemptId={attemptId} locale={locale} expectedTotal={expectedTotal} />;
}

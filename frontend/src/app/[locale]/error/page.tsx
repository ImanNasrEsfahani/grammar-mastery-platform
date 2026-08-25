import {notFound} from "next/navigation";
import {ServiceUnavailable} from "@/components/errors/ServiceUnavailable";
import {isLocale} from "@/lib/i18n";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeReturnTo(value: string | undefined, locale: string): string | null {
  if (!value || value.startsWith("//")) return null;
  if (!value.startsWith(`/${locale}/`)) return null;
  if (value === `/${locale}/error` || value.startsWith(`/${locale}/error?`)) return null;
  return value;
}

function safeReference(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 96);
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

export default async function ServiceUnavailablePage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<Query>;
}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();

  const query = await searchParams;
  const retryHref = safeReturnTo(first(query.return_to), locale);
  const referenceCode = safeReference(first(query.request_id) ?? first(query.reference));

  return (
    <ServiceUnavailable
      locale={locale}
      retryHref={retryHref}
      referenceCode={referenceCode}
    />
  );
}

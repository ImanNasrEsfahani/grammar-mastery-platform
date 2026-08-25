import {notFound} from "next/navigation";
import {GrammarSearchClient} from "@/components/search/GrammarSearchClient";
import {isLocale} from "@/lib/i18n";

type SearchQuery = Record<string, string | string[] | undefined>;
type SearchKind = "ALL" | "LESSON" | "SUBTOPIC" | "RULE" | "CATEGORY";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeKind(value: string | undefined): SearchKind {
  const normalized = value?.toUpperCase();
  return normalized === "LESSON" || normalized === "SUBTOPIC" || normalized === "RULE" || normalized === "CATEGORY"
    ? normalized
    : "ALL";
}

export default async function GrammarSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<SearchQuery>;
}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const initialQuery = (first(query.q) ?? "").trim().slice(0, 120);
  const initialKind = safeKind(first(query.kind));
  return <GrammarSearchClient locale={locale} initialQuery={initialQuery} initialKind={initialKind} />;
}

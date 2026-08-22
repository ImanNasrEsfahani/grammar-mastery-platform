import {notFound} from "next/navigation";
import {LessonContentClient} from "@/components/product/LessonContentClient";
import {isLocale} from "@/lib/i18n";
import {resolveGrammarBookSlug} from "@/lib/grammar-content/books";

type LessonPageProps = {
  params: Promise<{locale: string; lessonId: string}>;
  searchParams: Promise<{book?: string | string[]}>;
};

export default async function LessonPage({params, searchParams}: LessonPageProps) {
  const [{locale, lessonId}, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  const requestedBook = Array.isArray(query.book) ? query.book[0] : query.book;
  const bookSlug = resolveGrammarBookSlug(requestedBook);
  if (!bookSlug) notFound();

  return (
    <LessonContentClient
      locale={locale}
      lessonId={lessonId}
      bookSlug={bookSlug}
    />
  );
}

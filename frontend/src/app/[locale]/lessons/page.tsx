import {notFound} from "next/navigation";
import {LessonListClient} from "@/components/product/LessonListClient";
import {isLocale} from "@/lib/i18n";

export default async function LessonsPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <LessonListClient locale={locale} />;
}

import { notFound } from "next/navigation";
import { LessonListClient } from "@/components/product/LessonListClient";
import { isLocale } from "@/lib/i18n";

export default async function LessonsPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return (
    <>
      <header className="page-heading"><p className="eyebrow">{locale === "fa" ? "۵۲ درس" : "52 lessons"}</p><h1>{locale === "fa" ? "نقشه گرامر" : "Grammar map"}</h1></header>
      <LessonListClient locale={locale} />
    </>
  );
}

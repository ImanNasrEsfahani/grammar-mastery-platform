import { notFound } from "next/navigation";
import { UnavailableSurface } from "@/components/product/UnavailableSurface";
import { isLocale } from "@/lib/i18n";

export default async function LessonPage({params}: {params: Promise<{locale: string; lessonId: string}>}) {
  const {locale} = await params; if (!isLocale(locale)) notFound();
  return <UnavailableSurface locale={locale} code="LESSON_ANALYTICS_VIEW_DEFERRED" title={locale === "fa" ? "تحلیل درس" : "Lesson analytics"} description={locale === "fa" ? "تسلط، اطمینان، پوشش و اقدام بعدی این درس." : "Mastery, confidence, coverage and the next action for this lesson."} />;
}

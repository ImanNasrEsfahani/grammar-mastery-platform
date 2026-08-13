import { notFound } from "next/navigation";
import { TestBuilder } from "@/components/tests/TestBuilder";
import { isLocale } from "@/lib/i18n";

export default async function NewTestPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div className="test-builder-page">
      <header className="page-heading">
        <p className="eyebrow">{locale === "fa" ? "تمرین متمرکز" : "Focused practice"}</p>
        <h1>{locale === "fa" ? "ساخت تمرین جدید" : "Create a new practice"}</h1>
        <p>{locale === "fa" ? "انتخاب سؤال و امتیازدهی فقط در سرور انجام می‌شود." : "Question selection and scoring remain server-authoritative."}</p>
      </header>
      <TestBuilder locale={locale} />
    </div>
  );
}

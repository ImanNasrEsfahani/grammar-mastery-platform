import { notFound } from "next/navigation";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { isLocale } from "@/lib/i18n";

export default async function DashboardPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">{locale === "fa" ? "نمای کلی یادگیری" : "Learning overview"}</p>
        <h1>{locale === "fa" ? "مسیر بعدی شما" : "Your next learning move"}</h1>
      </header>
      <DashboardClient locale={locale} />
    </>
  );
}

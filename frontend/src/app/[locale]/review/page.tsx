import { notFound } from "next/navigation";
import { ReviewListClient } from "@/components/product/ReviewListClient";
import { isLocale } from "@/lib/i18n";

export default async function ReviewPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return (
    <>
      <header className="page-heading"><p className="eyebrow">{locale === "fa" ? "مرور هدفمند" : "Targeted review"}</p><h1>{locale === "fa" ? "صف مرور" : "Review queue"}</h1></header>
      <ReviewListClient locale={locale} />
    </>
  );
}

import { notFound } from "next/navigation";
import { UnavailableSurface } from "@/components/product/UnavailableSurface";
import { isLocale } from "@/lib/i18n";

export default async function ProfilePage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params; if (!isLocale(locale)) notFound();
  return <UnavailableSurface locale={locale} title={locale === "fa" ? "پروفایل" : "Profile"} description={locale === "fa" ? "نمایش اطلاعات یادگیرنده." : "View learner profile information."} />;
}

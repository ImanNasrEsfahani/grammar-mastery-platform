import {notFound} from "next/navigation";
import {RegisterExperience} from "@/components/auth/RegisterExperience";
import {isLocale} from "@/lib/i18n";

export default async function RegisterPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <RegisterExperience locale={locale} />;
}

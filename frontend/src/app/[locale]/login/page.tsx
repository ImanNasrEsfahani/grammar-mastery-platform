import { notFound } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { isLocale } from "@/lib/i18n";

export default async function LoginPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return <AuthForm mode="login" locale={locale} />;
}

import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {PasswordRecoveryClient} from "@/components/auth/PasswordRecoveryClient";
import {isLocale} from "@/lib/i18n";

export const metadata: Metadata = {
  robots: {index: false, follow: false},
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{token?: string | string[]}>;
}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : null;
  return <PasswordRecoveryClient locale={locale} mode="reset" token={token} />;
}

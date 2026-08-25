import {notFound} from "next/navigation";
import {UnavailableSurface} from "@/components/product/UnavailableSurface";
import {isLocale} from "@/lib/i18n";

export default async function ForgotPasswordPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  return (
    <UnavailableSurface
      locale={locale}
      code="PASSWORD_RESET_API_NOT_EXPOSED"
      title={locale === "fa" ? "بازیابی گذرواژه" : "Forgot password"}
      description={locale === "fa"
        ? "مسیر بازیابی ایجاد شده است، اما سرویس امن ارسال لینک بازیابی هنوز در قرارداد API فعلی تعریف نشده است."
        : "The recovery route exists, but the secure reset-link service is not yet exposed by the current API contract."}
    />
  );
}

import Link from "next/link";
import {notFound} from "next/navigation";
import {isLocale} from "@/lib/i18n";

export default async function TermsPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  const isFa = locale === "fa";
  return (
    <article className="surface form-surface stack">
      <p className="eyebrow">{isFa ? "وضعیت حقوقی: پیش‌نویس" : "Legal status: placeholder"}</p>
      <h1>{isFa ? "شرایط استفاده" : "Terms of Use"}</h1>
      <p>{isFa
        ? "متن حقوقی تأییدشده برای شرایط استفاده در مخزن فعلی وجود ندارد. این route فقط برای پایداربودن مسیر ثبت‌نام ایجاد شده است و باید پیش از انتشار عمومی با متن مورد تأیید مالک محصول/مشاور حقوقی جایگزین شود."
        : "The current repository does not contain approved Terms of Use. This route exists only to provide a stable registration destination and must be replaced with product-owner/legal-counsel approved copy before public launch."}</p>
      <Link className="button button-secondary" href={`/${locale}/register`}>{isFa ? "بازگشت به ثبت‌نام" : "Back to registration"}</Link>
    </article>
  );
}

import Link from "next/link";
import {notFound} from "next/navigation";
import {isLocale} from "@/lib/i18n";

export default async function PrivacyPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  if (!isLocale(locale)) notFound();
  const isFa = locale === "fa";
  return (
    <article className="surface form-surface stack">
      <p className="eyebrow">{isFa ? "وضعیت حقوقی: پیش‌نویس" : "Legal status: placeholder"}</p>
      <h1>{isFa ? "سیاست حریم خصوصی" : "Privacy Policy"}</h1>
      <p>{isFa
        ? "متن حقوقی تأییدشده برای حریم خصوصی در مخزن فعلی وجود ندارد. این route فقط نقطه اتصال UI است و باید پیش از انتشار عمومی با سیاست حریم خصوصی تأییدشده جایگزین شود."
        : "The current repository does not contain an approved Privacy Policy. This route is only the UI integration point and must be replaced with approved privacy copy before public launch."}</p>
      <Link className="button button-secondary" href={`/${locale}/register`}>{isFa ? "بازگشت به ثبت‌نام" : "Back to registration"}</Link>
    </article>
  );
}

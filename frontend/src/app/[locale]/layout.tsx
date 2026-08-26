import {cookies} from "next/headers";
import {notFound} from "next/navigation";
import {AppHeader} from "@/components/navigation/AppHeader";
import {FeedbackProvider} from "@/components/ui/FeedbackSystem";
import {isLocale, localeDirection, localeLanguage, locales, t} from "@/lib/i18n";

export function generateStaticParams() {
  return locales.map((locale) => ({locale}));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{locale: string}>;
}>) {
  const {locale: rawLocale} = await params;
  if (!isLocale(rawLocale)) notFound();
  const labels = t(rawLocale);
  const cookieStore = await cookies();
  const authenticated = Boolean(cookieStore.get("gmp_access_token")?.value);

  return (
    <div lang={localeLanguage(rawLocale)} dir={localeDirection(rawLocale)} className="app-frame">
      <FeedbackProvider locale={rawLocale}>
        <a className="skip-link" href="#main-content">{labels.skip}</a>
        <AppHeader locale={rawLocale} authenticated={authenticated} />
        <main id="main-content" className="page-container" tabIndex={-1}>
          {children}
        </main>
      </FeedbackProvider>
    </div>
  );
}

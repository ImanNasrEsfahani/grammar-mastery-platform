import Link from "next/link";
import type {Locale} from "@/lib/i18n";
import styles from "./ServiceUnavailable.module.css";

const copy = {
  fa: {
    title: "در حال بهبود تجربه شما هستیم",
    description: "سرویس در حال حاضر موقتاً در دسترس نیست. تیم ما در حال نگهداری و بهبود پلتفرم است تا با پایداری و عملکرد بهتر برگردیم.",
    assuranceTitle: "پیشرفت شما محفوظ است",
    assuranceBody: "پاسخ‌ها، سابقه تمرین و پیشرفت ثبت‌شده شما از بین نمی‌رود. چند دقیقه دیگر دوباره تلاش کنید.",
    retry: "تلاش دوباره",
    dashboard: "بازگشت به داشبورد",
    lessons: "دیدن درس‌ها",
    helpTitle: "به کمک نیاز دارید؟",
    helpBody: "اگر اختلال ادامه داشت، تیم پشتیبانی در دسترس است.",
    reference: "کد پیگیری",
    supportLabel: "ارتباط با پشتیبانی",
    footer: "Grammar Mastery",
  },
  en: {
    title: "We’re improving your experience",
    description: "The service is temporarily unavailable. Our team is performing maintenance and reliability improvements so the platform can return in better shape.",
    assuranceTitle: "Your progress is safe",
    assuranceBody: "Your saved answers, practice history, and recorded progress are not lost. Please try again in a few minutes.",
    retry: "Try again",
    dashboard: "Return to dashboard",
    lessons: "View lessons",
    helpTitle: "Need help?",
    helpBody: "If the interruption continues, our support team is available.",
    reference: "Reference code",
    supportLabel: "Contact support",
    footer: "Grammar Mastery",
  },
} as const;

function MaintenanceIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 720 350" role="img" aria-label="Maintenance illustration">
      <defs>
        <linearGradient id="gmpDevice" x1="0" x2="1">
          <stop offset="0" stopColor="#1f2c42" />
          <stop offset="1" stopColor="#4d5e79" />
        </linearGradient>
        <linearGradient id="gmpBlue" x1="0" x2="1">
          <stop offset="0" stopColor="#1758f5" />
          <stop offset=".55" stopColor="#3478ff" />
          <stop offset="1" stopColor="#82a8ff" />
        </linearGradient>
        <linearGradient id="gmpMetal" x1="0" x2="1">
          <stop offset="0" stopColor="#71809a" />
          <stop offset=".5" stopColor="#c2ccdc" />
          <stop offset="1" stopColor="#687791" />
        </linearGradient>
        <filter id="gmpShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#0b1d3d" floodOpacity=".16" />
        </filter>
      </defs>

      <g className={styles.sparkles} aria-hidden="true">
        <path d="M110 67h18M119 58v18M598 82h18M607 73v18M642 158h20M652 148v20" />
        <path d="M172 126h10M177 121v10M346 58h10M351 53v10" />
        <circle cx="498" cy="61" r="5" />
        <circle cx="558" cy="224" r="5" />
      </g>

      <ellipse className={styles.floorShadow} cx="365" cy="306" rx="252" ry="18" />

      <g className={styles.plant} aria-hidden="true">
        <path d="M164 289V178" />
        <path d="M164 219c-35-7-45-25-37-47 27 4 42 18 37 47Z" />
        <path d="M165 200c31-12 43-31 33-51-28 8-39 24-33 51Z" />
        <path d="M163 246c-31-2-45-15-44-36 27-1 42 11 44 36Z" />
        <path d="M166 241c30-8 45-22 39-43-27 3-42 17-39 43Z" />
        <path d="M143 252h42l-7 45h-28l-7-45Z" />
      </g>

      <g className={styles.cone} aria-hidden="true">
        <path d="M133 299h92l-8 13h-76l-8-13Z" />
        <path d="M167 219h26l23 80h-72l23-80Z" />
        <path d="M155 259h50l6 20h-62l6-20Z" />
      </g>

      <g filter="url(#gmpShadow)" aria-hidden="true">
        <rect x="225" y="86" width="316" height="205" rx="17" fill="url(#gmpDevice)" />
        <rect className={styles.screen} x="239" y="101" width="288" height="170" rx="7" />
        <circle cx="383" cy="94" r="3" fill="#71809a" />
        <path d="M202 289h360l-18 17H220l-18-17Z" fill="#73819a" />
        <path d="M337 289h93l-10 10h-73l-10-10Z" fill="#4e5d75" />
      </g>

      <g className={styles.gear} transform="translate(383 171)" aria-hidden="true">
        <circle r="48" className={styles.gearHalo} />
        <path d="M-10-40h20l4 12 12 5 11-6 14 14-6 11 5 12 12 4v20l-12 4-5 12 6 11-14 14-11-6-12 5-4 12h-20l-4-12-12-5-11 6-14-14 6-11-5-12-12-4V12l12-4 5-12-6-11 14-14 11 6 12-5 4-12Z" />
        <circle r="17" className={styles.gearHole} />
      </g>

      <g aria-hidden="true">
        <rect className={styles.progressTrack} x="292" y="238" width="186" height="12" rx="6" />
        <rect x="292" y="238" width="121" height="12" rx="6" fill="url(#gmpBlue)" />
        <text className={styles.progressLabel} x="385" y="269" textAnchor="middle">65%</text>
      </g>

      <g className={styles.wrench} transform="translate(548 145) rotate(-15)" aria-hidden="true">
        <path d="M31 0c18 11 21 31 11 47L21 81l18 109c2 14-7 26-20 28-13 2-25-7-27-20L-23 88l-31-24c-16-12-20-34-10-51l25 24 20-7 7-20L-36-14C-18-25 2-20 13-5l18 5Z" fill="url(#gmpMetal)" />
        <circle cx="15" cy="192" r="9" fill="#52617b" />
      </g>
    </svg>
  );
}

export function ServiceUnavailable({
  locale,
  retryHref = null,
  referenceCode = null,
}: {
  locale: Locale;
  retryHref?: string | null;
  referenceCode?: string | null;
}) {
  const text = copy[locale];
  return (
    <section className={styles.page} dir={locale === "fa" ? "rtl" : "ltr"} aria-labelledby="service-unavailable-title">
      <div className={styles.mainCard}>
        <MaintenanceIllustration />

        <div className={styles.copyBlock}>
          <p className={styles.eyebrow} dir="ltr">MAINTENANCE EN COURS</p>
          <h1 id="service-unavailable-title">{text.title}</h1>
          <p className={styles.description}>{text.description}</p>
        </div>

        <div className={styles.assurance} role="status">
          <span className={styles.clockIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <div className={styles.assuranceCopy}>
            <strong>{text.assuranceTitle}</strong>
            <span>{text.assuranceBody}</span>
          </div>
          {retryHref ? <Link className={styles.retryLink} href={retryHref}>{text.retry}</Link> : null}
        </div>

        <div className={styles.actions}>
          <Link className={styles.primaryButton} href={`/${locale}/dashboard`}>
            <span aria-hidden="true">⌂</span>{text.dashboard}
          </Link>
          <Link className={styles.secondaryButton} href={`/${locale}/lessons`}>
            <span aria-hidden="true">▤</span>{text.lessons}
          </Link>
        </div>

        <aside className={styles.supportCard} aria-label={text.helpTitle}>
          <div className={styles.supportLead}>
            <span className={styles.helpIcon} aria-hidden="true">?</span>
            <div>
              <strong>{text.helpTitle}</strong>
              <p>{text.helpBody}</p>
            </div>
          </div>
          <div className={styles.supportMeta}>
            <a className={styles.supportLink} href="mailto:support@grammar-mastery.com" aria-label={text.supportLabel}>
              <span aria-hidden="true">✉</span>
              <span dir="ltr">support@grammar-mastery.com</span>
            </a>
            {referenceCode ? (
              <p className={styles.reference}><span>{text.reference}:</span> <code dir="ltr">{referenceCode}</code></p>
            ) : null}
          </div>
        </aside>

        <footer className={styles.footer}>
          <span>© {new Date().getFullYear()} {text.footer}</span>
          <span className={styles.footerNote}>French Grammar Mastery</span>
        </footer>
      </div>
    </section>
  );
}

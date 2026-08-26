"use client";

import {useState} from "react";
import type {Locale} from "@/lib/i18n";
import {
  ConfirmationStrip,
  InlineAlert,
  PersistentBanner,
  useFeedback,
  type FeedbackTone,
} from "./FeedbackSystem";
import styles from "./FeedbackShowcase.module.css";

const previewMessages: Record<FeedbackTone, {fa: string; en: string}> = {
  success: {fa: "تنظیمات با موفقیت ذخیره شد.", en: "Settings were saved successfully."},
  info: {fa: "جلسه مرور شما آماده است.", en: "Your review session is ready."},
  warning: {fa: "فقط ۲ دقیقه تا پایان زمان باقی مانده.", en: "Only 2 minutes remain."},
  error: {fa: "ذخیره پاسخ ناموفق بود. دوباره تلاش کنید.", en: "Saving the answer failed. Please retry."},
};

const toneLabels: Record<FeedbackTone, {fa: string; en: string}> = {
  success: {fa: "موفقیت", en: "Success"},
  info: {fa: "اطلاعات", en: "Info"},
  warning: {fa: "هشدار", en: "Warning"},
  error: {fa: "خطا", en: "Error"},
};

const toneIcons: Record<FeedbackTone, string> = {
  success: "✓",
  info: "i",
  warning: "!",
  error: "×",
};

function localized<T extends {fa: string; en: string}>(value: T, locale: Locale) {
  return value[locale === "fa" ? "fa" : "en"];
}

function toneClass(tone: FeedbackTone) {
  if (tone === "success") return styles.toneSuccess;
  if (tone === "info") return styles.toneInfo;
  if (tone === "warning") return styles.toneWarning;
  return styles.toneError;
}

export function FeedbackShowcase({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const feedback = useFeedback();
  const [bannerVisible, setBannerVisible] = useState(true);

  const fireToast = (tone: FeedbackTone) => {
    const message = localized(previewMessages[tone], locale);
    if (tone === "success") feedback.success(message);
    else if (tone === "info") feedback.info(message);
    else if (tone === "warning") feedback.warning(message);
    else feedback.error(message, {
      action: {
        label: isFa ? "تلاش دوباره" : "Retry",
        onClick: () => { feedback.success(isFa ? "ارسال دوباره انجام شد." : "Retry started."); },
      },
    });
  };

  return (
    <div className={styles.page} data-feedback-showcase="true">
      <div className={styles.referenceHeader} aria-label="Grammar Mastery Feedback System">
        <a className={styles.referenceBrand} href={`/${locale}/dashboard`}>
          <span className={styles.referenceMark} aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none">
              <path d="M5 5.5h7.8c1.5 0 2.7.6 3.2 1.6.6-1 1.8-1.6 3.3-1.6H23v16h-4.2c-1.8 0-3.1.6-3.8 1.6-.7-1-2-1.6-3.8-1.6H5v-16Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M15 7.2v15.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <span className={styles.referenceBrandCopy}><strong>GRAMMAR</strong><small>MASTERY</small></span>
        </a>
        <strong className={styles.referenceLabel}>Feedback System</strong>
      </div>

      <header className={styles.pageHeading}>
        <h1>Toast / Alert / Confirmation System</h1>
        <p>{isFa ? "سیستم یکپارچه feedback برای موفقیت، خطا، هشدار، اطلاع‌رسانی، Undo و Retry" : "Unified feedback for success, error, warning, information, Undo and Retry."}</p>
      </header>

      <div className={styles.topGrid}>
        <section className={styles.panel} aria-labelledby="toast-variants-title">
          <h2 id="toast-variants-title">Toast Variants</h2>
          <div className={styles.variantList}>
            {(["success", "info", "warning", "error"] as FeedbackTone[]).map((tone) => (
              <button
                key={tone}
                type="button"
                className={`${styles.previewToast} ${toneClass(tone)}`}
                onClick={() => fireToast(tone)}
                aria-label={`${localized(toneLabels[tone], locale)}: ${localized(previewMessages[tone], locale)}`}
              >
                <span className={styles.previewIcon} aria-hidden="true">{toneIcons[tone]}</span>
                <strong>{localized(toneLabels[tone], locale)}</strong>
                <span className={styles.previewMessage} dir="auto">{localized(previewMessages[tone], locale)}</span>
                <span className={styles.previewDismiss} aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="stacking-title">
          <h2 id="stacking-title">Stacking / Placement</h2>
          <p className={styles.panelNote}>Desktop: top-end • max 3 visible</p>
          <div className={styles.stackPreview} aria-hidden="true">
            {(["success", "info", "warning"] as FeedbackTone[]).map((tone) => (
              <div key={tone} className={`${styles.miniToast} ${toneClass(tone)}`}>
                <span className={styles.previewIcon}>{toneIcons[tone]}</span>
                <div>
                  <strong>{localized(toneLabels[tone], locale)}</strong>
                  <small dir="auto">{localized(previewMessages[tone], locale)}</small>
                </div>
              </div>
            ))}
          </div>
          <p className={styles.autoDismiss}>Auto-dismiss: 4–6s • Error persists longer</p>
        </section>
      </div>

      <div className={styles.bottomGrid}>
        <section className={styles.panel} aria-labelledby="alerts-title">
          <h2 id="alerts-title">Inline Alerts / Banners</h2>
          <div className={styles.alertList}>
            <InlineAlert tone="info" title={isFa ? "اطلاعات" : "Info"}>
              {isFa ? "این تمرین بر اساس نقاط ضعف اخیر شما ساخته شده است." : "This practice was built from your recent weak areas."}
            </InlineAlert>
            <InlineAlert tone="success" title={isFa ? "موفقیت" : "Success"}>
              {isFa ? "همه مرورهای امروز تکمیل شدند." : "All reviews due today are complete."}
            </InlineAlert>
            <InlineAlert tone="warning" title={isFa ? "هشدار" : "Warning"}>
              {isFa ? "این فیلتر سه نتیجه برمی‌گرداند." : "This filter returns three results."}
            </InlineAlert>
            <InlineAlert tone="error" title={isFa ? "خطا" : "Error"}>
              {isFa ? "اتصال به سرویس قطع شد؛ پیشرفت محلی حفظ شده است." : "The service connection was lost; local progress is preserved."}
            </InlineAlert>
            {bannerVisible ? (
              <PersistentBanner
                tone="info"
                title={isFa ? "اعلان پایدار" : "Persistent banner"}
                onDismiss={() => setBannerVisible(false)}
                dismissLabel={isFa ? "بستن" : "Dismiss"}
              >
                {isFa ? "برای اعلان‌هایی که باید تا اقدام یا بستن کاربر باقی بمانند." : "Use for notices that must remain until action or dismissal."}
              </PersistentBanner>
            ) : (
              <button className={styles.restoreBanner} type="button" onClick={() => setBannerVisible(true)}>
                {isFa ? "نمایش دوباره Banner" : "Restore banner"}
              </button>
            )}
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="confirmation-title">
          <h2 id="confirmation-title">Confirmation / Undo / Retry</h2>
          <div className={styles.actionList}>
            <div className={styles.actionStrip}>
              <span dir="auto">{isFa ? "سؤال از Review Inbox حذف شد." : "Question removed from Review Inbox."}</span>
              <button type="button" className={styles.linkAction} onClick={() => feedback.info(isFa ? "حذف سؤال برگردانده شد." : "Removal was undone.")}>Undo</button>
            </div>
            <div className={styles.actionStrip}>
              <span className={styles.retryCopy} dir="auto">{isFa ? "ارسال پاسخ ناموفق بود." : "Answer submission failed."}</span>
              <button type="button" className={styles.retryButton} onClick={() => feedback.success(isFa ? "ارسال دوباره با موفقیت انجام شد." : "Retry completed successfully.")}>Retry</button>
            </div>
            <ConfirmationStrip
              message={isFa ? "آیا مطمئن هستید این تلاش حذف شود؟" : "Are you sure you want to delete this attempt?"}
              cancelLabel={isFa ? "لغو" : "Cancel"}
              confirmLabel={isFa ? "حذف" : "Delete"}
              onCancel={() => feedback.info(isFa ? "حذف لغو شد." : "Deletion cancelled.")}
              onConfirm={() => { feedback.success(isFa ? "تلاش حذف شد." : "Attempt deleted."); }}
            />
          </div>
        </section>
      </div>

      <footer className={styles.accessibilityBar}>
        <strong>Accessibility:</strong>
        <span>{isFa ? "aria-live متناسب • رنگ تنها indicator نیست • keyboard dismiss • action button با label واضح • mobile placement بالای Bottom Nav" : "appropriate aria-live • color is never the only indicator • keyboard dismiss • clearly labeled actions • mobile placement above Bottom Nav"}</span>
      </footer>
    </div>
  );
}

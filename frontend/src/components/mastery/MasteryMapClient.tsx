"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import type {CSSProperties} from "react";
import {EmptyState} from "@/components/ui/EmptyState";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import styles from "./MasteryMapClient.module.css";

type MasteryBand = "NO_EVIDENCE" | "UNCERTAIN" | "WEAK" | "DEVELOPING" | "STRONG";
type NodeKind = "category" | "subcategory" | "lesson";

type Mastery = {
  mastery_score_pct: number;
  confidence: number;
  coverage_ratio: number;
  evidence_count: number;
  mastery_band: MasteryBand;
  model_version: string;
  source: string;
  canonical_scope: boolean;
  derived_for_ui: boolean;
};

type Misconception = {
  id: string;
  family: string;
  name_fa: string | null;
  statement_fa: string;
  diagnostic_interpretation_fa: string | null;
  subtopic_id: string;
  subtopic_title_fr: string;
  subtopic_title_fa: string | null;
  repeat_count: number;
  last_wrong_at: string | null;
};

type Subtopic = {
  id: string;
  lesson_id: string;
  code: string;
  title_fr: string;
  title_fa: string | null;
  short_definition_fa: string | null;
  display_title: string;
  mastery: Mastery;
};

type Lesson = {
  id: string;
  lesson_no: number;
  title_fr: string;
  short_title: string;
  category_id: string;
  subcategory_id: string;
  tcf_weight: number;
  display_title: string;
  mastery: Mastery;
  subtopics: Subtopic[];
  top_misconception: Misconception | null;
  unresolved_review_count: number;
};

type Subcategory = {
  id: string;
  code: string;
  slug: string;
  category_id: string;
  title_fr: string;
  title_fa: string | null;
  display_order: number;
  display_title: string;
  mastery: Mastery;
  lessons: Lesson[];
};

type Category = {
  id: string;
  code: string;
  slug: string;
  title_fr: string;
  title_fa: string | null;
  display_order: number;
  display_title: string;
  tcf_weight: number;
  mastery: Mastery;
  subcategories: Subcategory[];
};

type MasteryMapEnvelope = {
  data: {
    summary: {
      overall_mastery_pct: number | null;
      coverage_pct: number;
      category_count: number;
      subcategory_count: number;
      lesson_count: number;
      subtopic_count: number;
      band_counts: Record<MasteryBand, number>;
      mastery: Mastery;
    };
    semantics: {
      canonical_scopes: string[];
      display_only_scopes: string[];
      bands: MasteryBand[];
      confidence_gate: number;
      weak_below: number;
      strong_at_or_above: number;
      mastery_model_version: string;
    };
    categories: Category[];
  };
  meta: {request_id: string; api_version: string; runtime_version: string};
};

type CachedMap = {savedAt: string; envelope: MasteryMapEnvelope};
type Selection = {kind: NodeKind; id: string};

type SelectedNode =
  | {kind: "category"; category: Category; mastery: Mastery; title: string; subtitle: string}
  | {kind: "subcategory"; category: Category; subcategory: Subcategory; mastery: Mastery; title: string; subtitle: string}
  | {kind: "lesson"; category: Category; subcategory: Subcategory; lesson: Lesson; mastery: Mastery; title: string; subtitle: string};

const BAND_ORDER: MasteryBand[] = ["STRONG", "DEVELOPING", "WEAK", "UNCERTAIN", "NO_EVIDENCE"];

export function MasteryMapClient({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const [data, setData] = useState<CachedMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [query, setQuery] = useState("");
  const [band, setBand] = useState<MasteryBand | "ALL">("ALL");
  const [categoryId, setCategoryId] = useState("ALL");
  const [selection, setSelection] = useState<Selection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await apiRequest<MasteryMapEnvelope>(`/api/backend/mastery-map?locale=${locale}`);
      if (!envelope) throw new ApiError({status: 502, code: "EMPTY_MASTERY_MAP", message: "Mastery map data was empty."});
      const snapshot = {savedAt: new Date().toISOString(), envelope};
      sessionStorage.setItem(`gmp-mastery-map-safe-snapshot-${locale}`, JSON.stringify(snapshot));
      setData(snapshot);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Mastery map loading failed."}));
      const cached = sessionStorage.getItem(`gmp-mastery-map-safe-snapshot-${locale}`);
      if (cached) {
        try { setData(JSON.parse(cached) as CachedMap); }
        catch { sessionStorage.removeItem(`gmp-mastery-map-safe-snapshot-${locale}`); }
      }
    } finally {
      setLoading(false);
    }
  }, [locale]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const categories = data?.envelope.data.categories ?? [];
  const defaultSelection = useMemo<Selection | null>(() => chooseDefaultSelection(categories), [categories]);

  const filteredCategories = useMemo(() => {
    const normalized = normalizeSearch(query);
    return categories
      .filter((category) => categoryId === "ALL" || category.id === categoryId)
      .flatMap((category) => {
        const categorySelf = nodeMatches(category.display_title, category.title_fr, category.mastery.mastery_band, normalized, band);
        const subcategories = category.subcategories.flatMap((subcategory) => {
          const subSelf = nodeMatches(subcategory.display_title, subcategory.title_fr, subcategory.mastery.mastery_band, normalized, band);
          const lessons = subcategory.lessons.filter((lesson) => nodeMatches(lesson.title_fr, lesson.title_fr, lesson.mastery.mastery_band, normalized, band));
          if (!subSelf && !lessons.length && !categorySelf) return [];
          return [{...subcategory, lessons: subSelf || categorySelf ? subcategory.lessons : lessons}];
        });
        if (!categorySelf && !subcategories.length) return [];
        return [{...category, subcategories: categorySelf ? category.subcategories : subcategories}];
      });
  }, [categories, categoryId, query, band]);

  const filteredDefaultSelection = useMemo<Selection | null>(() => chooseDefaultSelection(filteredCategories), [filteredCategories]);
  const selectionIsVisible = selection ? Boolean(findSelected(filteredCategories, selection, isFa)) : false;
  const activeSelection = filteredCategories.length
    ? (selectionIsVisible ? selection : (filteredDefaultSelection ?? defaultSelection))
    : null;
  const selected = useMemo(() => findSelected(categories, activeSelection, isFa), [categories, activeSelection, isFa]);

  if (loading && !data) return <LoadingCard label={isFa ? "بارگذاری نقشه تسلط" : "Loading mastery map"} />;
  if (!data) {
    return (
      <StatusPanel
        title={error?.status === 401 ? (isFa ? "ابتدا وارد شوید" : "Please log in") : (error?.message ?? (isFa ? "نقشه تسلط در دسترس نیست" : "Mastery map unavailable"))}
        tone="danger"
        requestId={error?.requestId}
        action={error?.status === 401
          ? {label: isFa ? "ورود" : "Log in", href: `/${locale}/login`}
          : {label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}
      >
        <p>{error?.code}</p>
      </StatusPanel>
    );
  }

  const {summary, semantics} = data.envelope.data;
  const number = new Intl.NumberFormat(isFa ? "fa-IR" : "en-CA", {maximumFractionDigits: 0});

  return (
    <div className={styles.page} dir={isFa ? "rtl" : "ltr"}>
      {error ? (
        <StatusPanel title={isFa ? "نمای ذخیره‌شده نمایش داده می‌شود" : "Showing the last safe snapshot"} tone="warning" requestId={error.requestId} action={{label: isFa ? "تلاش دوباره" : "Retry", onClick: load}}>
          <p>{new Date(data.savedAt).toLocaleString(isFa ? "fa-IR" : "en-CA")}</p>
        </StatusPanel>
      ) : null}

      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Grammar Mastery</p>
          <h1>{isFa ? "نقشه تسلط گرامر" : "Grammar Mastery Map"}</h1>
          <p>{isFa ? "تصویر سلسله‌مراتبی تسلط شما از Category تا Subcategory و Lesson، بر پایه شواهد واقعی یادگیری." : "A hierarchical view of your mastery from Category to Subcategory to Lesson, grounded in persisted learning evidence."}</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.quietLink} href={`/${locale}/progress`}>{isFa ? "مشاهده روند پیشرفت" : "View progress"}</Link>
          <Link className="button button-primary" href={`/${locale}/tests/new`}>{isFa ? "تمرین جدید" : "New practice"}</Link>
        </div>
      </header>

      <section className={styles.summaryGrid} aria-label={isFa ? "خلاصه نقشه تسلط" : "Mastery map summary"}>
        <SummaryCard icon="◎" label={isFa ? "تسلط کلی" : "Overall mastery"} value={summary.overall_mastery_pct === null ? "—" : `${number.format(summary.overall_mastery_pct)}%`} note={bandLabel(summary.mastery.mastery_band, isFa)} band={summary.mastery.mastery_band} ringValue={summary.overall_mastery_pct} />
        <SummaryCard icon="◫" label={isFa ? "پوشش یادگیری" : "Learning coverage"} value={`${number.format(summary.coverage_pct)}%`} note={isFa ? "شواهد ثبت‌شده در ساختار" : "Evidence coverage across the map"} ringValue={summary.coverage_pct} />
        <SummaryCard icon="◇" label={isFa ? "دسته‌ها" : "Categories"} value={number.format(summary.category_count)} note={isFa ? "ساختار سطح اول Taxonomy" : "Top-level taxonomy nodes"} />
        <SummaryCard icon="⌘" label={isFa ? "زیر‌دسته‌ها" : "Subcategories"} value={number.format(summary.subcategory_count)} note={isFa ? `${number.format(summary.lesson_count)} درس در نقشه` : `${number.format(summary.lesson_count)} lessons in the map`} />
      </section>

      <section className={styles.controlBar} aria-label={isFa ? "فیلترهای نقشه" : "Map filters"}>
        <label className={styles.searchField}>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isFa ? "جست‌وجوی Category، Subcategory یا Lesson…" : "Search category, subcategory or lesson…"}
            aria-label={isFa ? "جست‌وجوی نقشه" : "Search mastery map"}
          />
        </label>
        <label className={styles.selectField}>
          <span>{isFa ? "وضعیت" : "Status"}</span>
          <select value={band} onChange={(event) => setBand(event.target.value as MasteryBand | "ALL")}>
            <option value="ALL">{isFa ? "همه وضعیت‌ها" : "All statuses"}</option>
            {BAND_ORDER.map((value) => <option key={value} value={value}>{bandLabel(value, isFa)}</option>)}
          </select>
        </label>
        <label className={styles.selectField}>
          <span>{isFa ? "دسته" : "Category"}</span>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="ALL">{isFa ? "همه دسته‌ها" : "All categories"}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.display_title}</option>)}
          </select>
        </label>
        {(query || band !== "ALL" || categoryId !== "ALL") ? (
          <button className={styles.clearButton} type="button" onClick={() => {setQuery(""); setBand("ALL"); setCategoryId("ALL");}}>
            {isFa ? "پاک‌کردن فیلترها" : "Clear filters"}
          </button>
        ) : <span className={styles.controlHint}>{isFa ? "برای بررسی جزئیات روی هر گره کلیک کنید." : "Select any node to inspect its evidence."}</span>}
      </section>

      <div className={styles.workspace}>
        <main className={styles.mapPanel}>
          <div className={styles.panelHeading}>
            <div>
              <h2>Taxonomy Mastery Map</h2>
              <p dir="ltr">Category → Subcategory → Lesson</p>
            </div>
            <div className={styles.legend} aria-label={isFa ? "راهنمای وضعیت تسلط" : "Mastery status legend"}>
              {BAND_ORDER.map((value) => (
                <span key={value} className={bandClass(value)}><i aria-hidden="true">{bandIcon(value)}</i>{bandLabel(value, isFa)}</span>
              ))}
            </div>
          </div>

          {filteredCategories.length ? (
            <div className={styles.hierarchy}>
              {filteredCategories.map((category, index) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  locale={locale}
                  selected={activeSelection}
                  last={index === filteredCategories.length - 1}
                  onSelect={setSelection}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              kind="search"
              locale={locale}
              compact
              className={styles.mapEmpty}
              title={isFa ? "نتیجه‌ای با این فیلترها پیدا نشد" : "No map nodes match these filters"}
              description={isFa ? "فیلترها را پاک کنید یا عبارت دیگری جست‌وجو کنید." : "Clear the filters or try a different search."}
              action={{type: "button", onClick: () => {setQuery(""); setBand("ALL"); setCategoryId("ALL");}}}
            />
          )}
        </main>

        <aside className={styles.inspector} aria-label={isFa ? "جزئیات بخش انتخاب‌شده" : "Selected node details"}>
          {selected ? <Inspector selected={selected} locale={locale} semantics={semantics} onSelect={setSelection} /> : (
            <div className={styles.inspectorEmpty}>{isFa ? "برای دیدن جزئیات یک بخش از نقشه را انتخاب کنید." : "Select a map node to inspect its details."}</div>
          )}
        </aside>
      </div>

      <footer className={styles.semanticNote}>
        <span aria-hidden="true">i</span>
        <p>{isFa
          ? `این صفحه برچسب‌های رسمی Mastery را با آستانه اطمینان ${Math.round(semantics.confidence_gate * 100)}٪ نمایش می‌دهد. Subcategory و Overall فقط برای نمایش از همان قواعد Stage 15 تجمیع شده‌اند و state مستقل نمی‌سازند.`
          : `This page uses the canonical mastery bands with a ${Math.round(semantics.confidence_gate * 100)}% confidence gate. Subcategory and Overall values are display-only Stage 15 aggregates and do not create parallel mastery state.`}</p>
      </footer>
    </div>
  );
}

function CategoryRow({category, locale, selected, last, onSelect}: {category: Category; locale: Locale; selected: Selection | null; last: boolean; onSelect: (selection: Selection) => void}) {
  const isFa = locale === "fa";
  return (
    <section className={`${styles.categoryRow}${last ? ` ${styles.categoryRowLast}` : ""}`}>
      <div className={styles.connector} aria-hidden="true"><span className={bandClass(category.mastery.mastery_band)}>{bandIcon(category.mastery.mastery_band)}</span></div>
      <button
        type="button"
        className={`${styles.categoryCard}${selected?.kind === "category" && selected.id === category.id ? ` ${styles.nodeSelected}` : ""}`}
        onClick={() => onSelect({kind: "category", id: category.id})}
      >
        <span className={styles.nodeCode}>{category.code}</span>
        <strong dir="ltr" lang="fr">{category.title_fr}</strong>
        {isFa && category.title_fa ? <small>{category.title_fa}</small> : null}
        <MasteryLine mastery={category.mastery} locale={locale} />
      </button>
      <div className={styles.subcategoryCluster}>
        {category.subcategories.map((subcategory) => {
          const subSelected = selected?.kind === "subcategory" && selected.id === subcategory.id;
          const selectedLesson = selected?.kind === "lesson" ? subcategory.lessons.find((lesson) => lesson.id === selected.id) : undefined;
          const expanded = subSelected || Boolean(selectedLesson);
          return (
            <div className={styles.subcategoryBranch} key={subcategory.id}>
              <button
                type="button"
                className={`${styles.subcategoryCard}${subSelected ? ` ${styles.nodeSelected}` : ""}`}
                onClick={() => onSelect({kind: "subcategory", id: subcategory.id})}
              >
                <span className={`${styles.bandDot} ${bandClass(subcategory.mastery.mastery_band)}`} aria-hidden="true">{bandIcon(subcategory.mastery.mastery_band)}</span>
                <span className={styles.subcategoryCopy}>
                  <strong dir="ltr" lang="fr">{subcategory.title_fr}</strong>
                  {isFa && subcategory.title_fa ? <small>{subcategory.title_fa}</small> : null}
                </span>
                <b>{Math.round(subcategory.mastery.mastery_score_pct)}%</b>
              </button>
              {expanded ? (
                <div className={styles.lessonPills}>
                  {subcategory.lessons.map((lesson) => (
                    <button
                      type="button"
                      key={lesson.id}
                      className={`${styles.lessonPill} ${bandClass(lesson.mastery.mastery_band)}${selected?.kind === "lesson" && selected.id === lesson.id ? ` ${styles.lessonSelected}` : ""}`}
                      onClick={() => onSelect({kind: "lesson", id: lesson.id})}
                      title={lesson.title_fr}
                    >
                      <span>L{String(lesson.lesson_no).padStart(2, "0")}</span>
                      <strong dir="ltr" lang="fr">{lesson.title_fr}</strong>
                      <b>{lesson.mastery.evidence_count ? `${Math.round(lesson.mastery.mastery_score_pct)}%` : "—"}</b>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Inspector({selected, locale, semantics, onSelect}: {selected: SelectedNode; locale: Locale; semantics: MasteryMapEnvelope["data"]["semantics"]; onSelect: (selection: Selection) => void}) {
  const isFa = locale === "fa";
  const mastery = selected.mastery;
  const score = mastery.evidence_count ? Math.round(mastery.mastery_score_pct) : null;
  const confidence = Math.round(mastery.confidence * 100);
  const coverage = Math.round(mastery.coverage_ratio * 100);
  const lesson = selected.kind === "lesson" ? selected.lesson : null;
  const breakdown = selected.kind === "lesson"
    ? selected.lesson.subtopics.map((item) => ({id: item.id, title: item.title_fr, mastery: item.mastery, kind: "subtopic" as const}))
    : selected.kind === "subcategory"
      ? selected.subcategory.lessons.map((item) => ({id: item.id, title: item.title_fr, mastery: item.mastery, kind: "lesson" as const}))
      : selected.category.subcategories.map((item) => ({id: item.id, title: item.title_fr, mastery: item.mastery, kind: "subcategory" as const}));

  const detailHref = lesson ? `/${locale}/lessons/${lesson.id}` : `/${locale}/lessons`;
  const kindLabel = selected.kind === "lesson" ? (isFa ? "درس" : "Lesson") : selected.kind === "subcategory" ? (isFa ? "زیر‌دسته" : "Subcategory") : (isFa ? "دسته" : "Category");

  return (
    <div className={styles.inspectorInner}>
      <div className={styles.inspectorHeading}>
        <div>
          <span>{isFa ? "جزئیات بخش انتخاب‌شده" : "Selected node"}</span>
          <small>{kindLabel}</small>
        </div>
        <span className={`${styles.inspectorBand} ${bandClass(mastery.mastery_band)}`}>{bandIcon(mastery.mastery_band)} {bandLabel(mastery.mastery_band, isFa)}</span>
      </div>

      <div className={styles.selectedCard}>
        <p>{selected.subtitle}</p>
        <h2 dir="ltr" lang="fr">{selected.title}</h2>
        <div className={styles.scoreArea}>
          <MasteryRing value={score} band={mastery.mastery_band} />
          <dl>
            <div><dt>{isFa ? "اطمینان" : "Confidence"}</dt><dd>{mastery.evidence_count ? `${confidence}%` : "—"}</dd></div>
            <div><dt>{isFa ? "پوشش" : "Coverage"}</dt><dd>{coverage}%</dd></div>
            <div><dt>{isFa ? "شواهد" : "Evidence"}</dt><dd>{mastery.evidence_count}</dd></div>
          </dl>
        </div>
        {mastery.derived_for_ui ? <p className={styles.derivedBadge}>{isFa ? "تجمیع نمایشی — state مستقل Mastery نیست" : "Display-only aggregate — not parallel mastery state"}</p> : null}
      </div>

      <section className={styles.breakdown}>
        <div className={styles.sectionTitle}>
          <h3>{selected.kind === "lesson" ? (isFa ? "ریزموضوع‌ها" : "Subtopic breakdown") : selected.kind === "subcategory" ? (isFa ? "درس‌های این زیر‌دسته" : "Lessons in this subcategory") : (isFa ? "زیر‌دسته‌های این دسته" : "Subcategories")}</h3>
          <span>{breakdown.length}</span>
        </div>
        {breakdown.length ? breakdown.map((item) => (
          <div className={styles.breakdownRow} key={item.id}>
            <span className={`${styles.bandDot} ${bandClass(item.mastery.mastery_band)}`} aria-hidden="true">{bandIcon(item.mastery.mastery_band)}</span>
            <span className={styles.breakdownLabel} dir="ltr" lang="fr">{item.title}</span>
            <div className={styles.breakdownBar}><span className={bandClass(item.mastery.mastery_band)} style={{inlineSize: `${item.mastery.evidence_count ? Math.max(3, item.mastery.mastery_score_pct) : 0}%`}} /></div>
            <strong>{item.mastery.evidence_count ? `${Math.round(item.mastery.mastery_score_pct)}%` : "—"}</strong>
            {item.kind === "lesson" ? <button type="button" className={styles.rowAction} onClick={() => onSelect({kind: "lesson", id: item.id})} aria-label={isFa ? "باز کردن درس در پنل" : "Inspect lesson"}>›</button> : item.kind === "subcategory" ? <button type="button" className={styles.rowAction} onClick={() => onSelect({kind: "subcategory", id: item.id})} aria-label={isFa ? "باز کردن زیر‌دسته در پنل" : "Inspect subcategory"}>›</button> : null}
          </div>
        )) : <p className={styles.inspectorMuted}>{isFa ? "برای این بخش زیرمجموعه‌ای ثبت نشده است." : "No child nodes are registered for this section."}</p>}
      </section>

      {lesson ? (
        <section className={styles.misconceptionSection}>
          <div className={styles.sectionTitle}><h3>{isFa ? "خطای مفهومی برجسته" : "Misconception highlight"}</h3>{lesson.unresolved_review_count ? <span>{lesson.unresolved_review_count}</span> : null}</div>
          {lesson.top_misconception ? (
            <div className={styles.misconceptionCard}>
              <span aria-hidden="true">!</span>
              <div>
                <strong>{isFa ? (lesson.top_misconception.name_fa || lesson.top_misconception.family) : humanize(lesson.top_misconception.family)}</strong>
                <p>{isFa ? lesson.top_misconception.statement_fa : `This unresolved pattern is recorded ${lesson.top_misconception.repeat_count} time(s) in the learner error history.`}</p>
                <small>{isFa ? `تکرار ثبت‌شده: ${lesson.top_misconception.repeat_count}` : `${lesson.top_misconception.repeat_count} unresolved occurrence(s)`}</small>
              </div>
            </div>
          ) : (
            <div className={styles.noMisconception}><span aria-hidden="true">✓</span><p>{isFa ? "برای این درس misconception حل‌نشده‌ای در داده فعلی ثبت نشده است." : "No unresolved misconception is recorded for this lesson in the current data."}</p></div>
          )}
        </section>
      ) : null}

      <div className={styles.inspectorActions}>
        <Link className="button button-primary" href={`/${locale}/tests/new`}>{isFa ? "تمرین این بخش" : "Practice this section"}</Link>
        <Link className={styles.secondaryAction} href={detailHref}>{lesson ? (isFa ? "جزئیات درس" : "Lesson details") : (isFa ? "مشاهده درس‌ها" : "Browse lessons")}</Link>
        {lesson?.unresolved_review_count ? <Link className={styles.reviewAction} href={`/${locale}/review`}>{isFa ? "مرور خطاهای مرتبط" : "Review related errors"}</Link> : null}
      </div>

      <p className={styles.inspectorFootnote}>{isFa
        ? `Strong از ${Math.round(semantics.strong_at_or_above)}٪ و Weak زیر ${Math.round(semantics.weak_below)}٪ است؛ برچسب قطعی فقط پس از عبور confidence از ${Math.round(semantics.confidence_gate * 100)}٪ داده می‌شود.`
        : `Strong begins at ${Math.round(semantics.strong_at_or_above)}%; Weak is below ${Math.round(semantics.weak_below)}%. A confident band requires at least ${Math.round(semantics.confidence_gate * 100)}% confidence.`}</p>
    </div>
  );
}

function SummaryCard({icon, label, value, note, band, ringValue}: {icon: string; label: string; value: string; note: string; band?: MasteryBand; ringValue?: number | null}) {
  return (
    <article className={styles.summaryCard}>
      <span className={`${styles.summaryIcon}${band ? ` ${bandClass(band)}` : ""}`} aria-hidden="true">{icon}</span>
      <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
      {ringValue !== undefined ? <MiniRing value={ringValue ?? 0} band={band} /> : null}
    </article>
  );
}

function MiniRing({value, band}: {value: number; band?: MasteryBand}) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <svg className={`${styles.miniRing}${band ? ` ${bandClass(band)}` : ""}`} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" pathLength="100" />
      <circle cx="22" cy="22" r="18" pathLength="100" strokeDasharray={`${safe} ${100 - safe}`} />
    </svg>
  );
}

function MasteryRing({value, band}: {value: number | null; band: MasteryBand}) {
  const safe = value ?? 0;
  return (
    <div className={`${styles.masteryRing} ${bandClass(band)}`} style={{"--ring-angle": `${safe * 3.6}deg`} as CSSProperties}>
      <div><strong>{value === null ? "—" : `${value}%`}</strong><small>Mastery</small></div>
    </div>
  );
}

function MasteryLine({mastery, locale}: {mastery: Mastery; locale: Locale}) {
  const isFa = locale === "fa";
  return (
    <div className={styles.masteryLine}>
      <span className={bandClass(mastery.mastery_band)}><i style={{inlineSize: `${mastery.evidence_count ? Math.max(3, mastery.mastery_score_pct) : 0}%`}} /></span>
      <b>{mastery.evidence_count ? `${Math.round(mastery.mastery_score_pct)}%` : "—"}</b>
      <small>{bandLabel(mastery.mastery_band, isFa)}</small>
    </div>
  );
}

function chooseDefaultSelection(categories: Category[]): Selection | null {
  const lessons = categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.lessons));
  const withEvidence = lessons.filter((lesson) => lesson.mastery.evidence_count > 0);
  const weakest = [...withEvidence].sort((a, b) => {
    if (a.mastery.mastery_score_pct !== b.mastery.mastery_score_pct) return a.mastery.mastery_score_pct - b.mastery.mastery_score_pct;
    if (a.mastery.confidence !== b.mastery.confidence) return b.mastery.confidence - a.mastery.confidence;
    return a.lesson_no - b.lesson_no;
  })[0];
  const firstLesson = weakest ?? lessons[0];
  if (firstLesson) return {kind: "lesson", id: firstLesson.id};
  const firstSubcategory = categories[0]?.subcategories[0];
  if (firstSubcategory) return {kind: "subcategory", id: firstSubcategory.id};
  const firstCategory = categories[0];
  return firstCategory ? {kind: "category", id: firstCategory.id} : null;
}

function findSelected(categories: Category[], selection: Selection | null, isFa: boolean): SelectedNode | null {
  if (!selection) return null;
  for (const category of categories) {
    if (selection.kind === "category" && category.id === selection.id) {
      return {kind: "category", category, mastery: category.mastery, title: category.title_fr, subtitle: isFa ? (category.title_fa || "Category") : "Category"};
    }
    for (const subcategory of category.subcategories) {
      if (selection.kind === "subcategory" && subcategory.id === selection.id) {
        return {kind: "subcategory", category, subcategory, mastery: subcategory.mastery, title: subcategory.title_fr, subtitle: `${category.title_fr} · ${isFa ? (subcategory.title_fa || "Subcategory") : "Subcategory"}`};
      }
      for (const lesson of subcategory.lessons) {
        if (selection.kind === "lesson" && lesson.id === selection.id) {
          return {kind: "lesson", category, subcategory, lesson, mastery: lesson.mastery, title: lesson.title_fr, subtitle: `L${String(lesson.lesson_no).padStart(2, "0")} · ${subcategory.title_fr}`};
        }
      }
    }
  }
  return null;
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase().normalize("NFKC");
}

function nodeMatches(display: string, french: string, nodeBand: MasteryBand, query: string, band: MasteryBand | "ALL"): boolean {
  if (band !== "ALL" && nodeBand !== band) return false;
  if (!query) return true;
  return `${display} ${french}`.toLocaleLowerCase().normalize("NFKC").includes(query);
}

function bandClass(band: MasteryBand): string {
  return {
    STRONG: styles.bandStrong,
    DEVELOPING: styles.bandDeveloping,
    WEAK: styles.bandWeak,
    UNCERTAIN: styles.bandUncertain,
    NO_EVIDENCE: styles.bandNoEvidence,
  }[band];
}

function bandIcon(band: MasteryBand): string {
  return {STRONG: "✓", DEVELOPING: "↗", WEAK: "!", UNCERTAIN: "?", NO_EVIDENCE: "○"}[band];
}

function bandLabel(band: MasteryBand, isFa: boolean): string {
  const labels = {
    STRONG: ["قوی", "Strong"],
    DEVELOPING: ["در حال توسعه", "Developing"],
    WEAK: ["ضعیف", "Weak"],
    UNCERTAIN: ["نامطمئن", "Uncertain"],
    NO_EVIDENCE: ["بدون شواهد", "No evidence"],
  } satisfies Record<MasteryBand, [string, string]>;
  return labels[band][isFa ? 0 : 1];
}

function humanize(value: string): string {
  return value.toLocaleLowerCase().split("_").map((part) => part ? part[0].toLocaleUpperCase() + part.slice(1) : part).join(" ");
}

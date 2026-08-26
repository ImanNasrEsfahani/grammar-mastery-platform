"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useCallback, useEffect, useMemo, useState} from "react";
import type {FormEvent} from "react";
import {EmptyState} from "@/components/ui/EmptyState";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {Locale} from "@/lib/i18n";
import styles from "./GrammarSearchClient.module.css";

export type SearchKind = "ALL" | "LESSON" | "SUBTOPIC" | "RULE" | "CATEGORY";
type MasteryBand = "NO_EVIDENCE" | "UNCERTAIN" | "WEAK" | "DEVELOPING" | "STRONG";

type SearchMastery = {
  score_pct: number | null;
  confidence: number;
  evidence_count: number;
  band: MasteryBand;
};

type SearchMisconception = {
  id: string;
  name_fa: string | null;
  statement_fa: string;
  repeat_count: number;
};

type SearchResult = {
  key: string;
  kind: Exclude<SearchKind, "ALL">;
  id: string;
  title_fr: string;
  title_fa: string | null;
  code: string;
  slug?: string;
  lesson_id: string | null;
  lesson_no: number | null;
  lesson_title_fr: string | null;
  subtopic_id: string | null;
  subtopic_code: string | null;
  category_id: string;
  category_title_fr: string;
  category_title_fa: string | null;
  subcategory_id: string | null;
  subcategory_title_fr: string | null;
  subcategory_title_fa: string | null;
  snippet_fa: string | null;
  snippet_fr: string | null;
  practice_lesson_ids: string[];
  mastery: SearchMastery;
  common_misconception: SearchMisconception | null;
  projection?: "CANONICAL_SUBTOPIC_RULE_TEXT";
};

type SearchEnvelope = {
  data: {
    query: string;
    kind: SearchKind;
    locale: "fa" | "en";
    total_count: number;
    counts: Record<Exclude<SearchKind, "ALL">, number>;
    results: SearchResult[];
    as_of: string;
    runtime_version: string;
  };
  meta: {request_id: string; api_version: string};
};

type Copy = {
  title: string;
  subtitle: string;
  placeholder: string;
  submit: string;
  recent: string;
  noRecent: string;
  resultsFor: string;
  resultUnit: string;
  selected: string;
  shortRule: string;
  misconception: string;
  yourStatus: string;
  mastery: string;
  confidence: string;
  evidence: string;
  practice: string;
  open: string;
  openLesson: string;
  clear: string;
  idleTitle: string;
  idleBody: string;
};

const KINDS: SearchKind[] = ["ALL", "LESSON", "SUBTOPIC", "RULE", "CATEGORY"];
const RECENT_KEY = "gmp-grammar-search-recent-v1";
const MAX_RECENT = 6;

const KIND_LABELS: Record<SearchKind, {fa: string; en: string}> = {
  ALL: {fa: "همه", en: "All"},
  LESSON: {fa: "درس", en: "Lesson"},
  SUBTOPIC: {fa: "زیرموضوع", en: "Subtopic"},
  RULE: {fa: "قاعده", en: "Rule"},
  CATEGORY: {fa: "دسته", en: "Category"},
};

const BAND_COPY: Record<MasteryBand, {fa: string; en: string; icon: string}> = {
  STRONG: {fa: "مسلط", en: "Strong", icon: "✓"},
  DEVELOPING: {fa: "در حال یادگیری", en: "Developing", icon: "↗"},
  WEAK: {fa: "نیازمند تمرین", en: "Needs practice", icon: "!"},
  UNCERTAIN: {fa: "شواهد ناکافی", en: "Uncertain", icon: "?"},
  NO_EVIDENCE: {fa: "شروع‌نشده", en: "Not started", icon: "○"},
};

function copyFor(isFa: boolean): Copy {
  return isFa
    ? {
        title: "جستجوی گرامر",
        subtitle: "درس، زیرموضوع، قاعده یا دسته‌ی گرامری را سریع پیدا کنید.",
        placeholder: "مثلاً dont، subjonctif یا prépositions",
        submit: "جستجو",
        recent: "جستجوهای اخیر:",
        noRecent: "هنوز جستجوی اخیری ندارید.",
        resultsFor: "نتایج برای",
        resultUnit: "نتیجه در درس‌ها، زیرموضوع‌ها، قواعد و دسته‌ها",
        selected: "نتیجه انتخاب‌شده",
        shortRule: "قاعده / توضیح کوتاه",
        misconception: "Misconception رایج شما",
        yourStatus: "وضعیت شما",
        mastery: "تسلط",
        confidence: "اعتماد",
        evidence: "شواهد",
        practice: "تمرین",
        open: "باز کردن",
        openLesson: "باز کردن درس",
        clear: "پاک کردن جستجو",
        idleTitle: "یک مفهوم گرامری را جستجو کنید",
        idleBody: "جستجو روی داده‌های واقعی درس، زیرموضوع، قاعده و دسته انجام می‌شود و نتیجه‌های مرتبط با Mastery شما را نشان می‌دهد.",
      }
    : {
        title: "Grammar Search",
        subtitle: "Find a lesson, subtopic, grammar rule, or category quickly.",
        placeholder: "Try dont, subjonctif, or prépositions",
        submit: "Search",
        recent: "Recent searches:",
        noRecent: "No recent searches yet.",
        resultsFor: "Results for",
        resultUnit: "results across lessons, subtopics, rules, and categories",
        selected: "Selected result",
        shortRule: "Short rule / context",
        misconception: "Your common misconception",
        yourStatus: "Your status",
        mastery: "Mastery",
        confidence: "Confidence",
        evidence: "Evidence",
        practice: "Practice",
        open: "Open",
        openLesson: "Open lesson",
        clear: "Clear search",
        idleTitle: "Search for a grammar concept",
        idleBody: "Search runs over canonical lesson, subtopic, rule-text, and category data, then overlays your persisted mastery evidence.",
      };
}

function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function persistRecentSearches(items: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  } catch {
    // Recent search history is a progressive enhancement only.
  }
}

function bandClass(band: MasteryBand) {
  if (band === "STRONG") return styles.strong;
  if (band === "DEVELOPING") return styles.developing;
  if (band === "WEAK") return styles.weak;
  if (band === "UNCERTAIN") return styles.uncertain;
  return styles.noEvidence;
}

function kindClass(kind: Exclude<SearchKind, "ALL">) {
  if (kind === "LESSON") return styles.kindLesson;
  if (kind === "SUBTOPIC") return styles.kindSubtopic;
  if (kind === "RULE") return styles.kindRule;
  return styles.kindCategory;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({text, query}: {text: string; query: string}) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;
  const pattern = new RegExp(`(${escapeRegExp(trimmed)})`, "ig");
  const pieces = text.split(pattern);
  const exact = new RegExp(`^${escapeRegExp(trimmed)}$`, "i");
  return <>{pieces.map((piece, index) => exact.test(piece) ? <mark key={`${piece}:${index}`}>{piece}</mark> : <span key={`${piece}:${index}`}>{piece}</span>)}</>;
}

function looksPersian(value: string) {
  return /[\u0600-\u06ff]/.test(value);
}

function resultTitle(result: SearchResult, isFa: boolean) {
  if (result.kind === "CATEGORY" && isFa && result.title_fa) return result.title_fa;
  return result.title_fr;
}

function resultSnippet(result: SearchResult, isFa: boolean) {
  if (isFa) return result.snippet_fa ?? result.snippet_fr;
  return result.snippet_fr ?? result.snippet_fa;
}

function breadcrumb(result: SearchResult, isFa: boolean) {
  const category = (isFa ? result.category_title_fa : result.category_title_fr) || result.category_title_fr;
  const subcategory = (isFa ? result.subcategory_title_fa : result.subcategory_title_fr) || result.subcategory_title_fr;
  const pieces = [category, subcategory, result.lesson_title_fr].filter(Boolean) as string[];
  return pieces.join(" → ");
}

function openHref(result: SearchResult, locale: Locale) {
  return result.lesson_id ? `/${locale}/lessons/${result.lesson_id}` : `/${locale}/lessons`;
}

function practiceHref(result: SearchResult, locale: Locale) {
  const params = new URLSearchParams({mode: "custom", scope: "lessons"});
  if (result.practice_lesson_ids.length === 1) params.set("lesson", result.practice_lesson_ids[0]!);
  else if (result.practice_lesson_ids.length > 1) params.set("lessons", result.practice_lesson_ids.join(","));
  return `/${locale}/tests/new?${params.toString()}`;
}

export function GrammarSearchClient({
  locale,
  initialQuery = "",
  initialKind = "ALL",
}: {
  locale: Locale;
  initialQuery?: string;
  initialKind?: SearchKind;
}) {
  const isFa = locale === "fa";
  const copy = copyFor(isFa);
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<SearchKind>(initialKind);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [data, setData] = useState<SearchEnvelope | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(initialQuery));
  const [error, setError] = useState<ApiError | null>(null);

  const rememberQuery = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setRecent((current) => {
      const next = [normalized, ...current.filter((item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase())].slice(0, MAX_RECENT);
      persistRecentSearches(next);
      return next;
    });
  }, []);

  const execute = useCallback(async (rawQuery: string, nextKind: SearchKind, updateUrl = true) => {
    const cleaned = rawQuery.trim().replace(/\s+/g, " ").slice(0, 120);
    setQuery(cleaned);
    setSubmittedQuery(cleaned);
    setKind(nextKind);
    setError(null);
    if (!cleaned) {
      setData(null);
      setSelectedKey(null);
      setLoading(false);
      if (updateUrl) router.replace(`/${locale}/search`, {scroll: false});
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({q: cleaned, kind: nextKind, locale, limit: "40"});
      const response = await apiRequest<SearchEnvelope>(`/api/backend/search?${params.toString()}`);
      if (!response) throw new ApiError({status: 502, code: "EMPTY_SEARCH", message: "Search data was empty."});
      setData(response);
      setSelectedKey(response.data.results[0]?.key ?? null);
      rememberQuery(cleaned);
      if (updateUrl) {
        const visible = new URLSearchParams({q: cleaned});
        if (nextKind !== "ALL") visible.set("kind", nextKind);
        router.replace(`/${locale}/search?${visible.toString()}`, {scroll: false});
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Search failed."}));
      setData(null);
      setSelectedKey(null);
    } finally {
      setLoading(false);
    }
  }, [locale, rememberQuery, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(readRecentSearches());
    if (initialQuery) void execute(initialQuery, initialKind, false);
  }, [execute, initialKind, initialQuery]);

  const results = useMemo(() => data?.data.results ?? [], [data]);
  const selected = useMemo(
    () => results.find((item) => item.key === selectedKey) ?? results[0] ?? null,
    [results, selectedKey],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void execute(query, kind);
  }

  function chooseKind(nextKind: SearchKind) {
    setKind(nextKind);
    if (submittedQuery) void execute(submittedQuery, nextKind);
  }

  function runRecent(value: string) {
    setQuery(value);
    void execute(value, kind);
  }

  function clearSearch() {
    setQuery("");
    setSubmittedQuery("");
    setKind("ALL");
    setData(null);
    setSelectedKey(null);
    setError(null);
    router.replace(`/${locale}/search`, {scroll: false});
  }

  const number = useMemo(() => new Intl.NumberFormat(isFa ? "fa-IR" : "en-CA"), [isFa]);

  return (
    <div className={styles.page} dir={isFa ? "rtl" : "ltr"}>
      <header className={styles.heading}>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </header>

      <form className={styles.searchShell} onSubmit={submit} role="search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.placeholder}
          aria-label={copy.title}
          dir="ltr"
          autoComplete="off"
          maxLength={120}
        />
        <span className={styles.searchIcon} aria-hidden="true">⌕</span>
        <button type="submit" disabled={loading}>{loading ? "…" : copy.submit}</button>
      </form>

      <section className={styles.toolbar} aria-label={isFa ? "فیلترها و جستجوهای اخیر" : "Filters and recent searches"}>
        <div className={styles.recentSearches}>
          <strong>{copy.recent}</strong>
          {recent.length ? recent.slice(0, 3).map((item) => (
            <button key={item} type="button" onClick={() => runRecent(item)} dir="ltr">{item}</button>
          )) : <span className={styles.noRecent}>{copy.noRecent}</span>}
        </div>
        <div className={styles.filters}>
          {KINDS.map((item) => {
            const count = item === "ALL"
              ? data?.data.total_count
              : data?.data.counts[item as Exclude<SearchKind, "ALL">];
            return (
              <button
                key={item}
                type="button"
                className={kind === item ? styles.filterActive : ""}
                aria-pressed={kind === item}
                onClick={() => chooseKind(item)}
              >
                {isFa ? KIND_LABELS[item].fa : KIND_LABELS[item].en}
                {submittedQuery && typeof count === "number" ? <small>{number.format(count)}</small> : null}
              </button>
            );
          })}
        </div>
      </section>

      {error ? (
        <StatusPanel
          title={error.status === 401 ? (isFa ? "برای جستجوی شخصی‌سازی‌شده وارد شوید" : "Log in for personalized search") : (isFa ? "جستجو در دسترس نیست" : "Search is unavailable")}
          tone="danger"
          requestId={error.requestId}
          action={error.status === 401
            ? {label: isFa ? "ورود" : "Log in", href: `/${locale}/login`}
            : {label: isFa ? "تلاش دوباره" : "Retry", onClick: () => void execute(submittedQuery, kind, false)}}
        >
          <p>{error.code}</p>
        </StatusPanel>
      ) : null}

      <div className={styles.workspace}>
        <main className={styles.resultsPanel}>
          {loading ? <LoadingCard label={isFa ? "در حال جستجوی گرامر" : "Searching grammar"} /> : submittedQuery && data ? (
            <>
              <div className={styles.resultsHeading}>
                <h2>{copy.resultsFor} <b dir="ltr">«{data.data.query}»</b></h2>
                <p>{number.format(data.data.total_count)} {copy.resultUnit}</p>
              </div>
              {results.length ? (
                <div className={styles.resultList}>
                  {results.map((result) => {
                    const masteryCopy = BAND_COPY[result.mastery.band];
                    const score = result.mastery.score_pct;
                    const snippet = resultSnippet(result, isFa);
                    const title = resultTitle(result, isFa);
                    return (
                      <article key={result.key} className={`${styles.resultCard} ${selected?.key === result.key ? styles.resultSelected : ""}`}>
                        <span className={`${styles.kindBadge} ${kindClass(result.kind)}`}>{isFa ? KIND_LABELS[result.kind].fa : KIND_LABELS[result.kind].en}</span>
                        <button className={styles.resultCopy} type="button" onClick={() => setSelectedKey(result.key)} aria-label={`${copy.selected}: ${title}`}>
                          <strong lang={result.kind === "CATEGORY" && isFa && result.title_fa ? "fa" : "fr"} dir={result.kind === "CATEGORY" && isFa && result.title_fa ? "rtl" : "ltr"}>
                            <Highlight text={title} query={data.data.query} />
                          </strong>
                          {snippet ? <span dir={looksPersian(snippet) ? "rtl" : "ltr"}><Highlight text={snippet} query={data.data.query} /></span> : null}
                        </button>
                        <div className={styles.resultContext}>
                          {result.lesson_no ? <b>{isFa ? `درس ${number.format(result.lesson_no)}` : `Lesson ${number.format(result.lesson_no)}`}</b> : <b>{result.code}</b>}
                          <span dir="ltr">{result.subtopic_code ?? result.code}</span>
                        </div>
                        <div className={styles.resultActions}>
                          <div className={`${styles.masteryInline} ${bandClass(result.mastery.band)}`}>
                            <span>{copy.mastery}</span>
                            <strong>{score === null ? "—" : `${number.format(Math.round(score))}%`}</strong>
                            <small><i aria-hidden="true">{masteryCopy.icon}</i>{isFa ? masteryCopy.fa : masteryCopy.en}</small>
                          </div>
                          <div className={styles.rowButtons}>
                            {result.practice_lesson_ids.length ? <Link href={practiceHref(result, locale)}>{copy.practice}</Link> : null}
                            <Link href={openHref(result, locale)}>{copy.open}</Link>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  kind="search"
                  locale={locale}
                  action={{type: "button", onClick: clearSearch, label: copy.clear}}
                />
              )}
            </>
          ) : (
            <section className={styles.idleState}>
              <div className={styles.idleIcon} aria-hidden="true">⌕</div>
              <h2>{copy.idleTitle}</h2>
              <p>{copy.idleBody}</p>
              {recent.length ? <div>{recent.map((item) => <button key={item} type="button" onClick={() => runRecent(item)} dir="ltr">{item}</button>)}</div> : null}
            </section>
          )}
        </main>

        <aside className={styles.inspector} aria-live="polite">
          <h2>{copy.selected}</h2>
          {selected ? <ResultInspector result={selected} locale={locale} query={data?.data.query ?? ""} copy={copy} /> : (
            <p className={styles.inspectorEmpty}>{isFa ? "برای دیدن جزئیات، یک نتیجه را انتخاب کنید." : "Select a result to inspect its context."}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function ResultInspector({result, locale, query, copy}: {result: SearchResult; locale: Locale; query: string; copy: Copy}) {
  const isFa = locale === "fa";
  const number = new Intl.NumberFormat(isFa ? "fa-IR" : "en-CA");
  const title = resultTitle(result, isFa);
  const snippet = resultSnippet(result, isFa);
  const meta = BAND_COPY[result.mastery.band];
  const score = result.mastery.score_pct;
  const confidence = Math.round((result.mastery.confidence ?? 0) * 100);
  const trail = breadcrumb(result, isFa);

  return (
    <div className={styles.inspectorBody}>
      <section className={styles.selectedHero}>
        <span className={`${styles.kindBadge} ${kindClass(result.kind)}`}>{isFa ? KIND_LABELS[result.kind].fa : KIND_LABELS[result.kind].en}</span>
        <strong lang={result.kind === "CATEGORY" && isFa && result.title_fa ? "fa" : "fr"} dir={result.kind === "CATEGORY" && isFa && result.title_fa ? "rtl" : "ltr"}>
          <Highlight text={title} query={query} />
        </strong>
        <small dir={looksPersian(trail) ? "rtl" : "ltr"}>{trail}</small>
      </section>

      {snippet ? (
        <section className={styles.inspectorSection}>
          <h3>{copy.shortRule}</h3>
          <p dir={looksPersian(snippet) ? "rtl" : "ltr"}><Highlight text={snippet} query={query} /></p>
          {result.kind === "RULE" ? <small>{isFa ? "نمای جستجوی Rule از متن canonical زیرموضوع ساخته شده است." : "Rule search projects canonical subtopic rule text; it is not a separate taxonomy entity."}</small> : null}
        </section>
      ) : null}

      {result.common_misconception ? (
        <section className={styles.misconceptionBox}>
          <span>{copy.misconception}</span>
          <strong dir="rtl">{result.common_misconception.name_fa ?? result.common_misconception.statement_fa}</strong>
          <small>{isFa ? `${number.format(result.common_misconception.repeat_count)} تکرار حل‌نشده` : `${number.format(result.common_misconception.repeat_count)} unresolved occurrence(s)`}</small>
        </section>
      ) : null}

      <section className={styles.inspectorSection}>
        <h3>{copy.yourStatus}</h3>
        <div className={`${styles.masteryStatus} ${bandClass(result.mastery.band)}`}>
          <div>
            <span><i aria-hidden="true">{meta.icon}</i>{isFa ? meta.fa : meta.en}</span>
            <strong>{score === null ? "—" : `${number.format(Math.round(score))}%`}</strong>
          </div>
          <div className={styles.masteryTrack}><span style={{inlineSize: `${score ?? 0}%`}} /></div>
        </div>
        <dl className={styles.evidenceGrid}>
          <div><dt>{copy.confidence}</dt><dd>{number.format(confidence)}%</dd></div>
          <div><dt>{copy.evidence}</dt><dd>{number.format(result.mastery.evidence_count)}</dd></div>
        </dl>
      </section>

      <div className={styles.inspectorActions}>
        {result.practice_lesson_ids.length ? <Link className={styles.primaryAction} href={practiceHref(result, locale)}>{copy.practice}</Link> : null}
        <Link className={styles.secondaryAction} href={openHref(result, locale)}>{result.lesson_id ? copy.openLesson : copy.open}</Link>
      </div>
    </div>
  );
}

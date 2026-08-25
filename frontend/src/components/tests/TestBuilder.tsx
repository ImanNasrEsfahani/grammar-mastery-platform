"use client";

import {useEffect, useMemo, useState} from "react";
import type {CSSProperties, FormEvent} from "react";
import {useRouter} from "next/navigation";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {
  LessonCollectionEnvelope,
  StartedAttemptEnvelope,
  TestCreateRequest,
  TestEnvelope,
} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import {StatusPanel} from "@/components/ui/StatusPanel";
import styles from "./TestBuilder.module.css";

type Lesson = LessonCollectionEnvelope["data"][number];
type ScopeChoice = "all" | "lessons" | "related";
type LessonGroup = {id: string; title: string; category: string; lessons: Lesson[]};
type DifficultyPreset = "all" | "easy" | "medium" | "hard" | "veryHard";
type TypePreset = "mixed" | "cloze" | "sentence" | "grammar" | "application" | "translation";

const MODES = ["adaptive", "tcf", "custom"] as const satisfies readonly TestCreateRequest["mode"][];
type BuilderMode = (typeof MODES)[number];

const DEFAULT_DIFFICULTY_MIX: TestCreateRequest["difficulty_mix_pct"] = {
  EASY: 20,
  MEDIUM: 40,
  HARD: 30,
  VERY_HARD: 10,
};

const DIFFICULTY_MIXES: Record<DifficultyPreset, TestCreateRequest["difficulty_mix_pct"]> = {
  all: DEFAULT_DIFFICULTY_MIX,
  easy: {EASY: 100, MEDIUM: 0, HARD: 0, VERY_HARD: 0},
  medium: {EASY: 0, MEDIUM: 100, HARD: 0, VERY_HARD: 0},
  hard: {EASY: 0, MEDIUM: 0, HARD: 100, VERY_HARD: 0},
  veryHard: {EASY: 0, MEDIUM: 0, HARD: 0, VERY_HARD: 100},
};

const TYPE_PRESETS: Record<Exclude<TypePreset, "mixed">, Record<string, number>> = {
  cloze: {CLOZE_SINGLE: 48, CLOZE_CONTEXT: 52},
  sentence: {CORRECT_SENTENCE: 30, INCORRECT_SENTENCE: 25, ERROR_LOCATION: 15, CONTRAST_RULES: 30},
  grammar: {CONJUGATION: 25, TENSE_CHOICE: 25, PRONOUN_CHOICE: 25, PREPOSITION_CHOICE: 25},
  application: {REWRITE_EQUIV: 35, DIALOGUE_COMPLETE: 30, REGISTER_CHOICE: 15, CONTRAST_RULES: 20},
  translation: {FR_TO_FA: 50, FA_TO_FR: 50},
};

const SESSION_HANDOFF_KEY = "gmp-test-builder-handoff-v1";
const TEMPLATE_KEY = "gmp-test-builder-template-v1";

type BuilderDraft = {
  mode: BuilderMode;
  scopeChoice: ScopeChoice;
  selectedLessonIds: string[];
  selectedGroupId: string;
  count: number;
  difficultyPreset: DifficultyPreset;
  typePreset: TypePreset;
  advancedOpen: boolean;
};

function Icon({name}: {name: "adaptive" | "tcf" | "custom" | "globe" | "lessons" | "selected" | "related" | "summary" | "chevron" | "play" | "bookmark" | "info"}) {
  const common = {width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true};
  if (name === "adaptive") return <svg {...common}><path d="M3 17l5-5 4 4 7-9"/><path d="M14 7h5v5"/></svg>;
  if (name === "tcf") return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h5M8 15h3"/><path d="M15.5 14.5l1 1 2-2"/></svg>;
  if (name === "custom") return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.12 2.12-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V20h-3v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2.12-2.12.06-.06A1.65 1.65 0 0 0 7 15a1.65 1.65 0 0 0-1.51-1H5v-3h.49A1.65 1.65 0 0 0 7 10a1.65 1.65 0 0 0-.33-1.82l-.06-.06L8.73 6l.06.06A1.65 1.65 0 0 0 10.61 6a1.65 1.65 0 0 0 1-1.51V4h3v.49a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.12 2.12-.06.06A1.65 1.65 0 0 0 19.4 10a1.65 1.65 0 0 0 1.51 1H21v3h-.09A1.65 1.65 0 0 0 19.4 15z"/></svg>;
  if (name === "globe") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>;
  if (name === "lessons") return <svg {...common}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>;
  if (name === "selected") return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l2.5 2.5L16 9"/></svg>;
  if (name === "related") return <svg {...common}><circle cx="12" cy="5" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><path d="M10.6 6.5L6.5 15M13.4 6.5l4.1 8.5M7 17h10"/></svg>;
  if (name === "summary") return <svg {...common}><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 9h6M9 13h6M9 17h4"/></svg>;
  if (name === "play") return <svg {...common}><path d="M8 5l11 7-11 7z"/></svg>;
  if (name === "bookmark") return <svg {...common}><path d="M6 4h12v17l-6-4-6 4z"/></svg>;
  if (name === "info") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>;
  return <svg {...common}><path d="M7 10l5 5 5-5"/></svg>;
}

function largestRemainder(total: number, shares: number[]) {
  const expected = shares.map((share) => total * share / 100);
  const out = expected.map(Math.floor);
  let remaining = total - out.reduce((sum, value) => sum + value, 0);
  const ranked = expected
    .map((value, index) => ({index, remainder: value - out[index]}))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const item of ranked) {
    if (!remaining) break;
    out[item.index] += 1;
    remaining -= 1;
  }
  return out;
}

export function TestBuilder({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const router = useRouter();
  const [count, setCount] = useState(20);
  const [mode, setMode] = useState<BuilderMode>("adaptive");
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>("all");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [difficultyPreset, setDifficultyPreset] = useState<DifficultyPreset>("all");
  const [typePreset, setTypePreset] = useState<TypePreset>("mixed");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [lessonsError, setLessonsError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const handoff = params.get("restore") === "1" ? window.sessionStorage.getItem(SESSION_HANDOFF_KEY) : null;
      const template = params.get("template") === "1" ? window.localStorage.getItem(TEMPLATE_KEY) : null;
      const raw = handoff || template;
      if (raw) {
        const saved = JSON.parse(raw) as Partial<BuilderDraft>;
        if (saved.mode && MODES.includes(saved.mode)) setMode(saved.mode);
        if (saved.scopeChoice && ["all", "lessons", "related"].includes(saved.scopeChoice)) setScopeChoice(saved.scopeChoice);
        if (Array.isArray(saved.selectedLessonIds)) setSelectedLessonIds(saved.selectedLessonIds.map(String));
        if (typeof saved.selectedGroupId === "string") setSelectedGroupId(saved.selectedGroupId);
        if (typeof saved.count === "number" && saved.count >= 1 && saved.count <= 100) setCount(saved.count);
        if (saved.difficultyPreset && Object.hasOwn(DIFFICULTY_MIXES, saved.difficultyPreset)) setDifficultyPreset(saved.difficultyPreset);
        if (saved.typePreset && ["mixed", "cloze", "sentence", "grammar", "application", "translation"].includes(saved.typePreset)) setTypePreset(saved.typePreset);
        if (typeof saved.advancedOpen === "boolean") setAdvancedOpen(saved.advancedOpen);
        if (handoff) window.sessionStorage.removeItem(SESSION_HANDOFF_KEY);
        return;
      }

      const requestedMode = params.get("mode");
      if (requestedMode && MODES.includes(requestedMode as BuilderMode)) setMode(requestedMode as BuilderMode);
      const requestedCount = Number(params.get("count"));
      if (Number.isInteger(requestedCount) && requestedCount >= 1 && requestedCount <= 100) setCount(requestedCount);
      const requestedScope = params.get("scope");
      if (requestedScope === "all" || requestedScope === "lessons" || requestedScope === "related") setScopeChoice(requestedScope);
      const lessonIds = [...params.getAll("lesson"), ...(params.get("lessons")?.split(",") ?? [])].filter(Boolean);
      if (lessonIds.length) {
        setSelectedLessonIds([...new Set(lessonIds)]);
        setScopeChoice("lessons");
      }
      const group = params.get("group");
      if (group) {
        setSelectedGroupId(group);
        setScopeChoice("related");
      }
      const requestedDifficulty = params.get("difficulty") as DifficultyPreset | null;
      if (requestedDifficulty && Object.hasOwn(DIFFICULTY_MIXES, requestedDifficulty)) setDifficultyPreset(requestedDifficulty);
      const requestedType = params.get("type") as TypePreset | null;
      if (requestedType && ["mixed", "cloze", "sentence", "grammar", "application", "translation"].includes(requestedType)) setTypePreset(requestedType);
    } catch {
      // Builder defaults remain safe if browser storage/query state is unavailable.
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLessons() {
      setLoadingLessons(true);
      setLessonsError(null);
      try {
        const response = await apiRequest<LessonCollectionEnvelope>("/api/backend/lessons?page[size]=100&sort=lesson_no");
        if (active) setLessons(response?.data ?? []);
      } catch (caught) {
        if (active) setLessonsError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Lesson loading failed."}));
      } finally {
        if (active) setLoadingLessons(false);
      }
    }
    void loadLessons();
    return () => { active = false; };
  }, []);

  const groups = useMemo<LessonGroup[]>(() => {
    const grouped = new Map<string, Lesson[]>();
    for (const lesson of lessons) grouped.set(lesson.subcategory_id, [...(grouped.get(lesson.subcategory_id) ?? []), lesson]);
    return [...grouped.entries()].map(([id, groupLessons]) => {
      const first = groupLessons[0]!;
      return {
        id,
        title: (isFa ? first.subcategory_title_fa : first.subcategory_title_fr) || first.subcategory_title_fr || first.short_title,
        category: (isFa ? first.category_title_fa : first.category_title_fr) || first.category_title_fr || "",
        lessons: groupLessons,
      };
    });
  }, [isFa, lessons]);

  const filteredLessons = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale === "fa" ? "fa" : "fr");
    if (!query) return lessons;
    return lessons.filter((lesson) => `${lesson.lesson_no} ${lesson.title_fr} ${lesson.short_title}`.toLocaleLowerCase().includes(query));
  }, [lessons, locale, search]);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const selectedScopeIds = scopeChoice === "lessons"
    ? selectedLessonIds
    : scopeChoice === "related"
      ? selectedGroup?.lessons.map((lesson) => lesson.id) ?? []
      : [];
  const scopeIsValid = scopeChoice === "all" || selectedScopeIds.length > 0;

  const modeCopy: Record<BuilderMode, {title: string; detail: string; helper: string}> = isFa ? {
    adaptive: {
      title: "هوشمند (Adaptive)",
      detail: "سیستم براساس سطح، ضعف و نیاز مرور شما سؤال انتخاب می‌کند.",
      helper: "بهترین گزینه برای بهبود هوشمند؛ موتور تطبیقی ضعف، اهمیت TCF، فوریت مرور و تازگی سؤال را با هم در نظر می‌گیرد.",
    },
    tcf: {
      title: "شبیه‌سازی TCF",
      detail: "انتخاب درس‌ها بر پایه وزن TCF و سهم‌بندی کنترل‌شده انجام می‌شود.",
      helper: "برای تمرین نزدیک‌تر به اولویت‌های TCF؛ توزیع درس‌ها وزن‌دار است و سهم‌بندی بانک سؤال به‌صورت server-authoritative انجام می‌شود.",
    },
    custom: {
      title: "سفارشی (Custom)",
      detail: "دامنه، تعداد، دشواری و نوع سؤال را خودتان تعیین می‌کنید.",
      helper: "برای کنترل کامل جلسه؛ در حالت سفارشی می‌توانید سطح سختی و خانواده نوع سؤال را هم تعیین کنید.",
    },
  } : {
    adaptive: {title: "Adaptive", detail: "The system selects questions from your level, weaknesses and review needs.", helper: "Best for intelligent improvement: weakness, TCF importance, review urgency and novelty are combined by the adaptive engine."},
    tcf: {title: "TCF simulation", detail: "Lesson selection follows TCF weights with controlled quotas.", helper: "Best for TCF-oriented practice: lesson coverage is weighted and the final quotas stay server-authoritative."},
    custom: {title: "Custom", detail: "Choose scope, count, difficulty and question-type family yourself.", helper: "Best when you want direct control over the practice session."},
  };

  const scopeLabels = isFa
    ? {all: "همه درس‌ها", lessons: "درس‌های انتخابی", related: "گروه گرامری مرتبط"}
    : {all: "All lessons", lessons: "Selected lessons", related: "Related grammar group"};

  const difficultyLabels: Record<DifficultyPreset, string> = isFa
    ? {all: "تمام سطوح", easy: "آسان", medium: "متوسط", hard: "سخت", veryHard: "خیلی سخت"}
    : {all: "All levels", easy: "Easy", medium: "Medium", hard: "Hard", veryHard: "Very hard"};

  const typeLabels: Record<TypePreset, string> = isFa
    ? {mixed: "ترکیبی هوشمند", cloze: "جای خالی", sentence: "تحلیل جمله", grammar: "انتخاب دستوری", application: "کاربرد و بازنویسی", translation: "ترجمه"}
    : {mixed: "Smart mix", cloze: "Cloze", sentence: "Sentence analysis", grammar: "Grammar choice", application: "Application & rewrite", translation: "Translation"};

  const activeDifficultyMix = mode === "custom" ? DIFFICULTY_MIXES[difficultyPreset] : DEFAULT_DIFFICULTY_MIX;
  const difficultySummary = mode === "adaptive"
    ? (isFa ? "خودکار بر اساس تسلط" : "Automatic by mastery")
    : mode === "tcf"
      ? (isFa ? "ترکیب استاندارد TCF" : "TCF standard mix")
      : difficultyLabels[difficultyPreset];
  const typeSummary = mode === "custom" ? typeLabels[typePreset] : (isFa ? "ترکیبی خودکار" : "Automatic mix");
  const scopeSummary = scopeChoice === "all"
    ? scopeLabels.all
    : scopeChoice === "lessons"
      ? (isFa ? `${selectedLessonIds.length} درس انتخابی` : `${selectedLessonIds.length} selected lessons`)
      : selectedGroup?.title ?? (isFa ? "انتخاب نشده" : "Not selected");

  const estimatedLow = Math.max(1, Math.ceil(count * 1.25));
  const estimatedHigh = Math.max(estimatedLow, Math.ceil(count * 1.5));
  const coverageCounts = largestRemainder(count, [60, 20, 10, 10]);
  const coverage = isFa
    ? [
        {label: "انتخاب فرم / گزینه", count: coverageCounts[0], color: "#3576e8"},
        {label: "جای خالی", count: coverageCounts[1], color: "#2eaf78"},
        {label: "تحلیل جمله", count: coverageCounts[2], color: "#f1a62e"},
        {label: "بازنویسی / کاربرد", count: coverageCounts[3], color: "#8b68d7"},
      ]
    : [
        {label: "Form / choice", count: coverageCounts[0], color: "#3576e8"},
        {label: "Cloze", count: coverageCounts[1], color: "#2eaf78"},
        {label: "Sentence analysis", count: coverageCounts[2], color: "#f1a62e"},
        {label: "Rewrite / use", count: coverageCounts[3], color: "#8b68d7"},
      ];

  const donutStyle = {
    "--coverage-donut": `conic-gradient(${coverage[0].color} 0 60%, ${coverage[1].color} 60% 80%, ${coverage[2].color} 80% 90%, ${coverage[3].color} 90% 100%)`,
  } as CSSProperties;

  function toggleLesson(lessonId: string) {
    setSelectedLessonIds((current) => current.includes(lessonId) ? current.filter((id) => id !== lessonId) : [...current, lessonId]);
  }

  function draft(): BuilderDraft {
    return {mode, scopeChoice, selectedLessonIds, selectedGroupId, count, difficultyPreset, typePreset, advancedOpen};
  }

  function changeLanguage(nextLocale: "fa" | "fr") {
    if (nextLocale === locale) return;
    try {
      window.sessionStorage.setItem(SESSION_HANDOFF_KEY, JSON.stringify(draft()));
    } catch {
      // Route change still works if session storage is unavailable.
    }
    router.push(`/${nextLocale}/tests/new?restore=1`);
  }

  function saveTemplate() {
    try {
      window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(draft()));
      setTemplateSaved(true);
      window.setTimeout(() => setTemplateSaved(false), 2200);
    } catch {
      setTemplateSaved(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scopeIsValid) return;
    setBusy(true);
    setError(null);

    const config: TestCreateRequest = {
      schema_version: mode === "adaptive" ? "adaptive-selection-config-v0.9.0" : "test-config-schema-v0.9.0",
      mode,
      question_count: count,
      scope: scopeChoice === "all" ? {all_active_lessons: true} : {lesson_ids: selectedScopeIds},
      difficulty_mix_pct: activeDifficultyMix,
      ...(mode === "tcf" ? {lesson_allocation: {strategy: "TCF_WEIGHTED"}} : {}),
      ...(mode === "custom" ? {lesson_allocation: {strategy: "UNIFORM"}} : {}),
      ...(mode === "custom" && typePreset !== "mixed"
        ? {type_allocation: {strategy: "EXPLICIT_PCT", mix_pct: TYPE_PRESETS[typePreset]}}
        : {}),
    };

    let testCreated = false;
    try {
      const test = await apiRequest<TestEnvelope>("/api/backend/tests", {
        method: "POST",
        headers: {"Idempotency-Key": crypto.randomUUID()},
        body: JSON.stringify(config),
      });
      if (!test) throw new ApiError({status: 502, code: "EMPTY_TEST", message: "Test creation returned no resource."});
      testCreated = true;
      const attempt = await apiRequest<StartedAttemptEnvelope>(`/api/backend/tests/${test.data.id}/attempts`, {
        method: "POST",
        headers: {"Idempotency-Key": crypto.randomUUID()},
      });
      if (!attempt) throw new ApiError({status: 502, code: "EMPTY_ATTEMPT", message: "Attempt creation returned no resource."});
      router.push(`/${locale}/attempts/${attempt.data.id}`);
    } catch (caught) {
      if (testCreated && caught instanceof ApiError) {
        setError(new ApiError({status: caught.status, code: caught.code, message: isFa ? "آزمون ساخته شد، اما شروع اجرای آن ناموفق بود." : "The test was created, but its attempt could not be started.", fields: caught.fields, requestId: caught.requestId, retryAfter: caught.retryAfter}));
      } else {
        setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Test creation failed."}));
      }
    } finally {
      setBusy(false);
    }
  }

  const scopeCards: Array<{value: ScopeChoice; title: string; detail: string; icon: "lessons" | "selected" | "related"}> = isFa ? [
    {value: "all", title: "همه درس‌ها", detail: `تمام ${lessons.length || 52} درس کتاب`, icon: "lessons"},
    {value: "lessons", title: "درس‌های انتخابی", detail: selectedLessonIds.length ? `${selectedLessonIds.length} درس انتخاب شده` : "چند درس را انتخاب کنید", icon: "selected"},
    {value: "related", title: "گروه گرامری مرتبط", detail: selectedGroup ? `${selectedGroup.lessons.length} درس مرتبط` : "درس‌هایی که به یک مبحث مرتبط هستند", icon: "related"},
  ] : [
    {value: "all", title: "All lessons", detail: `All ${lessons.length || 52} active lessons`, icon: "lessons"},
    {value: "lessons", title: "Selected lessons", detail: selectedLessonIds.length ? `${selectedLessonIds.length} selected` : "Choose one or more lessons", icon: "selected"},
    {value: "related", title: "Related grammar group", detail: selectedGroup ? `${selectedGroup.lessons.length} related lessons` : "Lessons connected to one grammar topic", icon: "related"},
  ];

  return (
    <div className={`${styles.page} ${isFa ? styles.rtl : styles.ltr}`}>
      <header className={styles.pageHeading}>
        <button className={styles.backButton} type="button" onClick={() => router.back()} aria-label={isFa ? "بازگشت" : "Back"}>‹</button>
        <div>
          <h1>{isFa ? "ساخت تمرین / آزمون" : "Build practice / test"}</h1>
          <p>{isFa ? "تمرین دلخواه خود را بسازید و شروع کنید" : "Configure the session you want, then start practicing."}</p>
        </div>
      </header>

      {error ? (
        <StatusPanel
          title={error.code === "NO_ELIGIBLE_QUESTIONS" || error.code === "INSUFFICIENT_ELIGIBLE_INVENTORY"
            ? (isFa ? "بانک سؤال منتشرشده برای این ترکیب کافی نیست" : "Published inventory cannot satisfy this combination")
            : error.message}
          tone={error.code === "NO_ELIGIBLE_QUESTIONS" || error.code === "INSUFFICIENT_ELIGIBLE_INVENTORY" ? "warning" : "danger"}
          requestId={error.requestId}
        >
          <p>{error.code}</p>
        </StatusPanel>
      ) : null}

      <form className={styles.layout} onSubmit={create}>
        <section className={`${styles.panel} ${styles.modePanel}`} aria-labelledby="builder-mode-heading">
          <div className={styles.panelTitleRow}>
            <h2 id="builder-mode-heading">{isFa ? "حالت تمرین" : "Practice mode"}</h2>
            <span className={styles.helpDot}>?</span>
          </div>
          <div className={styles.modeList}>
            {MODES.map((value) => (
              <label className={`${styles.modeCard} ${mode === value ? styles.selectedCard : ""}`} key={value}>
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
                <span className={styles.radioVisual} aria-hidden="true" />
                <span className={styles.modeCopy}>
                  <strong>{modeCopy[value].title}</strong>
                  <small>{modeCopy[value].detail}</small>
                </span>
                <span className={`${styles.modeIcon} ${styles[`modeIcon${value[0].toUpperCase()}${value.slice(1)}`]}`}><Icon name={value} /></span>
              </label>
            ))}
          </div>
          <div className={styles.smartCallout}>
            <span className={styles.calloutIcon}><Icon name="info" /></span>
            <div><strong>{modeCopy[mode].title}</strong><p>{modeCopy[mode].helper}</p></div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.configPanel}`} aria-labelledby="builder-scope-heading">
          <div className={styles.panelTitleRow}><h2 id="builder-scope-heading">{isFa ? "انتخاب دامنه تمرین" : "Choose practice scope"}</h2></div>
          <div className={styles.scopeList}>
            {scopeCards.map((card) => (
              <label className={`${styles.scopeCard} ${scopeChoice === card.value ? styles.selectedCard : ""}`} key={card.value}>
                <input type="radio" name="scope" checked={scopeChoice === card.value} onChange={() => setScopeChoice(card.value)} />
                <span className={styles.radioVisual} aria-hidden="true" />
                <strong>{card.title}</strong>
                <small>{card.detail}</small>
                <span className={`${styles.scopeIcon} ${styles[`scopeIcon${card.value[0].toUpperCase()}${card.value.slice(1)}`]}`}><Icon name={card.icon} /></span>
              </label>
            ))}
          </div>

          {scopeChoice === "lessons" ? (
            <div className={styles.pickerBox}>
              <div className={styles.pickerToolbar}>
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isFa ? "جست‌وجوی نام یا شماره درس…" : "Search lesson title or number…"} aria-label={isFa ? "جست‌وجوی درس" : "Search lessons"} />
                <span>{isFa ? `${selectedLessonIds.length} انتخاب` : `${selectedLessonIds.length} selected`}</span>
              </div>
              <div className={styles.pickerList}>
                {filteredLessons.map((lesson) => (
                  <label className={styles.lessonOption} key={lesson.id}>
                    <input type="checkbox" checked={selectedLessonIds.includes(lesson.id)} onChange={() => toggleLesson(lesson.id)} />
                    <span className={styles.lessonNumber}>{lesson.lesson_no}</span>
                    <span><strong>{lesson.short_title}</strong><small>{lesson.title_fr}</small><em>{isFa ? `${lesson.question_count} سؤال` : `${lesson.question_count} questions`}</em></span>
                  </label>
                ))}
              </div>
              {!loadingLessons && !filteredLessons.length ? <p className={styles.muted}>{isFa ? "درسی با این عبارت پیدا نشد." : "No lesson matched that search."}</p> : null}
            </div>
          ) : null}

          {scopeChoice === "related" ? (
            <div className={styles.pickerBox}>
              <div className={styles.relatedList}>
                {groups.map((group) => (
                  <label className={`${styles.relatedOption} ${selectedGroupId === group.id ? styles.relatedSelected : ""}`} key={group.id}>
                    <input type="radio" name="related-group" checked={selectedGroupId === group.id} onChange={() => setSelectedGroupId(group.id)} />
                    <span><strong>{group.title}</strong><small>{group.category ? `${group.category} · ` : ""}{isFa ? `${group.lessons.length} درس مرتبط` : `${group.lessons.length} related lessons`}</small><em>{group.lessons.map((lesson) => lesson.short_title).join("، ")}</em></span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {loadingLessons && scopeChoice !== "all" ? <p className={styles.muted}>{isFa ? "در حال بارگذاری درس‌ها…" : "Loading lessons…"}</p> : null}
          {lessonsError && scopeChoice !== "all" ? <p className={styles.fieldError}>{isFa ? "فهرست درس‌ها بارگذاری نشد؛ صفحه را تازه‌سازی کنید." : "Lessons could not be loaded; refresh the page."}</p> : null}
          {!scopeIsValid ? <p className={styles.fieldError}>{isFa ? "حداقل یک درس یا یک گروه مرتبط انتخاب کنید." : "Select at least one lesson or related group."}</p> : null}

          <div className={styles.rule} />
          <fieldset className={styles.inlineSection}>
            <legend>{isFa ? "تعداد سؤال" : "Question count"}</legend>
            <div className={styles.countControls}>
              {[10, 20, 30].map((value) => <button type="button" className={`${styles.chip} ${count === value ? styles.chipSelected : ""}`} key={value} onClick={() => setCount(value)}>{value} {isFa ? "سؤال" : "questions"}</button>)}
              <label className={`${styles.customCount} ${![10, 20, 30].includes(count) ? styles.chipSelected : ""}`}><span>{isFa ? "سفارشی" : "Custom"}</span><input aria-label={isFa ? "تعداد سؤال سفارشی" : "Custom question count"} type="number" min={1} max={100} inputMode="numeric" value={count} onChange={(event) => setCount(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} /></label>
            </div>
          </fieldset>

          <div className={styles.rule} />
          <fieldset className={styles.inlineSection}>
            <legend>{isFa ? "سطح دشواری هدف" : "Target difficulty"}</legend>
            {mode === "custom" ? (
              <div className={styles.difficultyGrid}>
                {(Object.keys(difficultyLabels) as DifficultyPreset[]).map((value) => (
                  <button type="button" className={`${styles.difficultyChip} ${difficultyPreset === value ? styles.chipSelected : ""}`} key={value} onClick={() => setDifficultyPreset(value)}>
                    <span className={`${styles.difficultyDot} ${styles[`difficulty${value[0].toUpperCase()}${value.slice(1)}`]}`} />
                    {difficultyLabels[value]}
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.lockedSetting}>
                <span className={styles.difficultyDot} />
                <strong>{difficultySummary}</strong>
                <small>{mode === "adaptive" ? (isFa ? "سختی نهایی با وضعیت mastery هر کاربر هماهنگ می‌شود." : "Final difficulty is fitted to the learner mastery state.") : (isFa ? "ترکیب سطح برای حفظ شباهت و پوشش آزمونی به‌صورت کنترل‌شده ثابت می‌ماند." : "The level mix remains controlled for stable exam-oriented coverage.")}</small>
              </div>
            )}
          </fieldset>

          <div className={styles.rule} />
          <button className={styles.advancedToggle} type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((current) => !current)}>
            <span>{isFa ? "گزینه‌های پیشرفته (نوع سؤال، زبان، تنظیمات حالت و...)" : "Advanced options (question type, language, mode settings...)"}</span>
            <span className={advancedOpen ? styles.chevronOpen : styles.chevron}><Icon name="chevron" /></span>
          </button>

          {advancedOpen ? (
            <div className={styles.advancedPanel}>
              <div className={styles.advancedBlock}>
                <div className={styles.advancedHeading}><strong>{isFa ? "نوع سؤال" : "Question type"}</strong><small>{mode === "custom" ? (isFa ? "در حالت سفارشی، انتخاب شما به type_allocation سرور ارسال می‌شود." : "In Custom mode this maps to the server type_allocation contract.") : (isFa ? "در این حالت موتور انتخاب، نوع سؤال را براساس سازگاری و پوشش تعیین می‌کند." : "This mode lets the selection engine choose compatible question types.")}</small></div>
                {mode === "custom" ? (
                  <div className={styles.typeGrid}>
                    {(Object.keys(typeLabels) as TypePreset[]).map((value) => <button type="button" className={`${styles.typeChip} ${typePreset === value ? styles.chipSelected : ""}`} key={value} onClick={() => setTypePreset(value)}>{typeLabels[value]}</button>)}
                  </div>
                ) : <div className={styles.lockedSetting}><strong>{isFa ? "ترکیب خودکار Stage 6" : "Stage 6 automatic mix"}</strong><small>{isFa ? "فقط نوع‌های compatible با درس و زیرموضوع می‌توانند انتخاب شوند." : "Only types compatible with the lesson/subtopic are eligible."}</small></div>}
              </div>

              <div className={styles.advancedBlock}>
                <div className={styles.advancedHeading}><strong>{isFa ? "زبان رابط و توضیحات" : "Interface & explanation language"}</strong><small>{isFa ? "تغییر زبان، همین تنظیمات جلسه را هنگام جابه‌جایی حفظ می‌کند." : "Changing language preserves this builder draft during the route handoff."}</small></div>
                <div className={styles.languageSwitch}>
                  <button type="button" className={locale === "fa" ? styles.languageSelected : ""} onClick={() => changeLanguage("fa")}><Icon name="globe" /> فارسی</button>
                  <button type="button" className={locale === "fr" ? styles.languageSelected : ""} onClick={() => changeLanguage("fr")}><Icon name="globe" /> Français</button>
                </div>
              </div>

              <div className={styles.advancedBlock}>
                <div className={styles.advancedHeading}><strong>{mode === "adaptive" ? (isFa ? "تنظیمات موتور Adaptive" : "Adaptive engine settings") : mode === "tcf" ? (isFa ? "تنظیمات TCF" : "TCF settings") : (isFa ? "سیاست انتخاب Custom" : "Custom selection policy")}</strong></div>
                {mode === "adaptive" ? (
                  <div className={styles.policyGrid}>
                    <span><b>30%</b>{isFa ? "شکاف mastery" : "mastery gap"}</span><span><b>20%</b>{isFa ? "اهمیت TCF" : "TCF importance"}</span><span><b>20%</b>{isFa ? "فوریت مرور" : "review urgency"}</span><span><b>15%</b>{isFa ? "تازگی" : "novelty"}</span><span><b>15%</b>{isFa ? "خطای تکراری" : "misconception need"}</span><span><b>7d</b>{isFa ? "cooldown" : "cooldown"}</span>
                  </div>
                ) : mode === "tcf" ? (
                  <div className={styles.policyList}><span>✓ {isFa ? "تخصیص درس‌ها: TCF_WEIGHTED" : "Lesson allocation: TCF_WEIGHTED"}</span><span>✓ {isFa ? "سهم‌بندی سختی و نوع قبل از randomization" : "Difficulty/type quotas before randomization"}</span><span>✓ {isFa ? "انتخاب و ترتیب با seed قابل audit" : "Seeded, auditable selection/order"}</span></div>
                ) : (
                  <div className={styles.policyList}><span>✓ {isFa ? "تخصیص درس‌ها: UNIFORM برای دامنه انتخاب‌شده" : "Lesson allocation: UNIFORM within the selected scope"}</span><span>✓ {isFa ? "دشواری قابل تنظیم" : "Adjustable difficulty"}</span><span>✓ {isFa ? "نوع سؤال قابل تنظیم یا ترکیب خودکار" : "Adjustable type family or automatic mix"}</span></div>
                )}
              </div>
            </div>
          ) : null}
        </section>

        <aside className={`${styles.panel} ${styles.summaryPanel}`} aria-label={isFa ? "خلاصه تمرین" : "Practice summary"}>
          <div className={styles.summaryHeading}><h2>{isFa ? "خلاصه تمرین" : "Practice summary"}</h2><span><Icon name="summary" /></span></div>
          <dl className={styles.summaryList}>
            <div><dt>{isFa ? "حالت تمرین:" : "Mode:"}</dt><dd>{modeCopy[mode].title}</dd></div>
            <div><dt>{isFa ? "دامنه:" : "Scope:"}</dt><dd>{scopeSummary}</dd></div>
            <div><dt>{isFa ? "تعداد سؤال:" : "Questions:"}</dt><dd>{count}</dd></div>
            <div><dt>{isFa ? "سطح دشواری:" : "Difficulty:"}</dt><dd>{difficultySummary}</dd></div>
            <div><dt>{isFa ? "مدت زمان تقریبی:" : "Estimated time:"}</dt><dd>{estimatedLow}–{estimatedHigh} {isFa ? "دقیقه" : "min"}</dd></div>
            <div><dt>{isFa ? "نوع سؤال:" : "Question type:"}</dt><dd>{typeSummary}</dd></div>
          </dl>

          <div className={styles.coverageHeader}>
            <strong>{isFa ? "پیش‌نمایش Coverage" : "Coverage preview"}</strong>
            <small>{isFa ? "تخمینی؛ انتخاب نهایی در سرور" : "Estimate; final selection is server-side"}</small>
          </div>
          <div className={styles.coverageWrap}>
            <div className={styles.donut} style={donutStyle}><span><b>{count}</b><small>{isFa ? "سؤال" : "questions"}</small></span></div>
            <div className={styles.coverageLegend}>
              {coverage.map((item) => <div key={item.label}><span className={styles.legendDot} style={{background: item.color}} /><span>{item.label}</span><b>{item.count}</b></div>)}
            </div>
          </div>

          <button className={styles.startButton} type="submit" disabled={busy || !scopeIsValid} aria-busy={busy}>
            <span>{busy ? (isFa ? "در حال آماده‌سازی…" : "Preparing…") : (isFa ? "شروع تمرین" : "Start practice")}</span><Icon name="play" />
          </button>
          <button className={styles.templateButton} type="button" onClick={saveTemplate}><span>{templateSaved ? (isFa ? "الگو ذخیره شد" : "Template saved") : (isFa ? "ذخیره به عنوان الگو" : "Save as template")}</span><Icon name="bookmark" /></button>
          <p className={styles.serverNote}>{isFa ? "انتخاب نهایی سؤال و امتیازدهی همچنان فقط در سرور انجام می‌شود." : "Final question selection and scoring remain server-authoritative."}</p>
        </aside>
      </form>
    </div>
  );
}

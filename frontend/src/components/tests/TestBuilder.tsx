"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { LessonCollectionEnvelope, StartedAttemptEnvelope, TestCreateRequest, TestEnvelope } from "@/lib/api/types";
import type { Locale } from "@/lib/i18n";
import { StatusPanel } from "@/components/ui/StatusPanel";

type Lesson = LessonCollectionEnvelope["data"][number];
type ScopeChoice = "all" | "lessons" | "related";
type LessonGroup = {id: string; title: string; category: string; lessons: Lesson[]};

const MODES = ["adaptive", "tcf", "custom"] as const satisfies readonly TestCreateRequest["mode"][];
type BuilderMode = (typeof MODES)[number];

export function TestBuilder({locale}: {locale: Locale}) {
  const isFa = locale === "fa";
  const router = useRouter();
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<BuilderMode>("adaptive");
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>("all");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [lessonsError, setLessonsError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

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
  const selectedScopeIds = scopeChoice === "lessons" ? selectedLessonIds : (scopeChoice === "related" ? selectedGroup?.lessons.map((lesson) => lesson.id) ?? [] : []);
  const scopeIsValid = scopeChoice === "all" || selectedScopeIds.length > 0;

  function toggleLesson(lessonId: string) {
    setSelectedLessonIds((current) => current.includes(lessonId) ? current.filter((id) => id !== lessonId) : [...current, lessonId]);
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scopeIsValid) return;
    setBusy(true);
    setError(null);
    const config: TestCreateRequest = {
      schema_version: mode === "adaptive" ? "adaptive-selection-config-v0.9.0" : "test-config-schema-v0.9.0",
      mode,
      question_count: count,
      scope: scopeChoice === "all" ? {all_active_lessons: true} : {lesson_ids: selectedScopeIds},
      difficulty_mix_pct: {EASY: 20, MEDIUM: 40, HARD: 30, VERY_HARD: 10},
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

  const modeCopy: Record<BuilderMode, {title: string; detail: string}> = isFa ? {
    adaptive: {title: "تطبیقی", detail: "سؤال‌ها با سطح فعلی شما هماهنگ می‌شوند"},
    tcf: {title: "شبیه‌ساز TCF", detail: "ترکیبی نزدیک به الگوی آزمون رسمی"},
    custom: {title: "تمرین متعادل", detail: "ترکیب ثابت و قابل پیش‌بینی از دشواری‌ها"},
  } : {
    adaptive: {title: "Adaptive", detail: "Questions adjust to your current level"},
    tcf: {title: "TCF simulation", detail: "A mix close to the official exam pattern"},
    custom: {title: "Balanced practice", detail: "A predictable, fixed difficulty mix"},
  };

  return (
    <div className="test-builder-layout">
      <div className="surface test-builder-main stack">
        {error ? (
          <StatusPanel title={error.code === "NO_ELIGIBLE_QUESTIONS" ? (isFa ? "برای این محدوده سؤال منتشرشده کافی نیست" : "No published questions are available for this scope") : error.message} tone={error.code === "NO_ELIGIBLE_QUESTIONS" ? "warning" : "danger"} requestId={error.requestId}>
            <p>{error.code}</p>
          </StatusPanel>
        ) : null}
        <form className="stack test-builder-form" onSubmit={create}>
          <fieldset className="builder-section">
            <legend>{isFa ? "۱. سبک تمرین" : "1. Practice style"}</legend>
            <div className="choice-grid choice-grid-modes">
              {MODES.map((value) => (
                <label className={`choice-card ${mode === value ? "choice-card-selected" : ""}`} key={value}>
                  <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
                  <span className="choice-card-copy"><strong>{modeCopy[value].title}</strong><small>{modeCopy[value].detail}</small></span>
                  {value === "adaptive" ? <span className="choice-badge">{isFa ? "پیشنهادی" : "Recommended"}</span> : null}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="builder-section">
            <legend>{isFa ? "۲. محدوده درس‌ها" : "2. Lesson scope"}</legend>
            <div className="scope-tabs">
              {(["all", "lessons", "related"] as ScopeChoice[]).map((value) => {
                const labels = isFa ? {all: "همه درس‌ها", lessons: "انتخاب درس", related: "گروه مرتبط"} : {all: "All lessons", lessons: "Choose lessons", related: "Related group"};
                return <label className={scopeChoice === value ? "scope-tab scope-tab-selected" : "scope-tab"} key={value}><input type="radio" name="scope" checked={scopeChoice === value} onChange={() => setScopeChoice(value)} /><span>{labels[value]}</span></label>;
              })}
            </div>

            {scopeChoice === "all" ? <p className="builder-hint">{isFa ? `از میان همه ${lessons.length || 52} درس فعال، سؤال مناسب انتخاب می‌شود.` : `Questions are selected from all ${lessons.length || 52} active lessons.`}</p> : null}

            {scopeChoice === "lessons" ? (
              <div className="lesson-picker stack stack-small">
                <div className="lesson-picker-toolbar">
                  <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isFa ? "جست‌وجوی نام یا شماره درس…" : "Search lesson title or number…"} aria-label={isFa ? "جست‌وجوی درس" : "Search lessons"} />
                  <span>{isFa ? `${selectedLessonIds.length} انتخاب` : `${selectedLessonIds.length} selected`}</span>
                </div>
                <div className="lesson-option-list">
                  {filteredLessons.map((lesson) => <label className="lesson-option" key={lesson.id}><input type="checkbox" checked={selectedLessonIds.includes(lesson.id)} onChange={() => toggleLesson(lesson.id)} /><span className="lesson-number">{lesson.lesson_no}</span><span><strong>{lesson.short_title}</strong><small>{lesson.title_fr}</small></span></label>)}
                </div>
                {!loadingLessons && !filteredLessons.length ? <p className="muted">{isFa ? "درسی با این عبارت پیدا نشد." : "No lesson matched that search."}</p> : null}
              </div>
            ) : null}

            {scopeChoice === "related" ? (
              <div className="related-group-list">
                {groups.map((group) => <label className={`related-group-card ${selectedGroupId === group.id ? "related-group-selected" : ""}`} key={group.id}><input type="radio" name="related-group" checked={selectedGroupId === group.id} onChange={() => setSelectedGroupId(group.id)} /><span><strong>{group.title}</strong><small>{group.category ? `${group.category} · ` : ""}{isFa ? `${group.lessons.length} درس مرتبط` : `${group.lessons.length} related lessons`}</small><em>{group.lessons.map((lesson) => lesson.short_title).join("، ")}</em></span></label>)}
              </div>
            ) : null}

            {loadingLessons && scopeChoice !== "all" ? <p className="muted">{isFa ? "در حال بارگذاری درس‌ها…" : "Loading lessons…"}</p> : null}
            {lessonsError && scopeChoice !== "all" ? <p className="field-error">{isFa ? "فهرست درس‌ها بارگذاری نشد؛ صفحه را تازه‌سازی کنید." : "Lessons could not be loaded; refresh the page."}</p> : null}
            {!scopeIsValid ? <p className="field-error">{isFa ? "حداقل یک درس یا یک گروه مرتبط انتخاب کنید." : "Select at least one lesson or related group."}</p> : null}
          </fieldset>

          <fieldset className="builder-section">
            <legend>{isFa ? "۳. تعداد سؤال" : "3. Question count"}</legend>
            <div className="count-controls">
              {[10, 20, 30].map((value) => <button type="button" className={count === value ? "count-chip count-chip-selected" : "count-chip"} key={value} onClick={() => setCount(value)}>{value}</button>)}
              <label className="custom-count"><span>{isFa ? "دلخواه" : "Custom"}</span><input id="question-count" type="number" min={1} max={100} inputMode="numeric" value={count} onChange={(event) => setCount(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} /></label>
            </div>
          </fieldset>

          <button className="button button-primary builder-submit" type="submit" disabled={busy || !scopeIsValid} aria-busy={busy}>{busy ? (isFa ? "در حال آماده‌سازی…" : "Preparing…") : (isFa ? "ساخت و شروع تمرین" : "Build and start practice")}</button>
        </form>
      </div>

      <aside className="surface test-builder-summary stack stack-small" aria-label={isFa ? "خلاصه تمرین" : "Practice summary"}>
        <p className="eyebrow">{isFa ? "خلاصه تمرین" : "Practice summary"}</p>
        <h2>{modeCopy[mode].title}</h2>
        <dl>
          <div><dt>{isFa ? "محدوده" : "Scope"}</dt><dd>{scopeChoice === "all" ? (isFa ? "همه درس‌ها" : "All lessons") : scopeChoice === "lessons" ? (isFa ? `${selectedLessonIds.length} درس` : `${selectedLessonIds.length} lessons`) : (selectedGroup?.title ?? (isFa ? "انتخاب نشده" : "Not selected"))}</dd></div>
          <div><dt>{isFa ? "تعداد" : "Questions"}</dt><dd>{count}</dd></div>
          <div><dt>{isFa ? "دشواری" : "Difficulty"}</dt><dd>{isFa ? "متنوع" : "Mixed"}</dd></div>
        </dl>
        <p className="builder-hint">{isFa ? "انتخاب نهایی سؤال‌ها بر اساس محدوده و وضعیت یادگیری شما در سرور انجام می‌شود." : "Final question selection uses this scope and your learning state on the server."}</p>
      </aside>
    </div>
  );
}

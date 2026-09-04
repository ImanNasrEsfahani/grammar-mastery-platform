"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from "react";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {ReviewCollectionEnvelope} from "@/lib/api/types";
import type {Locale} from "@/lib/i18n";
import styles from "./ReviewInbox.module.css";

type ReviewSummary = ReviewCollectionEnvelope["data"][number];
type QueueMode = "inbox" | "mistakes" | "spaced" | "saved" | "corrected";
type TimeTab = "all" | "today" | "week" | "later";
type Priority = "HIGH" | "MEDIUM" | "LOW";
type PriorityFilter = "ALL" | Priority;
type RepeatFilter = "ALL" | "2" | "3" | "5";
type DueFilter = "ALL" | "NOW" | "WEEK" | "LATER" | "NO_DATE";
type SortChoice = "due_at" | "-due_at" | "repeat";

type ApiAwareReview = ReviewSummary & {
  lesson_id?: string | null;
  lesson_no?: number | null;
  lesson_title?: string | null;
  subtopic_id?: string | null;
  subtopic_title?: string | null;
  subtopic_title_fa?: string | null;
  subtopic_title_fr?: string | null;
  misconception_id?: string | null;
  misconception_label?: string | null;
  difficulty?: "EASY" | "MEDIUM" | "HARD" | "VERY_HARD" | null;
  mastery_score_pct?: number | null;
};

type TopicLookupSubtopic = {
  id: string;
  title_fr?: string | null;
  title_fa?: string | null;
  display_title?: string | null;
};

type TopicLookupEnvelope = {
  data?: {
    categories?: Array<{
      subcategories?: Array<{
        lessons?: Array<{
          subtopics?: TopicLookupSubtopic[];
        }>;
      }>;
    }>;
  };
};

const PAGE_SIZE = 100;
const MAX_QUEUE_PAGES = 500;

const copy = {
  fa: {
    eyebrow: "Review Inbox",
    title: "صندوق بازبینی",
    subtitle: "سؤال‌هایی که به مرور و تمرین دوباره نیاز دارند، در یک صف هدفمند و قابل فیلتر.",
    navTitle: "بازبینی",
    inbox: "صندوق بازبینی",
    mistakes: "اشتباهات من",
    spaced: "مرور فاصله‌دار",
    saved: "نشان‌شده‌ها",
    corrected: "اصلاح‌شده‌ها",
    howTitle: "چگونه کار می‌کند؟",
    howBody: "اشتباه‌ها و مرورهای سررسیدشده بر اساس زمان، تکرار و وضعیت واقعی صف مرتب می‌شوند. ترتیب پایه همچنان از سرور می‌آید.",
    learnMore: "بیشتر بدانید",
    search: "جستجو در سؤال یا گروه خطا…",
    filters: "فیلترها",
    all: "همه",
    today: "امروز",
    week: "این هفته",
    later: "بعداً",
    itemCount: "مورد",
    priority: "اولویت",
    nextDue: "موعد مرور بعدی",
    topic: "مبحث",
    topicUnavailable: "مبحث نامشخص",
    lesson: "درس",
    details: "جزئیات",
    lastError: "مورد مرور",
    high: "بالا",
    medium: "متوسط",
    low: "پایین",
    now: "اکنون",
    tomorrow: "فردا",
    days: "روز دیگر",
    noDate: "بدون موعد",
    mistake: "اشتباه",
    srs: "مرور فاصله‌دار",
    repeat: "تکرار",
    mastery: "تسلط",
    masteryUnavailable: "قرارداد فعلی API اثر/امتیاز تسلط را در لیست مرور برنمی‌گرداند.",
    start: "مرور این مورد",
    startDue: "شروع مرور همه سررسیدها",
    noDue: "فعلاً مورد سررسیدشده‌ای برای امروز ندارید",
    dueLoadError: "شمارش مرورهای سررسید بارگذاری نشد؛ دوباره تلاش کنید.",
    open: "باز کردن",
    mark: "نشان‌کردن برای مرور",
    unmark: "برداشتن نشان",
    summary: "خلاصه بازبینی",
    questions: "مورد",
    dueToday: "موعد امروز",
    waiting: "در انتظار",
    filterTitle: "فیلترها",
    reviewType: "نوع مرور",
    misconception: "Misconception",
    difficulty: "سطح سختی",
    repetition: "تعداد تکرار",
    lessonFilter: "درس",
    allValues: "همه",
    clearFilters: "پاک کردن فیلترها",
    sourceOrder: "ترتیب سرور",
    newestDue: "موعد دورتر",
    repeatSort: "بیشترین تکرار",
    sort: "مرتب‌سازی",
    selected: "انتخاب‌شده",
    selectVisible: "انتخاب موارد نمایش‌داده‌شده",
    clearSelection: "لغو انتخاب",
    bulkMark: "نشان‌کردن",
    bulkUnmark: "برداشتن نشان",
    bulkOpen: "باز کردن اولین مورد",
    bulkMistakeOnly: "نشان‌گذاری فقط برای موارد Mistake توسط API پشتیبانی می‌شود؛ موارد SRS بدون تغییر می‌مانند.",
    empty: "فعلاً موردی در این بخش نیست",
    emptyBody: "با ادامه تمرین، موارد مرور واقعی بر اساس خطاها و برنامه فاصله‌دار اینجا ظاهر می‌شوند.",
    filteredEmpty: "موردی با این فیلترها پیدا نشد",
    filteredBody: "فیلترها یا عبارت جستجو را تغییر دهید.",
    retry: "تلاش دوباره",
    loading: "در حال آماده‌سازی صندوق مرور…",
    error: "صف مرور بارگذاری نشد",
    lessonUnavailable: "فیلتر درس زمانی فعال می‌شود که API لیست Review شناسه درس را برگرداند.",
    difficultyUnavailable: "فیلتر سختی زمانی فعال می‌شود که API لیست Review سختی را برگرداند.",
    misconceptionFallback: "گروه خطا",
    unresolved: "حل‌نشده",
    correctedStatus: "اصلاح‌شده",
    scheduled: "برنامه‌ریزی‌شده",
    due: "سررسید",
    suspended: "متوقف",
    marked: "نشان‌شده",
    menuLabel: "اقدامات مورد مرور",
    filterPanelOpen: "باز کردن پنل فیلترها",
    filterPanelClose: "بستن پنل فیلترها",
    uiPriorityNote: "اولویت نمایشی از موعد، تکرار و نشان‌گذاری محاسبه می‌شود؛ ترتیب پایه و وضعیت صف از سرور است.",
    completeQueue: "شمارش‌ها بر اساس کل صف بارگذاری‌شده از همه صفحه‌های API محاسبه می‌شوند.",
    offlineHint: "اگر اتصال قطع شود، آخرین صف بارگذاری‌شده در صفحه باقی می‌ماند؛ تغییرات نیازمند اتصال هستند.",
  },
  en: {
    eyebrow: "Review Inbox",
    title: "Review Inbox",
    subtitle: "Questions that need another look, organized into a focused, filterable review queue.",
    navTitle: "Review",
    inbox: "Review inbox",
    mistakes: "My mistakes",
    spaced: "Spaced review",
    saved: "Saved",
    corrected: "Corrected",
    howTitle: "How does it work?",
    howBody: "Mistakes and scheduled reviews are surfaced from the real queue. Display priority uses timing, repetition and saved state while server order stays authoritative by default.",
    learnMore: "Learn more",
    search: "Search question or error group…",
    filters: "Filters",
    all: "All",
    today: "Today",
    week: "This week",
    later: "Later",
    itemCount: "items",
    priority: "Priority",
    nextDue: "Next due",
    topic: "Topic",
    topicUnavailable: "Topic unavailable",
    lesson: "Lesson",
    details: "Details",
    lastError: "Review item",
    high: "High",
    medium: "Medium",
    low: "Low",
    now: "Now",
    tomorrow: "Tomorrow",
    days: "days",
    noDate: "No due date",
    mistake: "Mistake",
    srs: "Spaced review",
    repeat: "Repeats",
    mastery: "Mastery",
    masteryUnavailable: "The current review-list API contract does not expose mastery impact/score.",
    start: "Review this item",
    startDue: "Start all due reviews",
    noDue: "There are no reviews due today",
    dueLoadError: "Due-review count could not be loaded. Try again.",
    open: "Open",
    mark: "Mark for review",
    unmark: "Remove mark",
    summary: "Review summary",
    questions: "items",
    dueToday: "Due today",
    waiting: "Waiting",
    filterTitle: "Filters",
    reviewType: "Review type",
    misconception: "Misconception",
    difficulty: "Difficulty",
    repetition: "Repetition count",
    lessonFilter: "Lesson",
    allValues: "All",
    clearFilters: "Clear filters",
    sourceOrder: "Server order",
    newestDue: "Later due first",
    repeatSort: "Most repeated",
    sort: "Sort",
    selected: "selected",
    selectVisible: "Select visible items",
    clearSelection: "Clear selection",
    bulkMark: "Mark",
    bulkUnmark: "Unmark",
    bulkOpen: "Open first",
    bulkMistakeOnly: "The API only supports marking Mistake items; SRS items are left unchanged.",
    empty: "Nothing is waiting here",
    emptyBody: "As you practice, real mistakes and spaced-review schedules will appear here.",
    filteredEmpty: "No items match these filters",
    filteredBody: "Change the filters or search query.",
    retry: "Retry",
    loading: "Preparing your review inbox…",
    error: "Review queue could not be loaded",
    lessonUnavailable: "Lesson filtering activates when the Review list API exposes lesson metadata.",
    difficultyUnavailable: "Difficulty filtering activates when the Review list API exposes difficulty metadata.",
    misconceptionFallback: "Error group",
    unresolved: "Unresolved",
    correctedStatus: "Corrected",
    scheduled: "Scheduled",
    due: "Due",
    suspended: "Suspended",
    marked: "Marked",
    menuLabel: "Review item actions",
    filterPanelOpen: "Open filters",
    filterPanelClose: "Close filters",
    uiPriorityNote: "Display priority is derived from due time, repetition and saved state; queue state and default order remain server-owned.",
    completeQueue: "Counts are calculated from the complete queue loaded across all API pages.",
    offlineHint: "If connectivity drops, the last loaded queue remains visible; changes require a connection.",
  },
} as const;

function Icon({name, size = 18}: {name: string; size?: number}) {
  const common = {width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true};
  if (name === "inbox") return <svg {...common}><path d="M4 5h16l1.5 7v6a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-6L4 5Z"/><path d="M3 13h5l2 3h4l2-3h5"/></svg>;
  if (name === "mistake") return <svg {...common}><path d="M5 4h14l2 7v8H3v-8l2-7Z"/><path d="M8 11h8M12 7v4"/></svg>;
  if (name === "clock") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  if (name === "bookmark") return <svg {...common}><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>;
  if (name === "filter") return <svg {...common}><path d="M4 5h16M7 12h10M10 19h4"/></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.5 9a7 7 0 0 1 11.6-2.4L20 11M4 13l1.9 4.4A7 7 0 0 0 17.5 15"/></svg>;
  if (name === "chevron") return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  if (name === "dots") return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></svg>;
  if (name === "layers") return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 17h.01"/></svg>;
}

function parseMisconception(item: ApiAwareReview): {id: string; label: string} | null {
  if (item.misconception_id) return {id: item.misconception_id, label: item.misconception_label || item.misconception_id};
  const key = item.group_key || "";
  const prefix = "MISCONCEPTION:";
  if (!key.startsWith(prefix)) return null;
  const id = key.slice(prefix.length);
  return id ? {id, label: id} : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readableTopicValue(value?: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (UUID_PATTERN.test(text)) return null;
  if (/^(?:MISCONCEPTION|SUBTOPIC|LESSON):/i.test(text)) return null;
  return text;
}

function buildTopicTitleLookup(envelope: TopicLookupEnvelope | null | undefined, locale: Locale) {
  const result = new Map<string, string>();
  for (const category of envelope?.data?.categories ?? []) {
    for (const subcategory of category.subcategories ?? []) {
      for (const lesson of subcategory.lessons ?? []) {
        for (const subtopic of lesson.subtopics ?? []) {
          const title = readableTopicValue(subtopic.display_title)
            || (locale === "fa" ? readableTopicValue(subtopic.title_fa) : readableTopicValue(subtopic.title_fr))
            || (locale === "fa" ? readableTopicValue(subtopic.title_fr) : null);
          if (subtopic.id && title) result.set(subtopic.id, title);
        }
      }
    }
  }
  return result;
}

function resolvedTopicTitle(item: ApiAwareReview, locale: Locale, topicTitles: Map<string, string>, labels: typeof copy.fa | typeof copy.en) {
  const titleAsId = item.subtopic_title && UUID_PATTERN.test(item.subtopic_title.trim()) ? item.subtopic_title.trim() : null;
  const ids = [item.subtopic_id, titleAsId].filter((value): value is string => Boolean(value));
  for (const id of ids) {
    const localized = topicTitles.get(id);
    if (localized) return localized;
  }
  const apiLocalized = locale === "fa" ? item.subtopic_title_fa : item.subtopic_title_fr;
  return readableTopicValue(apiLocalized)
    || readableTopicValue(item.subtopic_title)
    || (locale === "fa" ? readableTopicValue(item.subtopic_title_fr) : null)
    || labels.topicUnavailable;
}

function dueDate(item: ApiAwareReview): Date | null {
  if (item.kind === "MISTAKE" && item.status === "UNRESOLVED") return new Date(0);
  if (!item.due_at) return null;
  const date = new Date(item.due_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDelta(item: ApiAwareReview, now = new Date()): number | null {
  if (item.kind === "MISTAKE" && item.status === "UNRESOLVED") return 0;
  const due = dueDate(item);
  if (!due) return null;
  const a = startOfLocalDay(due).getTime();
  const b = startOfLocalDay(now).getTime();
  return Math.round((a - b) / 86_400_000);
}

function repeatCount(item: ApiAwareReview): number {
  return item.repeat_count ?? 0;
}

function displayPriority(item: ApiAwareReview, now = new Date()): Priority {
  const delta = dayDelta(item, now);
  const repeats = repeatCount(item);
  if (item.marked || repeats >= 3 || (delta !== null && delta < 0)) return "HIGH";
  if (repeats >= 2 || item.kind === "MISTAKE" || (delta !== null && delta <= 2)) return "MEDIUM";
  return "LOW";
}

function matchesTime(item: ApiAwareReview, tab: TimeTab, now = new Date()) {
  if (tab === "all") return true;
  const delta = dayDelta(item, now);
  if (delta === null) return tab === "later";
  if (tab === "today") return delta <= 0;
  if (tab === "week") return delta >= 1 && delta <= 7;
  return delta > 7;
}

function matchesDue(item: ApiAwareReview, filter: DueFilter, now = new Date()) {
  if (filter === "ALL") return true;
  const delta = dayDelta(item, now);
  if (filter === "NO_DATE") return delta === null;
  if (delta === null) return false;
  if (filter === "NOW") return delta <= 0;
  if (filter === "WEEK") return delta >= 1 && delta <= 7;
  return delta > 7;
}

function isActiveSpacedDue(item: ApiAwareReview, now = new Date()) {
  if (item.kind !== "SPACED" || !["DUE", "SCHEDULED"].includes(item.status)) return false;
  const delta = dayDelta(item, now);
  return delta !== null && delta <= 0;
}

function dueLabel(item: ApiAwareReview, locale: Locale, labels: typeof copy.fa | typeof copy.en) {
  if (item.kind === "MISTAKE" && item.status === "UNRESOLVED") return labels.now;
  const delta = dayDelta(item);
  if (delta === null) return labels.noDate;
  if (delta <= 0) return labels.now;
  if (delta === 1) return labels.tomorrow;
  if (locale === "fa") return `${delta.toLocaleString("fa-IR")} ${labels.days}`;
  return `${delta} ${labels.days}`;
}

function statusLabel(item: ApiAwareReview, labels: typeof copy.fa | typeof copy.en) {
  const map: Record<string, string> = {UNRESOLVED: labels.unresolved, CORRECTED: labels.correctedStatus, DUE: labels.due, SCHEDULED: labels.scheduled, SUSPENDED: labels.suspended};
  return map[item.status] || item.status.replaceAll("_", " ");
}

function compactId(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function ReviewInbox({locale}: {locale: Locale}) {
  const labels = copy[locale];
  const isFa = locale === "fa";
  const [mode, setMode] = useState<QueueMode>("inbox");
  const [timeTab, setTimeTab] = useState<TimeTab>("all");
  const [items, setItems] = useState<ApiAwareReview[]>([]);
  const [dueItems, setDueItems] = useState<ApiAwareReview[]>([]);
  const [dueQueueLoading, setDueQueueLoading] = useState(true);
  const [dueQueueError, setDueQueueError] = useState(false);
  const [topicTitles, setTopicTitles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<PriorityFilter>("ALL");
  const [dueFilter, setDueFilter] = useState<DueFilter>("ALL");
  const [misconception, setMisconception] = useState("ALL");
  const [lesson, setLesson] = useState("ALL");
  const [difficulty, setDifficulty] = useState("ALL");
  const [repeat, setRepeat] = useState<RepeatFilter>("ALL");
  const [sort, setSort] = useState<SortChoice>("due_at");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const baseQuery = useCallback((cursor?: string | null) => {
    const params = new URLSearchParams();
    params.set("page[size]", String(PAGE_SIZE));
    params.set("sort", sort === "-due_at" ? "-due_at" : "due_at");
    if (cursor) params.set("page[after]", cursor);
    if (mode === "inbox" || mode === "spaced") params.set("filter[kind]", "SPACED");
    if (mode === "mistakes") params.set("filter[kind]", "MISTAKE");
    if (mode === "saved") params.set("filter[marked]", "true");
    if (mode === "corrected") {
      params.set("filter[kind]", "MISTAKE");
      params.set("filter[resolution_status]", "CORRECTED");
    }
    if (lesson !== "ALL") params.set("filter[lesson_id]", lesson);
    if (misconception !== "ALL") params.set("filter[misconception_id]", misconception);
    if (difficulty !== "ALL") params.set("filter[difficulty]", difficulty);
    if (repeat !== "ALL") params.set("filter[min_repeat_count]", repeat);
    return `/api/backend/reviews?${params.toString()}`;
  }, [difficulty, lesson, misconception, mode, repeat, sort]);

  const loadTopicTitles = useCallback(async () => {
    try {
      const envelope = await apiRequest<TopicLookupEnvelope>(`/api/backend/mastery-map?locale=${locale}`);
      setTopicTitles(buildTopicTitleLookup(envelope, locale));
    } catch {
      setTopicTitles(new Map());
    }
  }, [locale]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionMessage(null);
    try {
      const merged = new Map<string, ApiAwareReview>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let completed = false;

      for (let pageIndex = 0; pageIndex < MAX_QUEUE_PAGES; pageIndex += 1) {
        const envelope: ReviewCollectionEnvelope = await apiRequest<ReviewCollectionEnvelope>(baseQuery(cursor));
        if (!envelope) {
          throw new ApiError({status: 502, code: "EMPTY_REVIEW_RESPONSE", message: labels.error});
        }
        for (const item of (envelope.data || []) as ApiAwareReview[]) merged.set(item.id, item);
        const nextCursor: string | null = envelope.page?.next_cursor ?? null;
        const hasMore = Boolean(envelope.page?.has_more && nextCursor);
        if (!hasMore) {
          completed = true;
          break;
        }
        if (!nextCursor || seenCursors.has(nextCursor)) {
          throw new ApiError({status: 502, code: "INVALID_REVIEW_CURSOR", message: labels.error});
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      if (!completed) {
        throw new ApiError({status: 502, code: "REVIEW_QUEUE_TOO_LARGE", message: labels.error});
      }

      const allItems = [...merged.values()];
      setItems(allItems);
      setSelected(new Set());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError({status: 0, code: "NETWORK_ERROR", message: labels.error}));
    } finally {
      setLoading(false);
    }
  }, [baseQuery, labels.error, mode]);

  const loadDueQueue = useCallback(async () => {
    setDueQueueLoading(true);
    setDueQueueError(false);
    try {
      const merged = new Map<string, ApiAwareReview>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let completed = false;

      for (let pageIndex = 0; pageIndex < MAX_QUEUE_PAGES; pageIndex += 1) {
        const params = new URLSearchParams();
        params.set("page[size]", String(PAGE_SIZE));
        params.set("sort", "due_at");
        params.set("filter[kind]", "SPACED");
        if (cursor) params.set("page[after]", cursor);
        const envelope: ReviewCollectionEnvelope = await apiRequest<ReviewCollectionEnvelope>(`/api/backend/reviews?${params.toString()}`);
        if (!envelope) throw new Error("Empty due-review response");
        for (const item of (envelope.data || []) as ApiAwareReview[]) merged.set(item.id, item);
        const nextCursor: string | null = envelope.page?.next_cursor ?? null;
        const hasMore = Boolean(envelope.page?.has_more && nextCursor);
        if (!hasMore) { completed = true; break; }
        if (!nextCursor || seenCursors.has(nextCursor)) throw new Error("Repeated due-review cursor");
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      if (!completed) throw new Error("Due-review queue exceeded pagination safety limit");
      setDueItems([...merged.values()].filter((item) => isActiveSpacedDue(item)));
    } catch {
      setDueItems([]);
      setDueQueueError(true);
    } finally {
      setDueQueueLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadDueQueue(); }, [loadDueQueue]);
  useEffect(() => { void loadTopicTitles(); }, [loadTopicTitles]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "SELECT") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && filtersOpen) setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  const misconceptionOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const item of items) {
      const parsed = parseMisconception(item);
      if (parsed) values.set(parsed.id, parsed.label);
    }
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const lessonOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const item of items) {
      if (item.lesson_id) values.set(item.lesson_id, item.lesson_title || (item.lesson_no ? `${labels.lesson} ${item.lesson_no}` : compactId(item.lesson_id)));
    }
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items, labels.lesson]);

  const difficultyOptions = useMemo(() => [...new Set(items.map((item) => item.difficulty).filter(Boolean) as string[])], [items]);

  const timeCounts = useMemo(() => ({
    all: items.length,
    today: items.filter((item) => matchesTime(item, "today")).length,
    week: items.filter((item) => matchesTime(item, "week")).length,
    later: items.filter((item) => matchesTime(item, "later")).length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(locale === "fa" ? "fa" : "en");
    const minimumRepeat = repeat === "ALL" ? 0 : Number(repeat);
    let result = items.filter((item) => {
      if (!matchesTime(item, timeTab)) return false;
      if (priority !== "ALL" && displayPriority(item) !== priority) return false;
      if (!matchesDue(item, dueFilter)) return false;
      if (minimumRepeat && repeatCount(item) < minimumRepeat) return false;
      if (misconception !== "ALL" && parseMisconception(item)?.id !== misconception) return false;
      if (lesson !== "ALL" && item.lesson_id !== lesson) return false;
      if (difficulty !== "ALL" && item.difficulty !== difficulty) return false;
      if (q) {
        const topicTitle = resolvedTopicTitle(item, locale, topicTitles, labels);
        const haystack = [item.title, item.group_key, item.lesson_title, topicTitle, item.misconception_label].filter(Boolean).join(" ").toLocaleLowerCase(locale === "fa" ? "fa" : "en");
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (sort === "repeat") result = [...result].sort((a, b) => repeatCount(b) - repeatCount(a) || a.title.localeCompare(b.title));
    return result;
  }, [difficulty, dueFilter, items, labels, lesson, locale, misconception, priority, repeat, search, sort, timeTab, topicTitles]);

  const visibleIds = useMemo(() => new Set(filtered.map((item) => item.id)), [filtered]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.id));
  const priorities = useMemo(() => {
    const result = {HIGH: 0, MEDIUM: 0, LOW: 0};
    for (const item of items) result[displayPriority(item)] += 1;
    return result;
  }, [items]);
  const totalPriorities = Math.max(1, priorities.HIGH + priorities.MEDIUM + priorities.LOW);
  const highPct = (priorities.HIGH / totalPriorities) * 100;
  const mediumPct = (priorities.MEDIUM / totalPriorities) * 100;
  const dueTodayCount = items.filter((item) => matchesTime(item, "today")).length;
  const waitingCount = Math.max(0, items.length - dueTodayCount);
  const firstDueItem = dueItems[0] ?? null;

  const clearFilters = () => {
    setPriority("ALL"); setDueFilter("ALL"); setMisconception("ALL"); setLesson("ALL");
    setDifficulty("ALL"); setRepeat("ALL"); setSearch(""); setTimeTab("all");
  };

  const setMarked = async (targets: ApiAwareReview[], marked: boolean) => {
    const supported = targets.filter((item) => item.kind === "MISTAKE");
    if (!supported.length) { setActionMessage(labels.bulkMistakeOnly); return; }
    setActionMessage(null);
    setBusyIds((current) => new Set([...current, ...supported.map((item) => item.id)]));
    const results = await Promise.allSettled(supported.map((item) => apiRequest(`/api/backend/reviews/${item.id}/mark`, {method: "PUT", body: JSON.stringify({marked})})));
    const succeeded = new Set(supported.filter((_, index) => results[index]?.status === "fulfilled").map((item) => item.id));
    setItems((current) => current.map((item) => succeeded.has(item.id) ? {...item, marked} : item));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) setActionMessage(isFa ? `${failed.toLocaleString("fa-IR")} مورد به‌روزرسانی نشد.` : `${failed} item(s) could not be updated.`);
    else if (targets.length !== supported.length) setActionMessage(labels.bulkMistakeOnly);
    setBusyIds((current) => { const next = new Set(current); supported.forEach((item) => next.delete(item.id)); return next; });
  };

  const toggleSelected = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectVisible = () => setSelected((current) => { const next = new Set(current); if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id)); else visibleIds.forEach((id) => next.add(id)); return next; });
  const selectedItems = items.filter((item) => selected.has(item.id));
  const firstSelectedItem = selectedItems[0];

  if (loading && !items.length) {
    return <div className={styles.page} dir={isFa ? "rtl" : "ltr"}><div className={styles.loadingShell} role="status" aria-live="polite"><div className={styles.skeletonTitle}/><div className={styles.skeletonLine}/><div className={styles.loadingGrid}><div className={styles.skeletonPanel}/><div className={styles.skeletonPanel}/><div className={styles.skeletonPanel}/></div><span className="visually-hidden">{labels.loading}</span></div></div>;
  }

  if (error && !items.length) {
    return <div className={styles.page} dir={isFa ? "rtl" : "ltr"}><section className={styles.stateCard} role="alert"><span className={styles.stateIcon}><Icon name="info" size={24}/></span><h1>{labels.error}</h1><p>{error.message}</p><button type="button" className={styles.primaryButton} onClick={() => void load()}>{labels.retry}</button>{error.requestId ? <small>Request ID: {error.requestId}</small> : null}</section></div>;
  }

  return (
    <div className={styles.page} dir={isFa ? "rtl" : "ltr"}>
      <div className={styles.shell}>
        <aside className={styles.leftRail} aria-label={labels.navTitle}>
          <section className={styles.railCard}>
            <h2>{labels.navTitle}</h2>
            <nav className={styles.queueNav}>
              {([[
                "inbox", "inbox", labels.inbox], ["mistakes", "mistake", labels.mistakes], ["spaced", "clock", labels.spaced], ["saved", "bookmark", labels.saved], ["corrected", "check", labels.corrected],
              ] as const).map(([value, icon, label]) => (
                <button key={value} type="button" className={`${styles.navItem} ${mode === value ? styles.navItemActive : ""}`} onClick={() => setMode(value)} aria-current={mode === value ? "page" : undefined}>
                  <span className={styles.navIcon}><Icon name={icon}/></span><span>{label}</span><span className={styles.navCount}>{mode === value ? items.length : ""}</span>
                </button>
              ))}
            </nav>
            <div className={styles.howCard}><span className={styles.howIcon}><Icon name="layers"/></span><h3>{labels.howTitle}</h3><p>{labels.howBody}</p><Link href={`/${locale}/progress`} className={styles.textLink}>{labels.learnMore}<Icon name="chevron" size={15}/></Link></div>
          </section>
        </aside>

        <main className={styles.main}>
          <header className={styles.pageHeader}>
            <div><p className={styles.eyebrow}>{labels.eyebrow}</p><h1>{labels.title}</h1><p>{labels.subtitle}</p></div>
            <div className={styles.headerTools}>
              <label className={styles.searchBox}><Icon name="search"/><input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><kbd>/</kbd></label>
              <button type="button" className={styles.filterButton} onClick={() => setFiltersOpen(true)} aria-label={labels.filterPanelOpen}><Icon name="filter"/>{labels.filters}</button>
            </div>
          </header>

          <div style={{display: "flex", inlineSize: "100%", marginBlockEnd: "10px"}}>
            {firstDueItem ? (
              <Link
                className={styles.primaryButton}
                style={{inlineSize: "100%", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px"}}
                href={`/${locale}/review/${firstDueItem.id}?mode=due&fresh=1`}
              >
                {labels.startDue} ({dueItems.length.toLocaleString(isFa ? "fa-IR" : "en-CA")}) <Icon name="chevron" size={16}/>
              </Link>
            ) : dueQueueError ? (
              <button
                type="button"
                className={styles.primaryButton}
                style={{inlineSize: "100%"}}
                onClick={() => void loadDueQueue()}
              >
                {labels.dueLoadError}
              </button>
            ) : (
              <span className={styles.loadedNote} style={{inlineSize: "100%", textAlign: "center", paddingBlock: "8px"}}>
                {dueQueueLoading ? labels.loading : labels.noDue}
              </span>
            )}
          </div>

          <div className={styles.tabs} role="tablist" aria-label={isFa ? "بازه زمانی مرور" : "Review time window"}>
            {([ ["all", labels.all, timeCounts.all], ["today", labels.today, timeCounts.today], ["week", labels.week, timeCounts.week], ["later", labels.later, timeCounts.later] ] as const).map(([value, label, count]) => (
              <button key={value} role="tab" type="button" aria-selected={timeTab === value} className={timeTab === value ? styles.tabActive : ""} onClick={() => setTimeTab(value)}>{label} <span>({count.toLocaleString(isFa ? "fa-IR" : "en-CA")})</span></button>
            ))}
          </div>

          <section className={styles.listPanel} aria-label={labels.inbox}>
            <div className={styles.listToolbar}>
              <label className={styles.selectAll}><input type="checkbox" checked={allVisibleSelected} onChange={selectVisible}/><span>{labels.selectVisible}</span></label>
              <span className={styles.loadedNote}>{filtered.length.toLocaleString(isFa ? "fa-IR" : "en-CA")} {labels.itemCount}</span>
              <label className={styles.sortControl}><span>{labels.sort}</span><select value={sort} onChange={(event) => setSort(event.target.value as SortChoice)}><option value="due_at">{labels.sourceOrder}</option><option value="-due_at">{labels.newestDue}</option><option value="repeat">{labels.repeatSort}</option></select></label>
            </div>

            {selected.size > 0 ? <div className={styles.bulkBar} role="region" aria-label={isFa ? "اقدامات گروهی" : "Bulk actions"}><strong>{selected.size.toLocaleString(isFa ? "fa-IR" : "en-CA")} {labels.selected}</strong><div><button type="button" onClick={() => void setMarked(selectedItems, true)}><Icon name="bookmark" size={16}/>{labels.bulkMark}</button><button type="button" onClick={() => void setMarked(selectedItems, false)}>{labels.bulkUnmark}</button>{firstSelectedItem ? <Link href={`/${locale}/review/${firstSelectedItem.id}?mode=single&fresh=1`}>{labels.bulkOpen}</Link> : null}<button type="button" onClick={() => setSelected(new Set())}>{labels.clearSelection}</button></div></div> : null}
            {actionMessage ? <p className={styles.actionMessage} role="status">{actionMessage}</p> : null}
            {error ? <div className={styles.inlineError} role="alert"><span>{error.message}</span><button type="button" onClick={() => void load()}>{labels.retry}</button></div> : null}

            <div className={styles.columnHeader} aria-hidden="true"><span>{labels.priority}</span><span>{labels.nextDue}</span><span>{labels.topic}</span><span>{labels.lesson}</span><span>{labels.details}</span><span>{labels.lastError}</span></div>

            {filtered.length ? (
              <div className={styles.reviewList}>
                {filtered.map((item) => {
                  const currentPriority = displayPriority(item);
                  const misconceptionData = parseMisconception(item);
                  const topicTitle = resolvedTopicTitle(item, locale, topicTitles, labels);
                  const isBusy = busyIds.has(item.id);
                  const mastery = typeof item.mastery_score_pct === "number" ? Math.max(0, Math.min(100, item.mastery_score_pct)) : null;
                  return (
                    <article className={`${styles.reviewRow} ${selected.has(item.id) ? styles.reviewRowSelected : ""}`} key={item.id}>
                      <div className={styles.rowSelect}><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} aria-label={`${labels.selected}: ${item.title}`}/></div>
                      <div className={`${styles.priorityBadge} ${styles[`priority${currentPriority}`]}`}><span>{currentPriority === "HIGH" ? labels.high : currentPriority === "MEDIUM" ? labels.medium : labels.low}</span><i aria-hidden="true"><b/><b/><b/></i></div>
                      <div className={styles.dueCell}><strong>{dueLabel(item, locale, labels)}</strong>{item.due_at ? <time dateTime={item.due_at}>{new Date(item.due_at).toLocaleDateString(isFa ? "fa-IR" : "en-CA", {month: "short", day: "numeric"})}</time> : <small>{statusLabel(item, labels)}</small>}</div>
                      <div className={styles.topicCell}><strong dir="auto">{topicTitle}</strong><small>{item.kind === "MISTAKE" ? labels.mistake : labels.srs}</small></div>
                      <div className={styles.lessonCell}>{item.lesson_no ? <><strong>{labels.lesson} {item.lesson_no}</strong><small dir="auto">{item.lesson_title || ""}</small></> : <><strong>—</strong><small title={labels.lessonUnavailable}>{labels.lessonFilter}</small></>}</div>
                      <div className={styles.detailCell}><strong>{item.kind === "MISTAKE" ? `${labels.repeat}: ${repeatCount(item).toLocaleString(isFa ? "fa-IR" : "en-CA")}` : statusLabel(item, labels)}</strong><small>{mastery !== null ? `${labels.mastery}: ${Math.round(mastery)}%` : `${labels.mastery}: —`}</small></div>
                      <div className={styles.titleCell}><div className={styles.titleTop}><span className={`${styles.kindDot} ${item.kind === "MISTAKE" ? styles.kindMistake : styles.kindSpaced}`}/><span className={styles.kindLabel}>{item.kind === "MISTAKE" ? labels.mistake : labels.srs}</span>{item.marked ? <span className={styles.markedPill}><Icon name="bookmark" size={13}/>{labels.marked}</span> : null}</div><h2 dir="auto">{item.title}</h2><p dir="auto">{misconceptionData ? `Misconception: ${compactId(misconceptionData.label)}` : item.group_key ? compactId(item.group_key) : statusLabel(item, labels)}</p></div>
                      <div className={styles.rowActions}><Link className={styles.startButton} href={`/${locale}/review/${item.id}?mode=single&fresh=1`}>{labels.start}<Icon name="chevron" size={16}/></Link>{item.kind === "MISTAKE" ? <button type="button" className={styles.iconButton} disabled={isBusy} onClick={() => void setMarked([item], !item.marked)} aria-label={item.marked ? labels.unmark : labels.mark}><Icon name="bookmark" size={17}/></button> : null}<Link href={`/${locale}/review/${item.id}?mode=single&fresh=1`} className={styles.iconButton} aria-label={labels.menuLabel}><Icon name="dots" size={18}/></Link></div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyState}><span><Icon name={items.length ? "filter" : "inbox"} size={28}/></span><h2>{items.length ? labels.filteredEmpty : labels.empty}</h2><p>{items.length ? labels.filteredBody : labels.emptyBody}</p>{items.length ? <button type="button" onClick={clearFilters}>{labels.clearFilters}</button> : <Link href={`/${locale}/tests/new`}>{isFa ? "شروع تمرین" : "Start practice"}</Link>}</div>
            )}
            <p className={styles.contractNote}>{labels.completeQueue}</p>
          </section>
        </main>

        <aside className={`${styles.rightRail} ${filtersOpen ? styles.rightRailOpen : ""}`} aria-label={labels.filterTitle}>
          <button type="button" className={styles.drawerClose} onClick={() => setFiltersOpen(false)} aria-label={labels.filterPanelClose}><Icon name="close"/></button>
          <section className={styles.summaryCard}>
            <h2>{labels.summary}</h2>
            <div className={styles.summaryTop}><div className={styles.donut} style={{"--high": `${highPct}%`, "--medium": `${highPct + mediumPct}%`} as CSSProperties}><div><strong>{items.length.toLocaleString(isFa ? "fa-IR" : "en-CA")}</strong><span>{labels.questions}</span></div></div><dl><div><dt><i className={styles.legendHigh}/>{labels.high}</dt><dd>{priorities.HIGH.toLocaleString(isFa ? "fa-IR" : "en-CA")}</dd></div><div><dt><i className={styles.legendMedium}/>{labels.medium}</dt><dd>{priorities.MEDIUM.toLocaleString(isFa ? "fa-IR" : "en-CA")}</dd></div><div><dt><i className={styles.legendLow}/>{labels.low}</dt><dd>{priorities.LOW.toLocaleString(isFa ? "fa-IR" : "en-CA")}</dd></div></dl></div>
            <div className={styles.summaryStats}><div><strong>{dueTodayCount.toLocaleString(isFa ? "fa-IR" : "en-CA")}</strong><span>{labels.dueToday}</span></div><div><strong>{waitingCount.toLocaleString(isFa ? "fa-IR" : "en-CA")}</strong><span>{labels.waiting}</span></div></div>
            <p className={styles.priorityNote}>{labels.uiPriorityNote}</p>
          </section>

          <section className={styles.filtersCard}>
            <div className={styles.filterHeading}><h2>{labels.filterTitle}</h2><Icon name="filter"/></div>
            <label><span>{labels.reviewType}</span><select value={mode} onChange={(event) => setMode(event.target.value as QueueMode)}><option value="inbox">{labels.allValues}</option><option value="mistakes">{labels.mistakes}</option><option value="spaced">{labels.spaced}</option><option value="saved">{labels.saved}</option><option value="corrected">{labels.corrected}</option></select></label>
            <label><span>{labels.nextDue}</span><select value={dueFilter} onChange={(event) => setDueFilter(event.target.value as DueFilter)}><option value="ALL">{labels.allValues}</option><option value="NOW">{labels.today}</option><option value="WEEK">{labels.week}</option><option value="LATER">{labels.later}</option><option value="NO_DATE">{labels.noDate}</option></select></label>
            <label><span>{labels.priority}</span><select value={priority} onChange={(event) => setPriority(event.target.value as PriorityFilter)}><option value="ALL">{labels.allValues}</option><option value="HIGH">{labels.high}</option><option value="MEDIUM">{labels.medium}</option><option value="LOW">{labels.low}</option></select></label>
            <label><span>{labels.misconception}</span><select value={misconception} onChange={(event) => setMisconception(event.target.value)} disabled={!misconceptionOptions.length}><option value="ALL">{labels.allValues}</option>{misconceptionOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
            <label title={!lessonOptions.length ? labels.lessonUnavailable : undefined}><span>{labels.lessonFilter}</span><select value={lesson} onChange={(event) => setLesson(event.target.value)} disabled={!lessonOptions.length}><option value="ALL">{labels.allValues}</option>{lessonOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label title={!difficultyOptions.length ? labels.difficultyUnavailable : undefined}><span>{labels.difficulty}</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} disabled={!difficultyOptions.length}><option value="ALL">{labels.allValues}</option>{difficultyOptions.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
            <label><span>{labels.repetition}</span><select value={repeat} onChange={(event) => setRepeat(event.target.value as RepeatFilter)}><option value="ALL">{labels.allValues}</option><option value="2">2+</option><option value="3">3+</option><option value="5">5+</option></select></label>
            <button type="button" className={styles.clearButton} onClick={clearFilters}><Icon name="refresh" size={16}/>{labels.clearFilters}</button>
            {!lessonOptions.length || !difficultyOptions.length ? <p className={styles.contractWarning}><Icon name="info" size={15}/>{!lessonOptions.length ? labels.lessonUnavailable : labels.difficultyUnavailable}</p> : null}
          </section>
          <p className={styles.offlineHint}>{labels.offlineHint}</p>
        </aside>
        {filtersOpen ? <button className={styles.drawerBackdrop} aria-label={labels.filterPanelClose} onClick={() => setFiltersOpen(false)}/> : null}
      </div>
    </div>
  );
}

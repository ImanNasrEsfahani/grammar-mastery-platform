"use client";

import {useEffect, useState} from "react";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {StatusPanel} from "@/components/ui/StatusPanel";
import {ApiError, apiRequest} from "@/lib/api/client";
import type {DashboardEnvelope} from "@/lib/api/types";
import {practiceQueryDefaults, readPreferences} from "@/lib/preferences";
import type {Locale} from "@/lib/i18n";
import {TestBuilder} from "./TestBuilder";

export type BuilderSearchParams = Record<string, string | string[] | undefined>;

type PracticeDefaults = {
  mode: string;
  count: string;
  difficulty: string;
};

const SESSION_HANDOFF_KEY = "gmp-test-builder-handoff-v1";
const WEAKNESS_CONFIDENCE_GATE = 0.45;
const DIFFICULTY_PRESETS = ["all", "easy", "medium", "hard", "veryHard"] as const;
type DifficultyPreset = (typeof DIFFICULTY_PRESETS)[number];

function paramsFromObject(values: BuilderSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(values)) {
    if (Array.isArray(raw)) {
      for (const value of raw) params.append(key, value);
    } else if (raw !== undefined) {
      params.set(key, raw);
    }
  }
  return params;
}

function lessonIdsFromParams(params: URLSearchParams): string[] {
  const direct = params.getAll("lesson");
  const legacy = params.get("lessons")?.split(",") ?? [];
  return [...new Set([...direct, ...legacy].map((value) => value.trim()).filter(Boolean))];
}

export function weakLessonIdsFromDashboard(dashboard: DashboardEnvelope): string[] {
  return dashboard.data.mastery
    .filter((item) =>
      item.scope_type === "LESSON"
      && item.mastery_band === "WEAK"
      && item.confidence >= WEAKNESS_CONFIDENCE_GATE
      && item.coverage_ratio > 0
      && Boolean(item.scope_id)
    )
    .sort((a, b) => a.mastery_score_pct - b.mastery_score_pct)
    .flatMap((item) => item.scope_id ? [item.scope_id] : []);
}

function resolvedCount(params: URLSearchParams, defaults: PracticeDefaults): number {
  const requested = Number(params.get("count") ?? defaults.count);
  return Number.isInteger(requested) && requested >= 1 && requested <= 100 ? requested : 20;
}

function resolvedDifficulty(params: URLSearchParams, defaults: PracticeDefaults): DifficultyPreset {
  const candidate = params.get("difficulty") ?? defaults.difficulty;
  return DIFFICULTY_PRESETS.includes(candidate as DifficultyPreset)
    ? candidate as DifficultyPreset
    : "all";
}

/**
 * Canonicalize the builder URL before TestBuilder mounts.
 *
 * A specific lesson in the URL is authoritative and always means
 * `scope=lessons`. A related group is used only when no lesson selector exists.
 * This lets TestBuilder's existing URL hydration activate the correct mode,
 * scope card/icon, lesson checkbox(es), count and difficulty option.
 */
export function normalizeBuilderSearchParams(
  params: URLSearchParams,
  defaults: PracticeDefaults,
): boolean {
  let changed = false;

  const lessonIds = lessonIdsFromParams(params);
  if (lessonIds.length) {
    const currentDirect = params.getAll("lesson");
    const canonicalDirect = lessonIds;
    const directIsCanonical = currentDirect.length === canonicalDirect.length
      && currentDirect.every((value, index) => value === canonicalDirect[index])
      && !params.has("lessons");

    if (!directIsCanonical) {
      params.delete("lesson");
      params.delete("lessons");
      for (const lessonId of lessonIds) params.append("lesson", lessonId);
      changed = true;
    }

    if (params.get("scope") !== "lessons") {
      params.set("scope", "lessons");
      changed = true;
    }
    if (params.has("group")) {
      params.delete("group");
      changed = true;
    }
  } else {
    const group = params.get("group")?.trim();
    if (group) {
      if (params.get("group") !== group) {
        params.set("group", group);
        changed = true;
      }
      if (params.get("scope") !== "related") {
        params.set("scope", "related");
        changed = true;
      }
    } else if (!params.has("scope")) {
      params.set("scope", "all");
      changed = true;
    }
  }

  if (!params.has("mode")) {
    params.set("mode", defaults.mode);
    changed = true;
  }
  if (!params.has("count")) {
    params.set("count", defaults.count);
    changed = true;
  }
  if (!params.has("difficulty")) {
    params.set("difficulty", defaults.difficulty);
    changed = true;
  }

  return changed;
}

export function PreferencesAwareTestBuilder({
  locale,
  initialSearchParams = {},
}: {
  locale: Locale;
  initialSearchParams?: BuilderSearchParams;
}) {
  const [ready, setReady] = useState(false);
  const [focusError, setFocusError] = useState<ApiError | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let active = true;

    async function prepareBuilder() {
      setReady(false);
      setFocusError(null);

      try {
        const browserSearch = window.location.search;
        const params = browserSearch
          ? new URLSearchParams(browserSearch)
          : paramsFromObject(initialSearchParams);
        const weaknessFocus = params.get("focus") === "weakness";
        const isRestoring = params.get("restore") === "1" || params.get("template") === "1";
        const defaults = practiceQueryDefaults(readPreferences(locale));

        if (weaknessFocus) {
          const dashboard = await apiRequest<DashboardEnvelope>("/api/backend/dashboard");
          if (!dashboard) {
            throw new ApiError({status: 502, code: "EMPTY_DASHBOARD", message: "Dashboard data was empty."});
          }

          const weakLessonIds = weakLessonIdsFromDashboard(dashboard);
          const count = resolvedCount(params, defaults);
          const difficultyPreset = resolvedDifficulty(params, defaults);

          // Keep personal weakness IDs out of the URL/history. TestBuilder already
          // supports a session handoff for exact scoped selections.
          window.sessionStorage.setItem(SESSION_HANDOFF_KEY, JSON.stringify({
            mode: "adaptive",
            scopeChoice: "lessons",
            selectedLessonIds: weakLessonIds,
            selectedGroupId: "",
            count,
            difficultyPreset,
            typePreset: "mixed",
            advancedOpen: false,
          }));

          params.set("focus", "weakness");
          params.set("restore", "1");
          params.set("mode", "adaptive");
          params.set("count", String(count));
          params.set("difficulty", difficultyPreset);
          params.delete("scope");
          params.delete("lesson");
          params.delete("lessons");
          params.delete("group");

          const query = params.toString();
          const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
          window.history.replaceState(window.history.state, "", nextUrl);
          return;
        }

        if (!isRestoring) {
          const changed = normalizeBuilderSearchParams(params, defaults);

          if (changed) {
            const query = params.toString();
            const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
            window.history.replaceState(window.history.state, "", nextUrl);
          }
        }
      } catch (caught) {
        if (active) {
          setFocusError(caught instanceof ApiError
            ? caught
            : new ApiError({status: 0, code: "NETWORK_ERROR", message: "Weakness focus preparation failed."}));
        }
      } finally {
        if (active) setReady(true);
      }
    }

    void prepareBuilder();
    return () => { active = false; };
  }, [initialSearchParams, locale, retryNonce]);

  if (!ready) {
    return <LoadingCard label={locale === "fa" ? "در حال آماده‌سازی تمرین نقاط ضعف" : "Preparing weakness practice"} />;
  }

  if (focusError) {
    return (
      <StatusPanel
        title={locale === "fa" ? "بارگذاری نقاط ضعف ناموفق بود" : "Weakness focus could not be prepared"}
        tone="danger"
        requestId={focusError.requestId}
        action={{
          label: locale === "fa" ? "تلاش دوباره" : "Retry",
          onClick: () => setRetryNonce((value) => value + 1),
        }}
      >
        <p>
          {locale === "fa"
            ? "برای جلوگیری از انتخاب اشتباه همه درس‌ها، تا دریافت داده معتبر تمرین ساخته نمی‌شود."
            : "To avoid accidentally selecting every lesson, the builder stays blocked until valid weakness data is loaded."}
        </p>
      </StatusPanel>
    );
  }

  return <TestBuilder locale={locale} />;
}

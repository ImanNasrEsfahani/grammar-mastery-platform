"use client";

import {useEffect, useState} from "react";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {practiceQueryDefaults, readPreferences} from "@/lib/preferences";
import type {Locale} from "@/lib/i18n";
import {TestBuilder} from "./TestBuilder";

export type BuilderSearchParams = Record<string, string | string[] | undefined>;

type PracticeDefaults = {
  mode: string;
  count: string;
  difficulty: string;
};

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

  useEffect(() => {
    try {
      const browserSearch = window.location.search;
      const params = browserSearch
        ? new URLSearchParams(browserSearch)
        : paramsFromObject(initialSearchParams);
      const isRestoring = params.get("restore") === "1" || params.get("template") === "1";

      if (!isRestoring) {
        const defaults = practiceQueryDefaults(readPreferences(locale));
        const changed = normalizeBuilderSearchParams(params, defaults);

        if (changed) {
          const query = params.toString();
          const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
          window.history.replaceState(window.history.state, "", nextUrl);
        }
      }
    } finally {
      setReady(true);
    }
  }, [initialSearchParams, locale]);

  if (!ready) {
    return <LoadingCard label={locale === "fa" ? "در حال اعمال ترجیحات تمرین" : "Applying practice preferences"} />;
  }

  return <TestBuilder locale={locale} />;
}

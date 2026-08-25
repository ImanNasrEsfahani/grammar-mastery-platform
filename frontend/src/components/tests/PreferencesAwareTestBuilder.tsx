"use client";

import {useEffect, useState} from "react";
import {LoadingCard} from "@/components/ui/LoadingCard";
import {practiceQueryDefaults, readPreferences} from "@/lib/preferences";
import type {Locale} from "@/lib/i18n";
import {TestBuilder} from "./TestBuilder";

export function PreferencesAwareTestBuilder({locale}: {locale: Locale}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const isRestoring = params.get("restore") === "1" || params.get("template") === "1";

      if (!isRestoring) {
        const defaults = practiceQueryDefaults(readPreferences(locale));
        let changed = false;
        if (!params.has("mode")) { params.set("mode", defaults.mode); changed = true; }
        if (!params.has("count")) { params.set("count", defaults.count); changed = true; }
        if (!params.has("difficulty")) { params.set("difficulty", defaults.difficulty); changed = true; }

        if (changed) {
          const query = params.toString();
          const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
          window.history.replaceState(window.history.state, "", nextUrl);
        }
      }
    } finally {
      setReady(true);
    }
  }, [locale]);

  if (!ready) {
    return <LoadingCard label={locale === "fa" ? "در حال اعمال ترجیحات تمرین" : "Applying practice preferences"} />;
  }

  return <TestBuilder locale={locale} />;
}

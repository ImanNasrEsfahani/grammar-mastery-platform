"use client";

import {useState} from "react";
import {useRouter} from "next/navigation";
import {LoadingButtonContent} from "@/components/ui/SkeletonSystem";
import type {Locale} from "@/lib/i18n";

export function LogoutButton({locale, label}: {locale: Locale; label: string}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/session/logout", {
        method: "POST",
        cache: "no-store",
      });
    } finally {
      router.replace(`/${locale}/login`);
      router.refresh();
      setBusy(false);
    }
  }

  return (
    <button
      className="button button-quiet"
      type="button"
      onClick={logout}
      disabled={busy}
      aria-busy={busy}
    >
      {busy ? <LoadingButtonContent label={locale === "fa" ? "در حال خروج…" : "Logging out…"} /> : label}
    </button>
  );
}

"use client";

import { useEffect } from "react";
import { sourceSlug } from "../sourceSlug";

type MiniAppEntryRedirectProps = {
  fallbackSlug: string;
};

function normalizeSlug(value: string | null | undefined): string {
  return value ? sourceSlug(value) : "";
}

export function MiniAppEntryRedirect({ fallbackSlug }: MiniAppEntryRedirectProps) {
  useEffect(() => {
    const telegramWindow = window as Window & {
      Telegram?: {
        WebApp?: {
          initDataUnsafe?: {
            start_param?: string;
          };
          ready?: () => void;
          expand?: () => void;
        };
      };
    };
    const params = new URLSearchParams(window.location.search);
    const webApp = telegramWindow.Telegram?.WebApp;

    webApp?.ready?.();
    webApp?.expand?.();

    const slug = normalizeSlug(
      webApp?.initDataUnsafe?.start_param ||
        params.get("tgWebAppStartParam") ||
        params.get("startapp") ||
        params.get("slug") ||
        fallbackSlug,
    );

    if (!slug) {
      return;
    }

    const target = new URL(`/s/${slug}`, window.location.origin);
    target.search = window.location.search;
    target.hash = window.location.hash;
    window.location.replace(target.toString());
  }, [fallbackSlug]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f2]">
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" aria-label="Loading" role="status" />
    </main>
  );
}

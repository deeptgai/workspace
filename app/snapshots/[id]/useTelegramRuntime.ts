"use client";

import { useEffect, useState } from "react";
import type { TelegramWebApp } from "./TelegramAuthBadge";

export type TelegramRuntime = "unknown" | "browser" | "telegram";

export function useTelegramRuntime(getTelegramWebApp: () => Promise<TelegramWebApp | null>) {
  const [telegramRuntime, setTelegramRuntime] = useState<TelegramRuntime>("unknown");

  useEffect(() => {
    let mounted = true;

    async function detectTelegramRuntime() {
      const directWebApp = window.Telegram?.WebApp;

      if (directWebApp) {
        setTelegramRuntime("telegram");
        return;
      }

      const webApp = await getTelegramWebApp();

      if (!mounted) {
        return;
      }

      setTelegramRuntime(webApp?.initData || webApp?.initDataUnsafe?.user ? "telegram" : "browser");
    }

    detectTelegramRuntime().catch(() => {
      if (mounted) {
        setTelegramRuntime("browser");
      }
    });

    return () => {
      mounted = false;
    };
  }, [getTelegramWebApp]);

  return telegramRuntime;
}

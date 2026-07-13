"use client";

import { useCallback } from "react";
import type { TelegramWebApp } from "./TelegramAuthBadge";

export function useTelegramWebApp() {
  return useCallback(async (): Promise<TelegramWebApp | null> => {
    const globalWebApp = window.Telegram?.WebApp;

    if (globalWebApp?.initData) {
      return globalWebApp;
    }

    const sdk = await import("@twa-dev/sdk");
    const sdkWebApp = sdk.default;

    if (sdkWebApp?.initData) {
      return sdkWebApp;
    }

    return globalWebApp || sdkWebApp || null;
  }, []);
}

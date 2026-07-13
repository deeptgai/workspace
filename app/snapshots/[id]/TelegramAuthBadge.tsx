"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export type TelegramAuthUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramAuthUser;
  };
  openInvoice?: (url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => unknown) => void;
  showAlert?: (message: string, callback?: () => unknown) => void;
};

type TelegramAuthBadgeState =
  | { status: "checking" }
  | { status: "browser" }
  | {
      status: "telegram";
      verified: boolean;
      user: TelegramAuthUser | null;
    }
  | { status: "error"; message: string };

type TelegramAuthBadgeProps = {
  getTelegramWebApp: () => Promise<TelegramWebApp | null>;
  initialTelegramUser?: TelegramAuthUser | null;
  loginUrl: string;
  variant?: "inline" | "hero";
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function TelegramAuthBadge({
  getTelegramWebApp,
  initialTelegramUser,
  loginUrl,
  variant = "inline",
}: TelegramAuthBadgeProps) {
  const [authState, setAuthState] = useState<TelegramAuthBadgeState>(
    initialTelegramUser
      ? { status: "telegram", verified: true, user: initialTelegramUser }
      : { status: "checking" },
  );

  useLayoutEffect(() => {
    if (initialTelegramUser) {
      return;
    }

    const user = window.Telegram?.WebApp?.initDataUnsafe?.user;

    if (user) {
      setAuthState({ status: "telegram", verified: false, user });
    }
  }, [initialTelegramUser]);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        let initData = window.Telegram?.WebApp?.initData || "";

        if (!initData) {
          const webApp = await getTelegramWebApp();

          if (mounted && !initialTelegramUser && webApp?.initDataUnsafe?.user) {
            setAuthState({ status: "telegram", verified: false, user: webApp.initDataUnsafe.user });
          }

          initData = webApp?.initData || "";
        }

        const response = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(initData ? { initData } : {}),
        });
        const payload = await response.json();

        if (!mounted) {
          return;
        }

        if (!response.ok || !payload.ok) {
          setAuthState({ status: "error", message: payload.error || "auth error" });
          return;
        }

        if (payload.mode !== "telegram") {
          setAuthState({ status: "browser" });
          return;
        }

        setAuthState({ status: "telegram", verified: true, user: payload.user ?? null });
      } catch (error) {
        if (mounted) {
          setAuthState({ status: "error", message: error instanceof Error ? error.message : "auth error" });
        }
      }
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, [getTelegramWebApp, initialTelegramUser]);

  const label = (() => {
    if (authState.status === "checking") {
      return "Telegram auth: checking";
    }

    if (authState.status === "browser") {
      return "Telegram auth: browser";
    }

    if (authState.status === "error") {
      return `Telegram auth: ${authState.message}`;
    }

    const user = authState.user;
    const name = user?.username ? `@${user.username}` : [user?.first_name, user?.last_name].filter(Boolean).join(" ");

    return `Telegram auth: ${name || "user"}${user?.id ? ` #${user.id}` : ""}${authState.verified ? "" : " checking"}`;
  })();
  const toneClass = authState.status === "telegram"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : authState.status === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-slate-200 bg-white text-slate-600";
  const shellClass = variant === "hero"
    ? "inline-flex max-w-[min(70vw,360px)] items-center rounded-full border px-3 py-1.5 text-xs font-black shadow-lg backdrop-blur-xl"
    : "inline-flex max-w-full items-center rounded-full border px-3 py-1.5 text-xs font-black shadow-sm";
  const loginClass = variant === "hero"
    ? "inline-flex max-w-[min(70vw,360px)] items-center rounded-full border border-white/20 bg-white/95 px-3 py-1.5 text-xs font-black text-slate-800 shadow-lg backdrop-blur-xl transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
    : "inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800";

  if (authState.status === "browser") {
    return (
      <a
        className={loginClass}
        href={loginUrl}
      >
        Войти через Telegram
      </a>
    );
  }

  return (
    <div className={`${shellClass} ${toneClass}`}>
      <span className="truncate">{label}</span>
    </div>
  );
}

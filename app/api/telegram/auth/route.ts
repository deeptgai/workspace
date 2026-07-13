import { NextResponse } from "next/server";
import {
  createTelegramSessionToken,
  getTelegramSessionFromCookieHeader,
  TELEGRAM_WEB_APP_SESSION_COOKIE,
  telegramSessionMaxAgeSeconds,
} from "../../../../src/telegram/webAppSession";
import {
  telegramInitDataMaxAgeSeconds,
  verifyTelegramWebAppInitData,
} from "../../../../src/telegram/webAppAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TelegramAuthRequest = {
  initData?: string;
};

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const maxAgeSeconds = telegramInitDataMaxAgeSeconds();

  if (!token) {
    return NextResponse.json({ ok: false, mode: "server_misconfigured", error: "Missing TELEGRAM_BOT_TOKEN" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as TelegramAuthRequest | null;
  const initData = body?.initData?.trim();

  if (!initData) {
    const session = getTelegramSessionFromCookieHeader(request.headers.get("cookie"));

    if (session) {
      return NextResponse.json({ ok: true, mode: "telegram", user: session.user, session: true });
    }

    return NextResponse.json({ ok: true, mode: "browser", user: null });
  }

  try {
    const verified = verifyTelegramWebAppInitData(initData, token, { maxAgeSeconds });

    if (!verified) {
      return NextResponse.json({ ok: false, mode: "telegram", error: "Invalid Telegram initData signature" }, { status: 401 });
    }

    const response = NextResponse.json({
      ok: true,
      mode: "telegram",
      user: verified.user,
      authDate: verified.authDate,
      startParam: verified.startParam,
    });

    if (verified.user) {
      response.cookies.set(TELEGRAM_WEB_APP_SESSION_COOKIE, createTelegramSessionToken(verified.user), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: telegramSessionMaxAgeSeconds(),
        path: "/",
      });
    }

    return response;
  } catch {
    return NextResponse.json({ ok: false, mode: "telegram", error: "Could not parse Telegram initData" }, { status: 400 });
  }
}

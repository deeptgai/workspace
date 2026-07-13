import { NextResponse } from "next/server";
import { verifyTelegramLoginWidgetAuth } from "../../../../../src/telegram/loginWidgetAuth";
import {
  createTelegramSessionToken,
  TELEGRAM_WEB_APP_SESSION_COOKIE,
  telegramSessionMaxAgeSeconds,
} from "../../../../../src/telegram/webAppSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/s";
  }

  return value;
}

export async function GET(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  if (!token) {
    return NextResponse.redirect(new URL(`${returnTo}?telegram_login=server_misconfigured`, url.origin));
  }

  const authParams = new URLSearchParams(url.searchParams);
  authParams.delete("returnTo");
  const auth = verifyTelegramLoginWidgetAuth(authParams, token);

  if (!auth) {
    return NextResponse.redirect(new URL(`${returnTo}?telegram_login=invalid`, url.origin));
  }

  const redirectUrl = new URL(returnTo, url.origin);
  redirectUrl.searchParams.set("telegram_login", "ok");

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(TELEGRAM_WEB_APP_SESSION_COOKIE, createTelegramSessionToken(auth.user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: telegramSessionMaxAgeSeconds(),
    path: "/",
  });

  return response;
}

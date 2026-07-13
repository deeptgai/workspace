import crypto from "node:crypto";
import type { TelegramWebAppUser } from "./webAppAuth.ts";

export const TELEGRAM_WEB_APP_SESSION_COOKIE = "deeptg_tg_session";
const DEFAULT_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type TelegramWebAppSession = {
  user: TelegramWebAppUser;
  expiresAt: number;
};

function sessionSecret() {
  const secret = process.env.TELEGRAM_SESSION_SECRET || process.env.TELEGRAM_BOT_TOKEN;

  if (!secret) {
    throw new Error("Missing TELEGRAM_SESSION_SECRET or TELEGRAM_BOT_TOKEN");
  }

  return secret;
}

export function telegramSessionMaxAgeSeconds() {
  const value = Number(process.env.TELEGRAM_SESSION_MAX_AGE_SECONDS || DEFAULT_SESSION_MAX_AGE_SECONDS);

  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SESSION_MAX_AGE_SECONDS;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createTelegramSessionToken(user: TelegramWebAppUser) {
  const session: TelegramWebAppSession = {
    user,
    expiresAt: Math.floor(Date.now() / 1000) + telegramSessionMaxAgeSeconds(),
  };
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

export function verifyTelegramSessionToken(token: string | undefined | null): TelegramWebAppSession | null {
  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload)) as TelegramWebAppSession;

    if (!session.user?.id || !session.expiresAt || session.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export function getTelegramSessionFromCookieHeader(cookieHeader: string | null | undefined) {
  const cookies = new Map(
    (cookieHeader || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [name, ...value] = item.split("=");

        return [name, decodeURIComponent(value.join("="))] as const;
      }),
  );

  return verifyTelegramSessionToken(cookies.get(TELEGRAM_WEB_APP_SESSION_COOKIE));
}

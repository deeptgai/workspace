import crypto from "node:crypto";
import type { TelegramWebAppUser } from "./webAppAuth.ts";

export type TelegramLoginWidgetAuth = {
  authDate: number;
  user: TelegramWebAppUser;
};

export function verifyTelegramLoginWidgetAuth(
  input: URLSearchParams,
  botToken: string,
  options: { maxAgeSeconds?: number } = {},
): TelegramLoginWidgetAuth | null {
  const hash = input.get("hash");

  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(input);
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hash, "hex");

  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  const authDate = Number(params.get("auth_date") || "0");

  if (!Number.isFinite(authDate) || authDate <= 0) {
    return null;
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? 24 * 60 * 60;

  if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;

    if (ageSeconds > maxAgeSeconds) {
      return null;
    }
  }

  const id = Number(params.get("id") || "0");

  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  return {
    authDate,
    user: {
      id,
      first_name: params.get("first_name") || undefined,
      last_name: params.get("last_name") || undefined,
      username: params.get("username") || undefined,
      photo_url: params.get("photo_url") || undefined,
    },
  };
}

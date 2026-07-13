import crypto from "node:crypto";

export type TelegramWebAppUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
};

export type VerifiedTelegramWebAppInitData = {
  authDate: number;
  startParam: string | null;
  user: TelegramWebAppUser | null;
};

export const DEFAULT_INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number } = {},
): VerifiedTelegramWebAppInitData | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
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

  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_INIT_DATA_MAX_AGE_SECONDS;

  if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;

    if (ageSeconds > maxAgeSeconds) {
      return null;
    }
  }

  const userJson = params.get("user");

  return {
    authDate,
    startParam: params.get("start_param"),
    user: userJson ? (JSON.parse(userJson) as TelegramWebAppUser) : null,
  };
}

export function telegramInitDataMaxAgeSeconds() {
  return Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS || DEFAULT_INIT_DATA_MAX_AGE_SECONDS);
}

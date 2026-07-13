import crypto from "node:crypto";

export const TELEGRAM_OIDC_STATE_COOKIE = "deeptg_tg_oidc";
const oidcIssuer = "https://oauth.telegram.org";
const jwksUrl = `${oidcIssuer}/.well-known/jwks.json`;

export type TelegramOidcState = {
  state: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
};

type TelegramTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type TelegramJwks = {
  keys?: Array<crypto.JsonWebKey & { kid?: string }>;
};

type TelegramIdTokenClaims = {
  iss: string;
  aud: string | number;
  sub: string;
  exp: number;
  iat: number;
  id?: number;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  picture?: string;
};

function oidcSecret() {
  const secret = process.env.TELEGRAM_SESSION_SECRET || process.env.TELEGRAM_BOT_TOKEN;

  if (!secret) {
    throw new Error("Missing TELEGRAM_SESSION_SECRET or TELEGRAM_BOT_TOKEN");
  }

  return secret;
}

function randomBase64Url(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return crypto.createHmac("sha256", oidcSecret()).update(payload).digest("base64url");
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/s";
  }

  return value;
}

export function createTelegramOidcState(returnTo: string): { state: TelegramOidcState; cookieValue: string } {
  const state: TelegramOidcState = {
    state: randomBase64Url(24),
    codeVerifier: randomBase64Url(48),
    returnTo: safeReturnTo(returnTo),
    expiresAt: Math.floor(Date.now() / 1000) + 10 * 60,
  };
  const payload = base64UrlEncode(JSON.stringify(state));

  return {
    state,
    cookieValue: `${payload}.${signPayload(payload)}`,
  };
}

export function verifyTelegramOidcState(cookieValue: string | undefined | null, stateValue: string | null) {
  if (!cookieValue || !stateValue) {
    return null;
  }

  const [payload, signature] = cookieValue.split(".");

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
    const state = JSON.parse(base64UrlDecode(payload)) as TelegramOidcState;

    if (state.state !== stateValue || state.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

export function telegramOidcClientConfig() {
  const clientId = process.env.TELEGRAM_LOGIN_CLIENT_ID || process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_CLIENT_ID;
  const clientSecret = process.env.TELEGRAM_LOGIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
  };
}

export function codeChallenge(codeVerifier: string) {
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url");
}

export async function exchangeTelegramOidcCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const config = telegramOidcClientConfig();

  if (!config) {
    throw new Error("Missing TELEGRAM_LOGIN_CLIENT_ID or TELEGRAM_LOGIN_CLIENT_SECRET");
  }

  const response = await fetch(`${oidcIssuer}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: config.clientId,
      code_verifier: input.codeVerifier,
    }),
  });
  const payload = (await response.json()) as TelegramTokenResponse;

  if (!response.ok || !payload.id_token) {
    throw new Error(payload.error_description || payload.error || "Telegram OIDC token exchange failed");
  }

  return payload;
}

export async function verifyTelegramIdToken(idToken: string) {
  const config = telegramOidcClientConfig();

  if (!config) {
    throw new Error("Missing TELEGRAM_LOGIN_CLIENT_ID or TELEGRAM_LOGIN_CLIENT_SECRET");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as { alg?: string; kid?: string };

  if (header.alg !== "RS256" || !header.kid) {
    return null;
  }

  const jwksResponse = await fetch(jwksUrl, { cache: "no-store" });
  const jwks = (await jwksResponse.json()) as TelegramJwks;
  const jwk = jwks.keys?.find((key) => key.kid === header.kid);

  if (!jwk) {
    return null;
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  if (!verifier.verify(crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(encodedSignature, "base64url"))) {
    return null;
  }

  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as TelegramIdTokenClaims;
  const now = Math.floor(Date.now() / 1000);

  if (claims.iss !== oidcIssuer || String(claims.aud) !== String(config.clientId) || claims.exp <= now) {
    return null;
  }

  return claims;
}

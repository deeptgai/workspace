import { NextResponse } from "next/server";
import {
  codeChallenge,
  createTelegramOidcState,
  safeReturnTo,
  TELEGRAM_OIDC_STATE_COOKIE,
  telegramOidcClientConfig,
} from "../../../../../src/telegram/oidc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");

  return `${proto}://${host}`;
}

export async function GET(request: Request) {
  const config = telegramOidcClientConfig();
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  if (!config) {
    return NextResponse.redirect(new URL(`${returnTo}?telegram_login=missing_oidc_config`, origin));
  }

  const { state, cookieValue } = createTelegramOidcState(returnTo);
  const redirectUri = `${origin}/api/telegram/oidc/callback`;
  const authUrl = new URL("https://oauth.telegram.org/auth");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile");
  authUrl.searchParams.set("state", state.state);
  authUrl.searchParams.set("code_challenge", codeChallenge(state.codeVerifier));
  authUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(TELEGRAM_OIDC_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/",
  });

  return response;
}

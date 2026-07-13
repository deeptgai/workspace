import { NextResponse } from "next/server";
import {
  exchangeTelegramOidcCode,
  TELEGRAM_OIDC_STATE_COOKIE,
  verifyTelegramIdToken,
  verifyTelegramOidcState,
} from "../../../../../src/telegram/oidc";
import {
  createTelegramSessionToken,
  TELEGRAM_WEB_APP_SESSION_COOKIE,
  telegramSessionMaxAgeSeconds,
} from "../../../../../src/telegram/webAppSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");

  return `${proto}://${host}`;
}

function cookieValue(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateValue = url.searchParams.get("state");
  const state = verifyTelegramOidcState(
    cookieValue(request.headers.get("cookie"), TELEGRAM_OIDC_STATE_COOKIE),
    stateValue,
  );
  const origin = requestOrigin(request);
  const returnTo = state?.returnTo || "/s";

  if (!code || !state) {
    return NextResponse.redirect(new URL(`${returnTo}?telegram_login=invalid_state`, origin));
  }

  try {
    const token = await exchangeTelegramOidcCode({
      code,
      codeVerifier: state.codeVerifier,
      redirectUri: `${origin}/api/telegram/oidc/callback`,
    });
    const claims = token.id_token ? await verifyTelegramIdToken(token.id_token) : null;

    if (!claims) {
      return NextResponse.redirect(new URL(`${returnTo}?telegram_login=invalid_token`, origin));
    }

    const redirectUrl = new URL(returnTo, origin);
    redirectUrl.searchParams.set("telegram_login", "ok");

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(TELEGRAM_WEB_APP_SESSION_COOKIE, createTelegramSessionToken({
      id: claims.id ?? Number(claims.sub),
      first_name: claims.given_name,
      last_name: claims.family_name,
      username: claims.preferred_username,
      photo_url: claims.picture,
    }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: telegramSessionMaxAgeSeconds(),
      path: "/",
    });
    response.cookies.delete(TELEGRAM_OIDC_STATE_COOKIE);

    return response;
  } catch {
    return NextResponse.redirect(new URL(`${returnTo}?telegram_login=failed`, origin));
  }
}

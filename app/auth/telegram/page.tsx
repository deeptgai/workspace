import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type TelegramLoginPageProps = {
  searchParams: Promise<{ returnTo?: string }>;
};

function safeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/s";
  }

  const url = new URL(value, "https://local.invalid");
  url.searchParams.delete("telegram_login");

  return `${url.pathname}${url.search}${url.hash}`;
}

export default async function TelegramLoginPage({ searchParams }: TelegramLoginPageProps) {
  const { returnTo } = await searchParams;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const loginDomain = (process.env.TELEGRAM_LOGIN_DOMAIN || "local.tgdeep.xyz").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const hasOidcLogin = Boolean(process.env.TELEGRAM_LOGIN_CLIENT_ID && process.env.TELEGRAM_LOGIN_CLIENT_SECRET);
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const safePath = safeReturnTo(returnTo);
  const oidcUrl = `/api/telegram/oidc/start?returnTo=${encodeURIComponent(safePath)}`;
  const linkedLoginUrl = `https://${loginDomain}/auth/telegram?returnTo=${encodeURIComponent(safePath)}`;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f2] px-4 text-slate-950">
      <section className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm">
        <h1 className="m-0 text-2xl font-black">Войти через Telegram</h1>
        <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
          Войдите, чтобы покупки и доступ к разделам работали в браузере так же, как в Mini App.
        </p>
        {hasOidcLogin ? (
          <div className="mt-5 grid gap-3">
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
              href={oidcUrl}
            >
              Продолжить в Telegram
            </a>
            <p className="m-0 text-xs leading-5 text-slate-500">
              После подтверждения Telegram вернет вас обратно на страницу раздела.
            </p>
          </div>
        ) : isLocalhost ? (
          <div className="mt-5 grid gap-3">
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
              href={linkedLoginUrl}
            >
              Открыть на {loginDomain}
            </a>
            <p className="m-0 text-xs leading-5 text-slate-500">
              Telegram OIDC должен быть настроен на домене, доступном Telegram.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold leading-5 text-amber-900">
              Telegram OIDC не настроен на этом домене.
            </p>
            <p className="m-0 text-xs leading-5 text-slate-500">
              Добавьте TELEGRAM_LOGIN_CLIENT_ID и TELEGRAM_LOGIN_CLIENT_SECRET, чтобы включить браузерный вход.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

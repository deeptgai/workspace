import { NextResponse } from "next/server";
import { prisma } from "../../../../../../src/db/prisma";
import { signalKindForSectionId } from "../../../../../../src/snapshots/signalSections";
import { isSourceSignalKindPaid } from "../../../../../../src/sources/paidSignalKinds";
import { findPaidSourceAccess } from "../../../../../../src/telegram/sourceAccess";
import { isPaidSectionId } from "../../../../../../src/telegram/starsPayments";
import { getTelegramSessionFromCookieHeader } from "../../../../../../src/telegram/webAppSession";
import { telegramInitDataMaxAgeSeconds, verifyTelegramWebAppInitData } from "../../../../../../src/telegram/webAppAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SectionPaymentStatusRequest = {
  initData?: string;
  sourceId?: string;
  sectionId?: string;
};

async function requireTelegramUser(request: Request, initData: string | undefined) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    return null;
  }

  if (initData) {
    const verified = verifyTelegramWebAppInitData(initData, token, { maxAgeSeconds: telegramInitDataMaxAgeSeconds() });

    return verified?.user ?? null;
  }

  return getTelegramSessionFromCookieHeader(request.headers.get("cookie"))?.user ?? null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SectionPaymentStatusRequest | null;
  const user = await requireTelegramUser(request, body?.initData?.trim());
  const sourceId = body?.sourceId?.trim();
  const sectionId = body?.sectionId?.trim() || "people";

  if (!sourceId || !sectionId || !isPaidSectionId(sectionId)) {
    return NextResponse.json({ ok: true, access: false, mode: user ? "telegram" : "browser" });
  }

  const source = await prisma.source.findUnique({
    where: {
      id: sourceId,
    },
    select: {
      paidSignalKinds: true,
    },
  });
  const signalKind = signalKindForSectionId(sectionId);

  if (!source || !signalKind) {
    return NextResponse.json({ ok: true, access: false, mode: user ? "telegram" : "browser" });
  }

  if (!isSourceSignalKindPaid(source, signalKind)) {
    return NextResponse.json({ ok: true, access: true, mode: "free" });
  }

  if (!user) {
    return NextResponse.json({ ok: true, access: false, mode: "browser" });
  }

  const purchase = await findPaidSourceAccess(prisma, {
    telegramId: BigInt(user.id),
    sourceId,
  });

  return NextResponse.json({ ok: true, access: Boolean(purchase), paidAt: purchase?.paidAt ?? null });
}

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../../../../src/db/prisma";
import { signalKindForSectionId } from "../../../../../../src/snapshots/signalSections";
import { isSourceSignalKindPaid } from "../../../../../../src/sources/paidSignalKinds";
import { createPaidSectionInvoiceLink } from "../../../../../../src/telegram/starsInvoices";
import { findPaidSourceAccess, upsertTelegramUserWithCustomer } from "../../../../../../src/telegram/sourceAccess";
import {
  isPaidSectionId,
  makePaidSectionInvoicePayload,
  paidSectionProduct,
} from "../../../../../../src/telegram/starsPayments";
import { getTelegramSessionFromCookieHeader } from "../../../../../../src/telegram/webAppSession";
import { telegramInitDataMaxAgeSeconds, verifyTelegramWebAppInitData } from "../../../../../../src/telegram/webAppAuth";
import type { TelegramWebAppUser } from "../../../../../../src/telegram/webAppAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SectionInvoiceRequest = {
  initData?: string;
  sourceId?: string;
  sourceTitle?: string;
  sectionId?: string;
};

function requireTelegramUser(request: Request, initData: string | undefined, token: string): TelegramWebAppUser | null {
  if (initData) {
    const verified = verifyTelegramWebAppInitData(initData, token, { maxAgeSeconds: telegramInitDataMaxAgeSeconds() });

    return verified?.user ?? null;
  }

  return getTelegramSessionFromCookieHeader(request.headers.get("cookie"))?.user ?? null;
}

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const body = (await request.json().catch(() => null)) as SectionInvoiceRequest | null;
  const sourceId = body?.sourceId?.trim();
  const sourceTitle = body?.sourceTitle?.trim() || "DeepTG";
  const initData = body?.initData?.trim();
  const sectionId = body?.sectionId?.trim() || "people";

  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" }, { status: 500 });
  }

  if (!sourceId || !sectionId || !isPaidSectionId(sectionId)) {
    return NextResponse.json({ ok: false, error: "Source and valid section are required" }, { status: 400 });
  }

  const source = await prisma.source.findUnique({
    where: {
      id: sourceId,
    },
    select: {
      paidSignalKinds: true,
      accessPriceUsdCents: true,
    },
  });
  const signalKind = signalKindForSectionId(sectionId);

  if (!source || !signalKind) {
    return NextResponse.json({ ok: false, error: "Source not found" }, { status: 404 });
  }

  if (!isSourceSignalKindPaid(source, signalKind)) {
    return NextResponse.json({ ok: true, access: true, mode: "free" });
  }

  const user = requireTelegramUser(request, initData, token);

  if (!user) {
    const invoicePayload = makePaidSectionInvoicePayload({
      sectionId,
      sourceId,
      checkoutId: randomUUID(),
    });
    const invoice = await createPaidSectionInvoiceLink({
      sectionId,
      sourceTitle,
      sourceAccessPriceUsdCents: source.accessPriceUsdCents,
      invoicePayload,
    });

    return NextResponse.json({ ok: true, access: false, mode: "telegram_redirect", ...invoice });
  }

  const telegramId = BigInt(user.id);
  const product = paidSectionProduct(sectionId);

  const telegramUser = await upsertTelegramUserWithCustomer(prisma, {
    telegramId,
    profile: user,
  });

  const paidPurchase = await findPaidSourceAccess(prisma, {
    telegramId,
    sourceId,
  });

  if (paidPurchase) {
    return NextResponse.json({ ok: true, access: true });
  }

  const invoicePayload = makePaidSectionInvoicePayload({ sectionId, sourceId, telegramId });
  const invoice = await createPaidSectionInvoiceLink({
    sectionId,
    sourceTitle,
    sourceAccessPriceUsdCents: source.accessPriceUsdCents,
    invoicePayload,
  });
  const pendingPurchase = await prisma.telegramPurchase.findFirst({
    where: {
      telegramId,
      product,
      sourceId,
      status: "pending",
    },
  });

  if (pendingPurchase) {
    await prisma.telegramPurchase.update({
      where: {
        id: pendingPurchase.id,
      },
      data: {
        telegramUserId: telegramUser.id,
        amount: invoice.amount,
        invoicePayload,
        product,
        sourceId,
      },
    });
  } else {
    await prisma.telegramPurchase.create({
      data: {
        telegramUserId: telegramUser.id,
        telegramId,
        product,
        sourceId,
        amount: invoice.amount,
        invoicePayload,
      },
    });
  }

  return NextResponse.json({ ok: true, access: false, mode: "mini_app", ...invoice });
}

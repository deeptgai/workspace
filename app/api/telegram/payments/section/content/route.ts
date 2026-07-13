import { NextResponse } from "next/server";
import { getSourceSignalMap } from "../../../../../data";
import { getSnapshotEvidenceMessages } from "../../../../../snapshots/snapshotViewData";
import { evidenceForSnapshot } from "../../../../../s/publicSnapshot";
import { prisma } from "../../../../../../src/db/prisma";
import { signalKindForSectionId } from "../../../../../../src/snapshots/signalSections";
import { isSourceSignalKindPaid } from "../../../../../../src/sources/paidSignalKinds";
import { findPaidSourceAccess } from "../../../../../../src/telegram/sourceAccess";
import { isPaidSectionId } from "../../../../../../src/telegram/starsPayments";
import { getTelegramSessionFromCookieHeader } from "../../../../../../src/telegram/webAppSession";
import { telegramInitDataMaxAgeSeconds, verifyTelegramWebAppInitData } from "../../../../../../src/telegram/webAppAuth";
import type { TelegramWebAppUser } from "../../../../../../src/telegram/webAppAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SectionContentRequest = {
  initData?: string;
  slug?: string;
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
  const body = (await request.json().catch(() => null)) as SectionContentRequest | null;
  const initData = body?.initData?.trim();
  const slug = body?.slug?.trim();
  const sectionId = body?.sectionId?.trim() || "people";

  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" }, { status: 500 });
  }

  if (!slug || !isPaidSectionId(sectionId)) {
    return NextResponse.json({ ok: false, error: "Telegram auth, slug and valid section are required" }, { status: 401 });
  }

  const sourceMap = await getSourceSignalMap(slug);

  if (!sourceMap) {
    return NextResponse.json({ ok: false, error: "Source not found" }, { status: 404 });
  }

  const kind = signalKindForSectionId(sectionId);

  if (!kind) {
    return NextResponse.json({ ok: false, error: "Unknown section" }, { status: 400 });
  }

  if (isSourceSignalKindPaid(sourceMap.chat, kind)) {
    const user = requireTelegramUser(request, initData, token);

    if (!user) {
      return NextResponse.json({ ok: false, error: "Telegram auth is required" }, { status: 401 });
    }

    const purchase = await findPaidSourceAccess(prisma, {
      telegramId: BigInt(user.id),
      sourceId: sourceMap.sourceId,
    });

    if (!purchase) {
      return NextResponse.json({ ok: false, error: "Paid access is required" }, { status: 403 });
    }
  }

  const signals = sourceMap.document.signals.filter((signal) => signal.kind === kind);
  const sectionDocument = {
    ...sourceMap.document,
    signals,
  };
  const evidenceMessages = evidenceForSnapshot(sectionDocument, getSnapshotEvidenceMessages(sourceMap));

  return NextResponse.json({ ok: true, signals, evidenceMessages });
}

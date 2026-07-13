import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isChannelSnapshotDocument } from "../../../../src/snapshots/sourceSnapshotSchema";
import { TELEGRAM_WEB_APP_SESSION_COOKIE, verifyTelegramSessionToken } from "../../../../src/telegram/webAppSession";
import { getSnapshot, getSourceSignalMap } from "../../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../../../snapshots/snapshotViewData";
import { SnapshotSeoContent } from "../../../snapshots/SnapshotSeoContent";
import { SnapshotAppIsland } from "../../../snapshots/[id]/SnapshotAppIsland";
import { signalMetadata } from "../../../snapshots/metadata";
import { evidenceForSnapshot, lockedPaidTabCounts, publicSnapshotDocument } from "../../publicSnapshot";

export const dynamic = "force-dynamic";

type ShortSharedSnapshotPageProps = {
  params: Promise<{ slug: string; id: string }>;
};

function normalizeSignalId(signalId: string) {
  try {
    return decodeURIComponent(signalId);
  } catch {
    return signalId;
  }
}

export async function generateMetadata({ params }: ShortSharedSnapshotPageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const normalizedSignalId = normalizeSignalId(id);
  const sourceMap = await getSourceSignalMap(slug);
  const cookieStore = await cookies();
  const telegramSession = verifyTelegramSessionToken(cookieStore.get(TELEGRAM_WEB_APP_SESSION_COOKIE)?.value);
  const document = isChannelSnapshotDocument(sourceMap?.document) ? publicSnapshotDocument(sourceMap.document) : null;
  const activeSignal = document?.signals.find((signal) => signal.id === normalizedSignalId);
  const title = activeSignal
    ? `${activeSignal.title} — ${sourceMap?.chat.title}`
    : sourceMap ? `${sourceMap.chat.title} — карта сигналов` : "Карта сигналов";

  return signalMetadata({
    title,
    description: activeSignal?.summary || "Карта идей, болей, инсайтов, материалов, мест и людей по источнику.",
    document,
    signal: activeSignal,
  });
}

export default async function ShortSharedSnapshotPage({ params }: ShortSharedSnapshotPageProps) {
  const { slug, id } = await params;
  const normalizedSignalId = normalizeSignalId(id);
  const sourceMap = await getSourceSignalMap(slug);
  const cookieStore = await cookies();
  const telegramSession = verifyTelegramSessionToken(cookieStore.get(TELEGRAM_WEB_APP_SESSION_COOKIE)?.value);

  if (!sourceMap || !isChannelSnapshotDocument(sourceMap.document)) {
    notFound();
  }

  const publicDocument = publicSnapshotDocument(sourceMap.document);

  if (!publicDocument.signals.some((signal) => signal.id === normalizedSignalId)) {
    const snapshot = await getSnapshot(id);

    if (snapshot?.sourceId === sourceMap.sourceId) {
      redirect(`/s/${slug}`);
    }

    notFound();
  }

  const evidenceMessages = evidenceForSnapshot(publicDocument, getSnapshotEvidenceMessages(sourceMap));

  return (
    <main className="min-h-screen bg-[#f5f7f2] text-slate-950">
      <div className="mx-auto w-full max-w-6xl px-2 py-3 sm:px-4 sm:py-4 md:px-6 md:py-6">
        <div className="motion-safe:animate-[snapshotFadeIn_520ms_ease-out]">
          <SnapshotAppIsland
            snapshot={publicDocument}
            evidenceMessages={evidenceMessages}
            people={getSnapshotPeople(sourceMap)}
            actorname={sourceMap.chat.username}
            initialActiveSignalId={normalizedSignalId}
            initialTelegramUser={telegramSession?.user ?? null}
            basePath={`/s/${slug}`}
            lockedPaidTabCounts={lockedPaidTabCounts(sourceMap.document)}
          />
          <SnapshotSeoContent snapshot={publicDocument} evidenceMessages={evidenceMessages} activeSignalId={normalizedSignalId} />
        </div>
      </div>
    </main>
  );
}

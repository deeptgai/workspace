import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isChannelSnapshotDocument } from "../../../src/snapshots/sourceSnapshotSchema";
import { sourcePaidSignalKinds } from "../../../src/sources/paidSignalKinds";
import { TELEGRAM_WEB_APP_SESSION_COOKIE, verifyTelegramSessionToken } from "../../../src/telegram/webAppSession";
import { getSourceSignalMap } from "../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../../snapshots/snapshotViewData";
import { SnapshotSeoContent } from "../../snapshots/SnapshotSeoContent";
import { SnapshotAppIsland } from "../../snapshots/[id]/SnapshotAppIsland";
import { snapshotMetadata } from "../../snapshots/metadata";
import { evidenceForSnapshot, lockedPaidTabCounts, publicSnapshotDocument } from "../publicSnapshot";

export const dynamic = "force-dynamic";

type SourceSignalMapPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: SourceSignalMapPageProps): Promise<Metadata> {
  const { slug } = await params;
  const sourceMap = await getSourceSignalMap(slug);
  const paidSignalKinds = sourcePaidSignalKinds(sourceMap?.chat);
  const document = isChannelSnapshotDocument(sourceMap?.document) ? publicSnapshotDocument(sourceMap.document, paidSignalKinds) : null;
  const description = document?.signals.slice(0, 3).map((signal) => signal.title).join(" · ");
  const title = sourceMap ? `${sourceMap.chat.title} — карта сигналов` : "Карта сигналов";

  return snapshotMetadata({
    title,
    description: description || "Карта идей, болей, инсайтов, материалов, мест и людей по источнику.",
    document,
  });
}

export default async function SourceSignalMapPage({ params }: SourceSignalMapPageProps) {
  const { slug } = await params;
  const sourceMap = await getSourceSignalMap(slug);
  const cookieStore = await cookies();
  const telegramSession = verifyTelegramSessionToken(cookieStore.get(TELEGRAM_WEB_APP_SESSION_COOKIE)?.value);

  if (!sourceMap || !isChannelSnapshotDocument(sourceMap.document)) {
    notFound();
  }

  const paidSignalKinds = sourcePaidSignalKinds(sourceMap.chat);
  const publicDocument = publicSnapshotDocument(sourceMap.document, paidSignalKinds);
  const appDocument = {
    ...publicDocument,
    signals: [],
  };
  const seoEvidenceMessages = evidenceForSnapshot(publicDocument, getSnapshotEvidenceMessages(sourceMap));

  return (
    <main className="min-h-screen bg-[#f5f7f2] text-slate-950">
      <div className="mx-auto w-full max-w-6xl px-2 py-3 sm:px-4 sm:py-4 md:px-6 md:py-6">
        <div className="motion-safe:animate-[snapshotFadeIn_520ms_ease-out]">
          <SnapshotAppIsland
            snapshot={appDocument}
            evidenceMessages={[]}
            people={getSnapshotPeople(sourceMap)}
            actorname={sourceMap.chat.username}
            initialTelegramUser={telegramSession?.user ?? null}
            basePath={`/s/${slug}`}
            lockedPaidTabCounts={lockedPaidTabCounts(sourceMap.document, paidSignalKinds)}
            paidSignalKinds={paidSignalKinds}
            signalFeed={{
              slug,
              limit: 30,
            }}
          />
          <SnapshotSeoContent snapshot={publicDocument} evidenceMessages={seoEvidenceMessages} />
        </div>
      </div>
    </main>
  );
}

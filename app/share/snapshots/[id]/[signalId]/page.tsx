import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isChannelSnapshotDocument } from "../../../../../src/snapshots/sourceSnapshotSchema";
import { getSnapshot } from "../../../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../../../../snapshots/snapshotViewData";
import { SnapshotSeoContent } from "../../../../snapshots/SnapshotSeoContent";
import { SnapshotAppIsland } from "../../../../snapshots/[id]/SnapshotAppIsland";
import { signalMetadata } from "../../../../snapshots/metadata";

export const dynamic = "force-dynamic";

type SharedSignalPageProps = {
  params: Promise<{ id: string; signalId: string }>;
};

function normalizeSignalId(signalId: string) {
  try {
    return decodeURIComponent(signalId);
  } catch {
    return signalId;
  }
}

export async function generateMetadata({ params }: SharedSignalPageProps): Promise<Metadata> {
  const { id, signalId } = await params;
  const normalizedSignalId = normalizeSignalId(signalId);
  const snapshot = await getSnapshot(id);
  const document = isChannelSnapshotDocument(snapshot?.document) ? snapshot.document : null;
  const activeSignal = document?.signals.find((signal) => signal.id === normalizedSignalId);
  const title = activeSignal
    ? `${activeSignal.title} — ${snapshot?.chat.title}`
    : snapshot ? `${snapshot.chat.title} — карта сигналов` : "Снимок";

  return signalMetadata({
    title,
    description: activeSignal?.summary || "Карта идей, болей, инсайтов, материалов, мест и людей по источнику.",
    document,
    signal: activeSignal,
  });
}

export default async function SharedSignalPage({ params }: SharedSignalPageProps) {
  const { id, signalId } = await params;
  const normalizedSignalId = normalizeSignalId(signalId);
  const snapshot = await getSnapshot(id);

  if (!snapshot || snapshot.status !== "completed") {
    notFound();
  }

  if (!isChannelSnapshotDocument(snapshot.document)) {
    notFound();
  }

  if (!snapshot.document.signals.some((signal) => signal.id === normalizedSignalId)) {
    notFound();
  }

  const evidenceMessages = getSnapshotEvidenceMessages(snapshot);

  return (
    <main className="min-h-screen bg-[#f5f7f2] text-slate-950">
      <div className="mx-auto w-full max-w-6xl px-2 py-3 sm:px-4 sm:py-4 md:px-6 md:py-6">
        <div className="motion-safe:animate-[snapshotFadeIn_520ms_ease-out]">
          <SnapshotAppIsland
            snapshot={snapshot.document}
            evidenceMessages={evidenceMessages}
            people={getSnapshotPeople(snapshot)}
            actorname={snapshot.chat.username}
            initialActiveSignalId={normalizedSignalId}
            basePath={`/share/snapshots/${id}`}
          />
          <SnapshotSeoContent snapshot={snapshot.document} evidenceMessages={evidenceMessages} activeSignalId={normalizedSignalId} />
        </div>
      </div>
    </main>
  );
}

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isChannelSnapshotDocument } from "../../../../src/snapshots/sourceSnapshotSchema";
import { getSnapshot } from "../../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../../../snapshots/snapshotViewData";
import { SnapshotSeoContent } from "../../../snapshots/SnapshotSeoContent";
import { SnapshotAppIsland } from "../../../snapshots/[id]/SnapshotAppIsland";
import { snapshotMetadata } from "../../../snapshots/metadata";

export const dynamic = "force-dynamic";

type SharedSnapshotPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: SharedSnapshotPageProps): Promise<Metadata> {
  const { id } = await params;
  const snapshot = await getSnapshot(id);
  const document = isChannelSnapshotDocument(snapshot?.document) ? snapshot.document : null;
  const description = document?.signals.slice(0, 3).map((signal) => signal.title).join(" · ");
  const title = snapshot ? `${snapshot.chat.title} — карта сигналов` : "Снимок";

  return snapshotMetadata({
    title,
    description: description || "Карта идей, болей, инсайтов, материалов, мест и людей по источнику.",
    document,
  });
}

export default async function SharedSnapshotPage({ params }: SharedSnapshotPageProps) {
  const { id } = await params;
  const snapshot = await getSnapshot(id);

  if (!snapshot || snapshot.status !== "completed") {
    notFound();
  }

  if (!isChannelSnapshotDocument(snapshot.document)) {
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
            basePath={`/share/snapshots/${id}`}
          />
          <SnapshotSeoContent snapshot={snapshot.document} evidenceMessages={evidenceMessages} />
        </div>
      </div>
    </main>
  );
}

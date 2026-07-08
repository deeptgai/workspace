import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isChannelSnapshotDocument } from "../../../../src/snapshots/sourceSnapshotSchema";
import { getSnapshot } from "../../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../../../snapshots/snapshotViewData";
import { SnapshotTabs } from "../../../snapshots/[id]/SnapshotTabs";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const snapshot = await getSnapshot(id);

  return {
    title: snapshot?.chat.title ?? "Снимок",
  };
}

export default async function ShortSharedSnapshotPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = await params;
  const snapshot = await getSnapshot(id);

  if (!snapshot || snapshot.status !== "completed") {
    notFound();
  }

  if (!isChannelSnapshotDocument(snapshot.document)) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f5f7f2] text-slate-950">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6">
        <div className="motion-safe:animate-[snapshotFadeIn_520ms_ease-out]">
          <SnapshotTabs
            snapshot={snapshot.document}
            evidenceMessages={getSnapshotEvidenceMessages(snapshot)}
            people={getSnapshotPeople(snapshot)}
            actorname={snapshot.chat.username}
          />
        </div>
      </div>
    </main>
  );
}

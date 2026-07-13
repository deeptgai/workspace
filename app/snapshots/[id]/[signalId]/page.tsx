import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isChannelSnapshotDocument } from "../../../../src/snapshots/sourceSnapshotSchema";
import { AppShell } from "../../../components";
import { formatDateTime, getSnapshot } from "../../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../../snapshotViewData";
import { SnapshotSeoContent } from "../../SnapshotSeoContent";
import { signalMetadata } from "../../metadata";
import { SnapshotAppIsland } from "../SnapshotAppIsland";
import { sourceSlug } from "../../../sourceSlug";

export const dynamic = "force-dynamic";

type SnapshotSignalPageProps = {
  params: Promise<{ id: string; signalId: string }>;
};

function normalizeSignalId(signalId: string) {
  try {
    return decodeURIComponent(signalId);
  } catch {
    return signalId;
  }
}

export async function generateMetadata({ params }: SnapshotSignalPageProps): Promise<Metadata> {
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
    description: activeSignal?.summary,
    document,
    signal: activeSignal,
  });
}

export default async function SnapshotSignalPage({ params }: SnapshotSignalPageProps) {
  const { id, signalId } = await params;
  const normalizedSignalId = normalizeSignalId(signalId);
  const snapshot = await getSnapshot(id);

  if (!snapshot) {
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
    <AppShell activeSourceId={snapshot.sourceId}>
      <div className="topbar">
        <div>
          <h1 className="page-title">{snapshot.title}</h1>
          <p className="page-subtitle">
            {formatDateTime(snapshot.createdAt)} · {snapshot.chat.title}
          </p>
        </div>
        <div className="actions">
          <Link className="button" href={`/s/${sourceSlug(snapshot.chat.username || snapshot.chat.title)}`}>Share view</Link>
          <Link className="button" href={`/sources/${snapshot.sourceId}`}>Back to source</Link>
        </div>
      </div>

      <SnapshotAppIsland
        snapshot={snapshot.document}
        evidenceMessages={evidenceMessages}
        people={getSnapshotPeople(snapshot)}
        actorname={snapshot.chat.username}
        initialActiveSignalId={normalizedSignalId}
        basePath={`/snapshots/${id}`}
      />
      <SnapshotSeoContent snapshot={snapshot.document} evidenceMessages={evidenceMessages} activeSignalId={normalizedSignalId} />
    </AppShell>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isChannelSnapshotDocument } from "../../../../src/snapshots/sourceSnapshotSchema";
import { AppShell } from "../../../components";
import { formatDateTime, getSnapshot } from "../../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../../snapshotViewData";
import { SnapshotSeoContent } from "../../SnapshotSeoContent";
import { SnapshotTabs } from "../SnapshotTabs";

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

function snapshotSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

export async function generateMetadata({ params }: SnapshotSignalPageProps): Promise<Metadata> {
  const { id, signalId } = await params;
  const normalizedSignalId = normalizeSignalId(signalId);
  const snapshot = await getSnapshot(id);
  const document = isChannelSnapshotDocument(snapshot?.document) ? snapshot.document : null;
  const activeSignal = document?.signals.find((signal) => signal.id === normalizedSignalId);

  return {
    title: activeSignal
      ? `${activeSignal.title} — ${snapshot?.chat.title}`
      : snapshot ? `${snapshot.chat.title} — карта сигналов` : "Снимок",
    description: activeSignal?.summary,
  };
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
          <Link className="button" href={`/s/${snapshotSlug(snapshot.chat.username || snapshot.chat.title)}/${snapshot.id}`}>Share view</Link>
          <Link className="button" href={`/sources/${snapshot.sourceId}`}>Back to source</Link>
        </div>
      </div>

      <SnapshotTabs
        snapshot={snapshot.document}
        evidenceMessages={evidenceMessages}
        people={getSnapshotPeople(snapshot)}
        actorname={snapshot.chat.username}
        initialActiveSignalId={normalizedSignalId}
        basePath={`/snapshots/${id}`}
      />
      <SnapshotSeoContent snapshot={snapshot.document} evidenceMessages={evidenceMessages} />
    </AppShell>
  );
}

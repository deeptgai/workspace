import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isChannelSnapshotDocument } from "../../../src/snapshots/sourceSnapshotSchema";
import { AppShell } from "../../components";
import { formatDateTime, getSnapshot } from "../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../snapshotViewData";
import { SnapshotSeoContent } from "../SnapshotSeoContent";
import { snapshotMetadata } from "../metadata";
import { SnapshotTabs } from "./SnapshotTabs";

export const dynamic = "force-dynamic";

type SnapshotPageProps = {
  params: Promise<{ id: string }>;
};

function snapshotSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

export async function generateMetadata({ params }: SnapshotPageProps): Promise<Metadata> {
  const { id } = await params;
  const snapshot = await getSnapshot(id);
  const document = isChannelSnapshotDocument(snapshot?.document) ? snapshot.document : null;
  const description = document?.signals.slice(0, 3).map((signal) => signal.title).join(" · ");
  const title = snapshot ? `${snapshot.chat.title} — карта сигналов` : "Снимок";

  return snapshotMetadata({
    title,
    description,
    document,
  });
}

export default async function SnapshotPage({ params }: SnapshotPageProps) {
  const { id } = await params;
  const snapshot = await getSnapshot(id);

  if (!snapshot) {
    notFound();
  }

  if (!isChannelSnapshotDocument(snapshot.document)) {
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
        basePath={`/snapshots/${id}`}
      />
      <SnapshotSeoContent snapshot={snapshot.document} evidenceMessages={evidenceMessages} />
    </AppShell>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isChannelSnapshotDocument } from "../../../src/snapshots/sourceSnapshotSchema";
import { AppShell } from "../../components";
import { formatDateTime, getSnapshot } from "../../data";
import { getSnapshotEvidenceMessages, getSnapshotPeople } from "../snapshotViewData";
import { SnapshotTabs } from "./SnapshotTabs";

export const dynamic = "force-dynamic";

function snapshotSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const snapshot = await getSnapshot(id);

  return {
    title: snapshot?.chat.title ?? "Снимок",
  };
}

export default async function SnapshotPage({ params }: { params: Promise<{ id: string }> }) {
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
      />
    </AppShell>
  );
}

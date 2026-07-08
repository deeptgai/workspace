import Link from "next/link";
import { AppShell, ItemsBadge, SnapshotsBadge, Stat, TypeBadge } from "./components";
import { formatNumber, getSourcesOverview } from "./data";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const { import: importStatus } = await searchParams;
  const chats = await getSourcesOverview();
  const totals = chats.reduce(
    (acc, chat) => {
      acc.items += chat._count.items;
      acc.embeddings += chat.embeddedCount;
      acc.snapshots += chat._count.snapshots;
      acc.views += chat.aggregate._sum.views ?? 0;
      return acc;
    },
    { items: 0, embeddings: 0, snapshots: 0, views: 0 },
  );

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <h1 className="page-title">Analyzed Sources</h1>
          <p className="page-subtitle">Tracked sources with generated analysis artifacts.</p>
        </div>
      </div>

      <section className="stats-grid">
        <Stat label="Sources" value={formatNumber(chats.length)} />
        <Stat label="Items" value={formatNumber(totals.items)} />
        <Stat label="Embeddings" value={formatNumber(totals.embeddings)} />
        <Stat label="Snapshots" value={formatNumber(totals.snapshots)} />
      </section>

      {importStatus === "source_queued" ? (
        <div className="notice">Source import queued. It will appear after the worker resolves and imports it.</div>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Sources</h2>
          <span className="badge">{formatNumber(totals.views)} views</span>
        </div>
        {chats.length === 0 ? (
          <div className="empty">No data yet. Track a source to see it here.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Items</th>
                <th>Embeddings</th>
                <th>Snapshots</th>
                <th>Latest Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {chats.map((chat) => (
                <tr key={chat.id}>
                  <td>
                    <Link href={`/sources/${chat.id}`} className="button">{chat.title}</Link>
                    <div className="text-muted">{chat.username ? `@${chat.username}` : chat.externalId}</div>
                  </td>
                  <td><TypeBadge type={chat.type} /></td>
                  <td><ItemsBadge count={chat._count.items} /></td>
                  <td>{formatNumber(chat.embeddedCount)}</td>
                  <td><SnapshotsBadge count={chat._count.snapshots} /></td>
                  <td>
                    {chat.latestSnapshot ? (
                      <Link className="button primary" href={`/snapshots/${chat.latestSnapshot.id}`}>Open</Link>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AppShell>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { DatabaseZap, FileDown, FilePlus2, RefreshCw } from "lucide-react";
import { checkUpdatesAction, createSnapshotAction, fullImportAction, retrySnapshotSectionAction } from "../../actions";
import { AppShell, ItemsBadge, SnapshotsBadge, Stat, TypeBadge } from "../../components";
import { compactText, formatDate, formatDateTime, formatNumber, getSourceDetail } from "../../data";
import { SnapshotAutoRefresh } from "./SnapshotAutoRefresh";

export const dynamic = "force-dynamic";

function snapshotSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ snapshot?: string; import?: string }>;
}) {
  const { id } = await params;
  const { snapshot, import: importStatus } = await searchParams;
  const detail = await getSourceDetail(id);

  if (!detail) {
    notFound();
  }

  const { chat, aggregate, embeddingCount, commentCount, commentUserCount } = detail;
  const hasActiveSnapshot = chat.snapshots.some((item) => item.status === "pending" || item.status === "running");

  return (
    <AppShell activeSourceId={chat.id}>
      <SnapshotAutoRefresh enabled={hasActiveSnapshot} />
      <div className="topbar">
        <div>
          <h1 className="page-title">{chat.title}</h1>
          <p className="page-subtitle">{chat.username ? `@${chat.username}` : chat.externalId}</p>
        </div>
        <div className="actions">
          <TypeBadge type={chat.type} />
          <ItemsBadge count={chat._count.items} />
          <SnapshotsBadge count={chat._count.snapshots} />
          <a className="button" href={`/sources/${chat.id}/export`}>
            <FileDown size={15} />
            Export MD
          </a>
          <form action={checkUpdatesAction}>
            <input type="hidden" name="sourceId" value={chat.id} />
            <button className="button" type="submit">
              <RefreshCw size={15} />
              Check updates
            </button>
          </form>
          <form action={fullImportAction}>
            <input type="hidden" name="sourceId" value={chat.id} />
            <button className="button danger" type="submit">
              <DatabaseZap size={15} />
              Full Import
            </button>
          </form>
        </div>
      </div>

      <section className="stats-grid">
        <Stat label="Views" value={formatNumber(aggregate._sum.views)} />
        <Stat label="Reactions" value={formatNumber(aggregate._sum.reactionsTotal)} />
        <Stat label="Comments" value={formatNumber(commentCount)} />
        <Stat label="Commenters" value={formatNumber(commentUserCount)} />
        <Stat label="Embeddings" value={formatNumber(embeddingCount)} />
      </section>

      {snapshot === "queued" ? (
        <div className="notice">Snapshot job queued. It will appear below while the worker generates it.</div>
      ) : null}
      {importStatus === "updates_queued" ? (
        <div className="notice">Update import queued. New posts will be imported first, then new comments.</div>
      ) : null}
      {importStatus === "full_queued" ? (
        <div className="notice">Full import queued. Existing items and snapshots were cleared for this source.</div>
      ) : null}

      <div className="grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Artifacts</h2>
              <div className="text-muted small-text">Structured snapshots are generated in the background queue.</div>
            </div>
            <form action={createSnapshotAction}>
              <input type="hidden" name="sourceId" value={chat.id} />
              <button className="button primary" type="submit">
                <FilePlus2 size={15} />
                Create Snapshot
              </button>
            </form>
          </div>
          {chat.snapshots.length === 0 ? (
            <div className="empty">No snapshots yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {chat.snapshots.map((snapshot) => {
                  const completedSections = snapshot.sections.filter((section) => section.status === "completed").length;
                  const activeSections = snapshot.sections.filter((section) => section.status === "running");
                  const failedSection = snapshot.sections.find((section) => section.status === "failed");

                  return (
                    <tr key={snapshot.id}>
                      <td>
                        {snapshot.status === "completed" ? (
                          <Link
                            className="font-bold text-cyan-700 underline decoration-cyan-300 underline-offset-4 transition hover:text-cyan-900 hover:decoration-cyan-600"
                            href={`/s/${snapshotSlug(chat.username || chat.title)}/${snapshot.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {snapshot.title}
                          </Link>
                        ) : (
                          snapshot.title
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${snapshot.status}`}>
                          {snapshot.status === "pending" || snapshot.status === "running" ? <span className="spinner" /> : null}
                          {snapshot.status}
                        </span>
                        {snapshot.sections.length > 0 ? (
                          <div className="text-muted small-text">
                            {completedSections}/{snapshot.sections.length} групп сигналов
                            {activeSections.length ? ` · сейчас: ${activeSections.map((section) => section.title).join(", ")}` : ""}
                            {failedSection ? ` · ошибка: ${failedSection.title}` : ""}
                          </div>
                        ) : null}
                        {failedSection ? (
                          <form action={retrySnapshotSectionAction} className="mt-2">
                            <input type="hidden" name="snapshotId" value={snapshot.id} />
                            <input type="hidden" name="sectionId" value={failedSection.sectionId} />
                            <button className="button" type="submit">Retry signal group</button>
                          </form>
                        ) : null}
                        {snapshot.error ? <div className="text-muted small-text">{snapshot.error}</div> : null}
                      </td>
                      <td>{formatDateTime(snapshot.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Top Items By Engagement</h2>
            <span className="badge">max {Number((aggregate._max.engagementScore ?? 0).toFixed(2))}</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Date</th>
                <th>Score</th>
                <th>Views</th>
                <th>Reactions</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody>
              {chat.items.map((message) => (
                <tr key={message.id}>
                  <td>
                    <Link className="inline-link" href={`/sources/${chat.id}/items/${message.externalId}`}>
                      {message.externalId}
                    </Link>
                  </td>
                  <td>{formatDate(message.publishedAt)}</td>
                  <td>{Number(message.engagementScore.toFixed(2))}</td>
                  <td>{formatNumber(message.views)}</td>
                  <td>{formatNumber(message.reactionsTotal)}</td>
                  <td className="truncate">{compactText(message.text, 160)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </AppShell>
  );
}

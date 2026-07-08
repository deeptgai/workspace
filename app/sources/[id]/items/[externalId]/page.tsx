import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { AppShell, Stat } from "../../../../components";
import { formatDateTime, formatNumber, getMessageDetail } from "../../../../data";

export const dynamic = "force-dynamic";

export default async function MessagePage({
  params,
}: {
  params: Promise<{ id: string; externalId: string }>;
}) {
  const { id, externalId } = await params;

  if (!externalId.trim()) {
    notFound();
  }

  const message = await getMessageDetail(id, externalId);

  if (!message) {
    notFound();
  }

  const sourceItemUrl = message.provider === "telegram" && message.chat.username
    ? `https://t.me/${message.chat.username}/${message.externalId}`
    : null;

  return (
    <AppShell activeSourceId={message.sourceId}>
      <div className="topbar">
        <div>
          <h1 className="page-title">ContentItem #{message.externalId}</h1>
          <p className="page-subtitle">
            {message.chat.title} · {formatDateTime(message.publishedAt)}
          </p>
        </div>
        <div className="actions">
          {sourceItemUrl ? (
            <a className="button" href={sourceItemUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Open source item
            </a>
          ) : null}
          <Link className="button" href={`/sources/${message.sourceId}`}>Back to source</Link>
        </div>
      </div>

      <section className="stats-grid">
        <Stat label="Views" value={formatNumber(message.views)} />
        <Stat label="Forwards" value={formatNumber(message.forwards)} />
        <Stat label="Reactions" value={formatNumber(message.reactionsTotal)} />
        <Stat label="Replies" value={formatNumber(message.repliesCount)} />
      </section>

      <div className="grid">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">ContentItem Text</h2>
            <span className="badge">score {Number(message.engagementScore.toFixed(2))}</span>
          </div>
          <div className="message-body">
            {message.text ?? "<no text>"}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Evidence Metadata</h2>
          </div>
          <table className="table">
            <tbody>
              <tr>
                <th>Source</th>
                <td>{message.chat.title}</td>
              </tr>
              <tr>
                <th>Type</th>
                <td>{message.chat.type}</td>
              </tr>
              <tr>
                <th>Author</th>
                <td>
                  {message.user
                    ? message.user.username
                      ? `@${message.user.username}`
                      : [message.user.firstName, message.user.lastName].filter(Boolean).join(" ") || message.user.externalId
                    : "-"}
                </td>
              </tr>
              <tr>
                <th>Reply To</th>
                <td>{message.replyTo ?? "-"}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </AppShell>
  );
}

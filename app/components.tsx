import Link from "next/link";
import { BarChart3, FileText, Hash, MessageSquareText } from "lucide-react";
import { AddSourceModal } from "./AddSourceModal";
import { getSourcesOverview } from "./data";

export async function AppShell({ children, activeSourceId }: { children: React.ReactNode; activeSourceId?: string }) {
  const chats = await getSourcesOverview();

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark"><BarChart3 size={18} /></span>
          <span>Deep TG</span>
        </Link>
        <AddSourceModal />
        <nav className="nav-list">
          {chats.length === 0 ? (
            <div className="text-muted">No imported sources yet.</div>
          ) : chats.map((chat) => (
            <Link
              key={chat.id}
              href={`/sources/${chat.id}`}
              className={`nav-item ${activeSourceId === chat.id ? "active" : ""}`}
            >
              <span className="nav-title">{chat.title}</span>
              <span className="nav-meta">
                {chat.type} · {chat._count.items} items · {chat._count.snapshots} snapshots
              </span>
            </Link>
          ))}
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className="badge">
      <Hash size={13} />
      {type}
    </span>
  );
}

export function SnapshotsBadge({ count }: { count: number }) {
  return (
    <span className="badge">
      <FileText size={13} />
      {count} snapshots
    </span>
  );
}

export function ItemsBadge({ count }: { count: number }) {
  return (
    <span className="badge">
      <MessageSquareText size={13} />
      {count} items
    </span>
  );
}

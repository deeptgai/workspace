import type { ChannelSnapshotDocument, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import type { TelegramAuthUser } from "./TelegramAuthBadge";
import type { SnapshotPerson } from "./snapshotSignalPresentation";

export type EvidenceMessage = {
  externalId: string;
  kind: string;
  publishedAt: string;
  text: string | null;
  formattedText: string | null;
  views: number | null;
  forwards: number | null;
  reactionsTotal: number;
  repliesCount: number;
  engagementScore: number;
  user: {
    externalId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

export type PaidTab = Extract<SnapshotSignalKind, "person" | "tool">;
export type PaidTabAccess = "checking" | "browser" | "locked" | "unlocked" | "paying" | "error";

export const paidTabs = new Set<SnapshotSignalKind>(["person", "tool"]);
export const paidTabSectionIds: Record<PaidTab, "people" | "tools"> = {
  person: "people",
  tool: "tools",
};

export type SignalFeedConfig = {
  slug: string;
  limit: number;
};

export type SnapshotTabsProps = {
  snapshot: ChannelSnapshotDocument;
  evidenceMessages: EvidenceMessage[];
  people: SnapshotPerson[];
  actorname?: string | null;
  initialActiveSignalId?: string | null;
  initialTelegramUser?: TelegramAuthUser | null;
  basePath?: string;
  lockedPaidTabCounts?: Partial<Record<PaidTab, number>>;
  signalFeed?: SignalFeedConfig;
};

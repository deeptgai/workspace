import type { ChannelSnapshotDocument, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { sectionIdForSignalKind, signalKinds } from "../../../src/snapshots/signalSections";
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

export type PaidTab = SnapshotSignalKind;
export type PaidTabAccess = "checking" | "browser" | "locked" | "unlocked" | "paying" | "error";

export const paidTabs = new Set<SnapshotSignalKind>(signalKinds);
export const paidTabSectionIds = Object.fromEntries(
  signalKinds.map((kind) => [kind, sectionIdForSignalKind(kind)]),
) as Record<PaidTab, NonNullable<ReturnType<typeof sectionIdForSignalKind>>>;

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
  lockedPaidTabCounts?: Partial<Record<SnapshotSignalKind, number>>;
  paidSignalKinds?: SnapshotSignalKind[];
  signalFeed?: SignalFeedConfig;
};

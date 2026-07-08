export const CHANNEL_SNAPSHOT_SCHEMA_VERSION = "channel-snapshot-v3";

export type ChannelSnapshotSectionId =
  | "ideas"
  | "pains"
  | "hypotheses"
  | "insights"
  | "materials"
  | "people"
  | "tools"
  | "places";

export type SnapshotEvidenceRef = {
  itemId: string;
  quote?: string;
  reason?: string;
};

export type SnapshotMetric = {
  key: string;
  label: string;
  value: string;
};

export type SnapshotSignalKind =
  | "idea"
  | "pain"
  | "hypothesis"
  | "insight"
  | "material"
  | "tool"
  | "place"
  | "person";

export type SnapshotItemPriority = "high" | "medium" | "low";

export type SnapshotItemTag =
  | "has_pain"
  | "buyer_intent"
  | "objection"
  | "asks_advice"
  | "service_need"
  | "budget_signal"
  | "decision_maker"
  | "active_commenter"
  | "helpful_member"
  | "strong_question"
  | "looking_for_solution"
  | "looking_for_contractor"
  | "intro_candidate"
  | "similar_to_reader"
  | "content_pattern"
  | "tool_mention"
  | "product_mention"
  | "author_recommendation"
  | "knowledge_asset"
  | "weekly_highlight"
  | "positioning_signal"
  | "discussion_seed"
  | "commercial_opportunity"
  | "action_required";

export type ChannelSnapshotItem = {
  title: string;
  description: string;
  url?: string;
  actorExternalId?: string;
  personUsername?: string;
  personName?: string;
  score?: string;
  priority?: SnapshotItemPriority;
  tags?: SnapshotItemTag[];
  confidence?: number;
  metrics?: SnapshotMetric[];
  evidence?: SnapshotEvidenceRef[];
};

export type ChannelSnapshotPeopleSegment = {
  id: string;
  title: string;
  summary: string;
  sourceCandidateIds?: string[];
  actorExternalIds: string[];
  evidence?: SnapshotEvidenceRef[];
};

export type SnapshotSignalPerson = {
  actorExternalId?: string;
  username?: string;
  name?: string;
  avatarUrl?: string;
  segments?: string[];
};

export type SnapshotSignal = {
  id: string;
  kind: SnapshotSignalKind;
  title: string;
  summary: string;
  tags: string[];
  priority?: SnapshotItemPriority;
  score?: string;
  confidence?: number;
  metrics?: SnapshotMetric[];
  evidence?: SnapshotEvidenceRef[];
  url?: string;
  person?: SnapshotSignalPerson;
};

export type ChannelSnapshotSection = {
  id: ChannelSnapshotSectionId;
  title: string;
  agent: string;
  summary: string;
  items: ChannelSnapshotItem[];
  segments?: ChannelSnapshotPeopleSegment[];
};

export type ChannelSnapshotDocument = {
  schemaVersion: typeof CHANNEL_SNAPSHOT_SCHEMA_VERSION;
  snapshotType: "channel";
  title: string;
  sourceId: string;
  chatTitle: string;
  generatedAt: string;
  period: {
    from: string | null;
    to: string | null;
  };
  signals: SnapshotSignal[];
};

export function isChannelSnapshotDocument(value: unknown): value is ChannelSnapshotDocument {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<ChannelSnapshotDocument>;

  return snapshot.schemaVersion === CHANNEL_SNAPSHOT_SCHEMA_VERSION &&
    snapshot.snapshotType === "channel" &&
    Array.isArray(snapshot.signals);
}

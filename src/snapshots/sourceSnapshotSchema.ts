export const CHANNEL_SNAPSHOT_SCHEMA_VERSION = "channel-snapshot-v3";

export type ChannelSnapshotSectionId =
  | "ideas"
  | "pains"
  | "risks"
  | "hypotheses"
  | "insights"
  | "trends"
  | "events"
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
  | "risk"
  | "hypothesis"
  | "insight"
  | "trend"
  | "event"
  | "material"
  | "tool"
  | "place"
  | "person";

export type SnapshotItemPriority = "high" | "medium" | "low";

export type SnapshotItemTag = string;

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

export type SnapshotSignalPerson = {
  actorExternalId?: string;
  username?: string;
  name?: string;
  avatarUrl?: string;
};

export type SnapshotGeneratedImage = {
  provider: "fal.ai";
  model: string;
  url: string;
  sourceUrl?: string;
  storageProvider?: "s3";
  bucket?: string;
  objectKey?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  contentType?: string;
  generatedAt: string;
  prompt: string;
  requestId?: string;
};

export type SnapshotSignalPreviewImage = SnapshotGeneratedImage;

export type SnapshotSignalTimeline = {
  firstPostAt?: string;
  firstCommentAt?: string;
  firstEvidenceAt?: string;
  lastEvidenceAt?: string;
  primaryEvidenceItemId?: string;
};

export type SnapshotExternalFact = {
  claim: string;
  sourceTitle: string;
  sourceUrl: string;
  retrievedAt: string;
  confidence: number;
};

export type SnapshotExternalContext = {
  provider: "wikipedia";
  entityName: string;
  entityType: "person" | "company" | "product" | "technology" | "book" | "place" | "event" | "concept" | "other";
  canonicalUrl?: string;
  summary?: string;
  facts: SnapshotExternalFact[];
  warnings?: string[];
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
  previewImage?: SnapshotSignalPreviewImage;
  timeline?: SnapshotSignalTimeline;
  externalContext?: SnapshotExternalContext;
};

export type ChannelSnapshotHeroTheme = {
  palette: "emerald" | "indigo" | "amber" | "rose" | "slate" | "cyan";
  motif: "network" | "notes" | "city" | "market" | "studio" | "landscape";
  mood: string;
  concept: string;
  imagePrompt: string;
};

export type ChannelSnapshotSection = {
  id: ChannelSnapshotSectionId;
  title: string;
  agent: string;
  summary: string;
  items: ChannelSnapshotItem[];
};

export type ChannelSnapshotDocument = {
  schemaVersion: typeof CHANNEL_SNAPSHOT_SCHEMA_VERSION;
  snapshotType: "channel";
  title: string;
  sourceId: string;
  chatTitle: string;
  summary?: string | null;
  generatedAt: string;
  period: {
    from: string | null;
    to: string | null;
  };
  heroTheme?: ChannelSnapshotHeroTheme;
  coverImage?: SnapshotGeneratedImage;
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

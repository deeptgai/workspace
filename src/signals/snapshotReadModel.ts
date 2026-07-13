import type { PrismaClient } from "@prisma/client";
import {
  CHANNEL_SNAPSHOT_SCHEMA_VERSION,
  type ChannelSnapshotDocument,
  type ChannelSnapshotHeroTheme,
  type SnapshotGeneratedImage,
} from "../snapshots/sourceSnapshotSchema.js";
import { snapshotSignalsAsDocumentSignals } from "./snapshotSignals.js";

type SnapshotRecord = {
  id: string;
  sourceId: string;
  title: string;
  document: unknown;
  periodFrom?: Date | null;
  periodTo?: Date | null;
  summary?: string | null;
  heroTheme?: unknown;
  coverImage?: unknown;
  createdAt: Date;
  source?: {
    title: string;
  } | null;
};

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function heroThemeValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ChannelSnapshotHeroTheme : undefined;
}

function coverImageValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SnapshotGeneratedImage : undefined;
}

export async function buildSnapshotReadModel(
  prisma: PrismaClient,
  snapshot: SnapshotRecord,
): Promise<ChannelSnapshotDocument | null> {
  const signals = await snapshotSignalsAsDocumentSignals(prisma, snapshot.id);

  if (!signals.length) {
    return null;
  }

  const metadata = recordObject(snapshot.document);
  const period = recordObject(metadata.period);

  return {
    schemaVersion: CHANNEL_SNAPSHOT_SCHEMA_VERSION,
    snapshotType: "channel",
    title: stringValue(metadata.title) ?? snapshot.title,
    sourceId: stringValue(metadata.sourceId) ?? snapshot.sourceId,
    chatTitle: stringValue(metadata.chatTitle) ?? snapshot.source?.title ?? snapshot.title.replace(/^Снимок по каналу:\s*/i, ""),
    summary: stringValue(metadata.summary) ?? snapshot.summary ?? null,
    generatedAt: stringValue(metadata.generatedAt) ?? snapshot.createdAt.toISOString(),
    period: {
      from: snapshot.periodFrom?.toISOString() ?? stringValue(period.from) ?? null,
      to: snapshot.periodTo?.toISOString() ?? stringValue(period.to) ?? null,
    },
    heroTheme: heroThemeValue(snapshot.heroTheme) ?? heroThemeValue(metadata.heroTheme),
    coverImage: coverImageValue(snapshot.coverImage) ?? coverImageValue(metadata.coverImage),
    signals,
  };
}

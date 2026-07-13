import { prisma } from "../../src/db/prisma";
import type { SnapshotSignal, SnapshotSignalKind } from "../../src/snapshots/sourceSnapshotSchema";
import { sourcePaidSignalKinds } from "../../src/sources/paidSignalKinds";
import { sourceSlug } from "../sourceSlug";
import type { getSnapshotEvidenceMessages } from "../snapshots/snapshotViewData";

const defaultLimit = 30;
const maxLimit = 60;

type SourceSignalRow = Awaited<ReturnType<typeof readSourceSignalsForFeed>>[number];

export type SignalFeedSection = SnapshotSignalKind | "all";

export type SignalFeedQuery = {
  slug: string;
  section?: SignalFeedSection;
  fromDay?: number | null;
  tag?: string | null;
  cursor?: number | null;
  limit?: number | null;
};

export async function findSignalFeedSource(slug: string) {
  const normalizedSlug = slug.trim().toLowerCase();
  const sources = await prisma.source.findMany({
    select: {
      id: true,
      title: true,
      username: true,
      paidSignalKinds: true,
    },
  });

  return sources.find((source) => sourceSlug(source.username || source.title) === normalizedSlug) ??
    sources.find((source) => source.id === slug) ??
    null;
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jsonObjectValue<T>(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}

const dayMs = 24 * 60 * 60 * 1000;

function todayDayValue() {
  return Math.floor(Date.now() / dayMs);
}

function signalDateValue(signal: SnapshotSignal) {
  const value = signal.timeline?.lastEvidenceAt ??
    signal.timeline?.firstEvidenceAt ??
    signal.timeline?.firstPostAt ??
    signal.timeline?.firstCommentAt;

  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function signalDayValue(signal: SnapshotSignal) {
  const date = signalDateValue(signal);

  return date ? Math.floor(date.getTime() / dayMs) : null;
}

function visibleSignalTags(signal: SnapshotSignal) {
  return (signal.tags ?? []).filter((tag) => tag.trim());
}

function isPaidSignal(signal: SnapshotSignal, paidSignalKinds: Set<SnapshotSignalKind>) {
  return paidSignalKinds.has(signal.kind);
}

function lockedSignalPreview(signal: SnapshotSignal, paidSignalKinds: Set<SnapshotSignalKind>): SnapshotSignal {
  if (!isPaidSignal(signal, paidSignalKinds)) {
    return signal;
  }

  return {
    ...signal,
    evidence: [],
    url: undefined,
  };
}

async function readSourceSignalsForFeed(sourceId: string) {
  return prisma.sourceSignal.findMany({
    where: {
      sourceId,
      status: "active",
    },
    include: {
      evidence: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
    orderBy: [
      {
        lastEvidenceAt: "desc",
      },
      {
        updatedAt: "desc",
      },
      {
        id: "asc",
      },
    ],
  });
}

function sourceSignalRowToSnapshotSignal(row: SourceSignalRow): SnapshotSignal {
  const metadata = recordObject(row.metadata);
  const timeline = jsonObjectValue<SnapshotSignal["timeline"]>(metadata.timeline) ?? {
    firstEvidenceAt: row.firstEvidenceAt?.toISOString(),
    lastEvidenceAt: row.lastEvidenceAt?.toISOString(),
    primaryEvidenceItemId: row.evidence[0]?.itemExternalId,
  };

  return {
    id: row.id,
    kind: row.kind as SnapshotSignalKind,
    title: row.title,
    summary: row.summary,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    priority: row.score >= 8 ? "high" : row.score >= 5 ? "medium" : "low",
    score: row.score ? String(row.score) : undefined,
    confidence: row.confidence ?? undefined,
    metrics: jsonObjectValue<SnapshotSignal["metrics"]>(metadata.metrics),
    evidence: row.evidence.map((item) => ({
      itemId: item.itemExternalId,
      quote: item.quote ?? undefined,
      reason: item.reason ?? undefined,
    })),
    person: jsonObjectValue<SnapshotSignal["person"]>(metadata.person),
    previewImage: jsonObjectValue<SnapshotSignal["previewImage"]>(row.previewImage),
    timeline,
  };
}

async function evidenceMessagesForSignals(sourceId: string, signals: SnapshotSignal[]): Promise<ReturnType<typeof getSnapshotEvidenceMessages>> {
  const evidenceIds = [...new Set(signals.flatMap((signal) => signal.evidence?.map((item) => item.itemId) ?? []))];

  if (!evidenceIds.length) {
    return [];
  }

  const rows = await prisma.contentItem.findMany({
    where: {
      sourceId,
      externalId: {
        in: evidenceIds,
      },
    },
    include: {
      actor: true,
      formats: {
        where: {
          model: process.env.AI_MODEL || "unknown",
        },
        take: 1,
      },
    },
  });

  return rows.map((message) => ({
    externalId: message.externalId,
    kind: message.kind,
    publishedAt: message.publishedAt.toISOString(),
    text: message.text,
    formattedText: message.formats[0]?.formattedText ?? null,
    views: message.views,
    forwards: message.forwards,
    reactionsTotal: message.reactionsTotal,
    repliesCount: message.repliesCount,
    engagementScore: message.engagementScore,
    user: message.actor ? {
      externalId: message.actor.externalId,
      username: message.actor.username,
      firstName: message.actor.firstName,
      lastName: message.actor.lastName,
    } : null,
  }));
}

export async function queryPublicSignalFeed(input: SignalFeedQuery) {
  const source = await findSignalFeedSource(input.slug);

  if (!source) {
    return null;
  }

  const section = input.section ?? "all";
  const fromDay = Number.isFinite(input.fromDay) ? Number(input.fromDay) : null;
  const cursor = Math.max(0, Number(input.cursor ?? 0) || 0);
  const limit = Math.min(Math.max(Number(input.limit ?? defaultLimit) || defaultLimit, 1), maxLimit);
  const selectedTag = input.tag?.trim() || "";
  const paidSignalKindSet = new Set(sourcePaidSignalKinds(source));
  const allSignals = (await readSourceSignalsForFeed(source.id)).map(sourceSignalRowToSnapshotSignal);
  const baseCountsByKind = allSignals.reduce<Partial<Record<SnapshotSignalKind | "all", number>>>((counts, signal) => {
    counts[signal.kind] = (counts[signal.kind] ?? 0) + 1;
    return counts;
  }, {});
  baseCountsByKind.all = allSignals.length;
  const timelineDays = allSignals.map(signalDayValue).filter((day): day is number => day !== null);
  const timelineBounds = timelineDays.length ? {
    min: Math.min(...timelineDays),
    max: Math.max(...timelineDays, todayDayValue()),
  } : null;
  const timeFilteredAllSignals = fromDay === null
    ? allSignals
    : allSignals.filter((signal) => {
        const day = signalDayValue(signal);

        return day === null ? false : day >= fromDay;
      });
  const timelineMarkers = allSignals
    .map((signal) => {
      const day = signalDayValue(signal);

      if (day === null) {
        return null;
      }

      return {
        id: signal.id,
        kind: signal.kind,
        day,
        tags: visibleSignalTags(signal),
      };
    })
    .filter((marker): marker is { id: string; kind: SnapshotSignalKind; day: number; tags: string[] } => marker !== null);
  const countsByKind = timeFilteredAllSignals.reduce<Partial<Record<SnapshotSignalKind | "all", number>>>((counts, signal) => {
    counts[signal.kind] = (counts[signal.kind] ?? 0) + 1;
    return counts;
  }, {});
  const timeFilteredPublicSignals = timeFilteredAllSignals.filter((signal) => !isPaidSignal(signal, paidSignalKindSet));
  countsByKind.all = timeFilteredAllSignals.length;
  const sectionSignals = section === "all"
    ? timeFilteredAllSignals.map((signal) => lockedSignalPreview(signal, paidSignalKindSet))
    : paidSignalKindSet.has(section as SnapshotSignalKind)
      ? timeFilteredAllSignals.filter((signal) => signal.kind === section).map((signal) => lockedSignalPreview(signal, paidSignalKindSet))
      : timeFilteredPublicSignals.filter((signal) => signal.kind === section);
  const tagCounts = new Map<string, number>();

  for (const signal of sectionSignals) {
    for (const tag of visibleSignalTags(signal)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .slice(0, 12)
    .map(([tag, count]) => ({ tag, count }));
  const filteredSignals = selectedTag
    ? sectionSignals.filter((signal) => visibleSignalTags(signal).includes(selectedTag))
    : sectionSignals;
  const pageSignals = filteredSignals.slice(cursor, cursor + limit);
  const nextCursor = cursor + pageSignals.length;
  const evidenceMessages = await evidenceMessagesForSignals(
    source.id,
    pageSignals.filter((signal) => !isPaidSignal(signal, paidSignalKindSet)),
  );

  return {
    sourceId: source.id,
    signals: pageSignals,
    evidenceMessages,
    baseCountsByKind,
    countsByKind,
    tags,
    total: filteredSignals.length,
    nextCursor: nextCursor < filteredSignals.length ? nextCursor : null,
    hasMore: nextCursor < filteredSignals.length,
    timelineBounds,
    timelineMarkers,
  };
}

import type { PrismaClient } from "@prisma/client";
import type { SnapshotSignal, SnapshotSignalTimeline } from "./sourceSnapshotSchema.js";

type TimelineEvidenceItem = {
  externalId: string;
  kind: string;
  publishedAt: Date;
  parent: {
    externalId: string;
    kind: string;
    publishedAt: Date;
  } | null;
};

function minIso(dates: Date[]) {
  if (!dates.length) {
    return undefined;
  }

  return new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString();
}

function maxIso(dates: Date[]) {
  if (!dates.length) {
    return undefined;
  }

  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function signalTimeline(signal: SnapshotSignal, evidenceByExternalId: Map<string, TimelineEvidenceItem>): SnapshotSignalTimeline | undefined {
  const evidenceRefs = signal.evidence ?? [];
  const evidenceItems = evidenceRefs
    .map((evidence) => evidenceByExternalId.get(evidence.itemId))
    .filter((item): item is TimelineEvidenceItem => Boolean(item));

  if (!evidenceItems.length) {
    return signal.timeline;
  }

  const evidenceDates = evidenceItems.map((item) => item.publishedAt);
  const postDates: Date[] = [];
  const commentDates: Date[] = [];

  for (const item of evidenceItems) {
    if (item.kind === "comment") {
      commentDates.push(item.publishedAt);

      if (item.parent?.publishedAt) {
        postDates.push(item.parent.publishedAt);
      }
    } else {
      postDates.push(item.publishedAt);
    }
  }

  return {
    ...signal.timeline,
    firstPostAt: minIso(postDates),
    firstCommentAt: minIso(commentDates),
    firstEvidenceAt: minIso(evidenceDates),
    lastEvidenceAt: maxIso(evidenceDates),
    primaryEvidenceItemId: evidenceRefs.find((evidence) => evidenceByExternalId.has(evidence.itemId))?.itemId,
  };
}

export async function enrichSignalsWithTimeline(
  prisma: PrismaClient,
  sourceId: string,
  signals: SnapshotSignal[],
): Promise<SnapshotSignal[]> {
  const evidenceIds = [...new Set(signals.flatMap((signal) => (signal.evidence ?? []).map((evidence) => evidence.itemId)))];

  if (!evidenceIds.length) {
    return signals;
  }

  const evidenceItems = await prisma.contentItem.findMany({
    where: {
      sourceId,
      externalId: {
        in: evidenceIds,
      },
    },
    select: {
      externalId: true,
      kind: true,
      publishedAt: true,
      parent: {
        select: {
          externalId: true,
          kind: true,
          publishedAt: true,
        },
      },
    },
  });
  const evidenceByExternalId = new Map(evidenceItems.map((item) => [item.externalId, item]));

  return signals.map((signal) => ({
    ...signal,
    timeline: signalTimeline(signal, evidenceByExternalId),
  }));
}

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SnapshotSignal } from "../snapshots/sourceSnapshotSchema.js";

function cleanText(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalClaim(signal: SnapshotSignal) {
  return cleanText(`${signal.title}. ${signal.summary}`).slice(0, 600);
}

function signalFingerprint(sourceId: string, signal: SnapshotSignal) {
  const canonical = canonicalClaim(signal).toLowerCase();

  return createHash("sha256")
    .update([sourceId, signal.kind, canonical].join("\n"))
    .digest("hex");
}

function signalSortAt(signal: SnapshotSignal) {
  const candidate =
    signal.timeline?.lastEvidenceAt ||
    signal.timeline?.firstEvidenceAt ||
    signal.timeline?.firstCommentAt ||
    signal.timeline?.firstPostAt;

  if (!candidate) {
    return undefined;
  }

  const date = new Date(candidate);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function jsonOrNull(value: unknown) {
  return value === undefined ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

export async function replaceSnapshotSignals(
  prisma: PrismaClient,
  params: {
    snapshotId: string;
    sourceId: string;
    signals: SnapshotSignal[];
  },
) {
  const evidenceExternalIds = [...new Set(params.signals.flatMap((signal) =>
    (signal.evidence ?? []).map((evidence) => evidence.itemId).filter(Boolean),
  ))];
  const contentItems = evidenceExternalIds.length
    ? await prisma.contentItem.findMany({
        where: {
          sourceId: params.sourceId,
          externalId: {
            in: evidenceExternalIds,
          },
        },
        select: {
          id: true,
          externalId: true,
        },
      })
    : [];
  const contentItemByExternalId = new Map(contentItems.map((item) => [item.externalId, item.id]));

  await prisma.$transaction(async (tx) => {
    await tx.snapshotSignal.deleteMany({
      where: {
        snapshotId: params.snapshotId,
      },
    });

    for (const [index, signal] of params.signals.entries()) {
      const createdSignal = await tx.snapshotSignal.create({
        data: {
          snapshotId: params.snapshotId,
          sourceId: params.sourceId,
          externalSignalId: signal.id,
          kind: signal.kind,
          title: signal.title,
          summary: signal.summary,
          canonicalClaim: canonicalClaim(signal),
          fingerprint: signalFingerprint(params.sourceId, signal),
          tags: jsonOrNull(signal.tags),
          priority: signal.priority,
          score: signal.score,
          confidence: signal.confidence,
          metrics: jsonOrNull(signal.metrics),
          url: signal.url,
          person: jsonOrNull(signal.person),
          previewImage: jsonOrNull(signal.previewImage),
          timeline: jsonOrNull(signal.timeline),
          externalContext: jsonOrNull(signal.externalContext),
          sortAt: signalSortAt(signal),
          status: "pending",
          resolution: Prisma.JsonNull,
        },
      });

      const evidence = signal.evidence ?? [];

      if (!evidence.length) {
        continue;
      }

      await tx.snapshotSignalEvidence.createMany({
        data: evidence.map((item, evidenceIndex) => ({
          snapshotSignalId: createdSignal.id,
          contentItemId: contentItemByExternalId.get(item.itemId),
          itemExternalId: item.itemId,
          quote: item.quote,
          reason: item.reason,
          position: evidenceIndex,
        })),
        skipDuplicates: true,
      });

      if (index > 0 && index % 50 === 0) {
        await tx.$queryRaw`select 1`;
      }
    }
  });

  return {
    snapshotId: params.snapshotId,
    sourceId: params.sourceId,
    signals: params.signals.length,
    evidence: params.signals.reduce((total, signal) => total + (signal.evidence?.length ?? 0), 0),
  };
}

export async function snapshotSignalsAsDocumentSignals(
  prisma: PrismaClient,
  snapshotId: string,
): Promise<SnapshotSignal[]> {
  const rows = await prisma.snapshotSignal.findMany({
    where: {
      snapshotId,
    },
    include: {
      evidence: {
        orderBy: {
          position: "asc",
        },
      },
    },
    orderBy: [
      {
        sortAt: "desc",
      },
      {
        createdAt: "asc",
      },
    ],
  });

  return rows.map((row) => ({
    id: row.externalSignalId,
    kind: row.kind as SnapshotSignal["kind"],
    title: row.title,
    summary: row.summary,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    priority: row.priority as SnapshotSignal["priority"],
    score: row.score ?? undefined,
    confidence: row.confidence ?? undefined,
    metrics: Array.isArray(row.metrics) ? row.metrics as SnapshotSignal["metrics"] : undefined,
    evidence: row.evidence.map((item) => ({
      itemId: item.itemExternalId,
      quote: item.quote ?? undefined,
      reason: item.reason ?? undefined,
    })),
    url: row.url ?? undefined,
    person: row.person && typeof row.person === "object" && !Array.isArray(row.person)
      ? row.person as SnapshotSignal["person"]
      : undefined,
    previewImage: row.previewImage && typeof row.previewImage === "object" && !Array.isArray(row.previewImage)
      ? row.previewImage as SnapshotSignal["previewImage"]
      : undefined,
    timeline: row.timeline && typeof row.timeline === "object" && !Array.isArray(row.timeline)
      ? row.timeline as SnapshotSignal["timeline"]
      : undefined,
    externalContext: row.externalContext && typeof row.externalContext === "object" && !Array.isArray(row.externalContext)
      ? row.externalContext as SnapshotSignal["externalContext"]
      : undefined,
  }));
}

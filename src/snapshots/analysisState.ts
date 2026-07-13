import { Prisma, type PrismaClient, type Source } from "@prisma/client";

const dayMs = 24 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export type SnapshotAnalysisMode = "initial" | "incremental";

export type SnapshotAnalysisWindow = {
  mode: SnapshotAnalysisMode;
  sourceId: string;
  previousContentCreatedAt: Date | null;
  previousPublishedAt: Date | null;
  toContentCreatedAt: Date | null;
  toPublishedAt: Date | null;
  overlapPublishedAt: Date | null;
  newContentCount: number;
  contentCount: number;
};

function envNonNegativeInt(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function minusDays(value: Date, days: number) {
  return new Date(value.getTime() - days * dayMs);
}

function maxDate(...values: Array<Date | null | undefined>) {
  const dates = values.filter((value): value is Date => Boolean(value));

  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
}

export function snapshotAnalysisWindowToJson(window: SnapshotAnalysisWindow): Prisma.InputJsonValue {
  return {
    mode: window.mode,
    sourceId: window.sourceId,
    previousContentCreatedAt: isoDate(window.previousContentCreatedAt),
    previousPublishedAt: isoDate(window.previousPublishedAt),
    toContentCreatedAt: isoDate(window.toContentCreatedAt),
    toPublishedAt: isoDate(window.toPublishedAt),
    overlapPublishedAt: isoDate(window.overlapPublishedAt),
    newContentCount: window.newContentCount,
    contentCount: window.contentCount,
  };
}

export function snapshotAnalysisWindowFromJson(value: unknown, sourceId: string): SnapshotAnalysisWindow | null {
  const window = recordValue(value);
  const mode = window.mode === "incremental" ? "incremental" : window.mode === "initial" ? "initial" : null;

  if (!mode) {
    return null;
  }

  return {
    mode,
    sourceId,
    previousContentCreatedAt: dateValue(window.previousContentCreatedAt),
    previousPublishedAt: dateValue(window.previousPublishedAt),
    toContentCreatedAt: dateValue(window.toContentCreatedAt),
    toPublishedAt: dateValue(window.toPublishedAt),
    overlapPublishedAt: dateValue(window.overlapPublishedAt),
    newContentCount: typeof window.newContentCount === "number" ? window.newContentCount : 0,
    contentCount: typeof window.contentCount === "number" ? window.contentCount : 0,
  };
}

export function snapshotAnalysisWindowFromPipeline(pipeline: unknown, sourceId: string) {
  const analysis = recordValue(recordValue(pipeline).analysis);

  return snapshotAnalysisWindowFromJson(analysis.window, sourceId);
}

function contentWindowPredicate(window: SnapshotAnalysisWindow): Prisma.ContentItemWhereInput {
  const createdAtCap = window.toContentCreatedAt
    ? {
        createdAt: {
          lte: window.toContentCreatedAt,
        },
      } satisfies Prisma.ContentItemWhereInput
    : {};

  if (window.mode === "initial") {
    return createdAtCap;
  }

  const windowBranches: Prisma.ContentItemWhereInput[] = [];

  if (window.previousContentCreatedAt) {
    windowBranches.push({
      createdAt: {
        gt: window.previousContentCreatedAt,
      },
    });
  }

  if (window.overlapPublishedAt) {
    windowBranches.push({
      publishedAt: {
        gte: window.overlapPublishedAt,
      },
    });
  }

  if (!windowBranches.length) {
    return createdAtCap;
  }

  return {
    AND: [
      createdAtCap,
      {
        OR: windowBranches,
      },
    ],
  };
}

export function contentWhereForAnalysisWindow(
  window: SnapshotAnalysisWindow,
  extra?: Prisma.ContentItemWhereInput,
): Prisma.ContentItemWhereInput {
  return {
    AND: [
      {
        sourceId: window.sourceId,
      },
      contentWindowPredicate(window),
      ...(extra ? [extra] : []),
    ],
  };
}

export function nestedContentWhereForAnalysisWindow(
  window: SnapshotAnalysisWindow,
  extra?: Prisma.ContentItemWhereInput,
): Prisma.ContentItemWhereInput {
  return {
    AND: [
      contentWindowPredicate(window),
      ...(extra ? [extra] : []),
    ],
  };
}

function newContentWhere(
  sourceId: string,
  previousContentCreatedAt: Date | null,
  previousPublishedAt: Date | null,
  toContentCreatedAt: Date | null,
): Prisma.ContentItemWhereInput {
  const createdAtCap = toContentCreatedAt
    ? {
        createdAt: {
          lte: toContentCreatedAt,
        },
      } satisfies Prisma.ContentItemWhereInput
    : {};

  if (previousContentCreatedAt) {
    return {
      AND: [
        {
          sourceId,
          createdAt: {
            gt: previousContentCreatedAt,
          },
        },
        createdAtCap,
      ],
    };
  }

  if (previousPublishedAt) {
    return {
      AND: [
        {
          sourceId,
          publishedAt: {
            gt: previousPublishedAt,
          },
        },
        createdAtCap,
      ],
    };
  }

  return {
    AND: [
      {
        sourceId,
      },
      createdAtCap,
    ],
  };
}

export async function planSnapshotAnalysisWindow(
  prisma: PrismaClient,
  source: Source,
): Promise<SnapshotAnalysisWindow> {
  const [state, bounds] = await Promise.all([
    prisma.sourceAnalysisState.findUnique({
      where: {
        sourceId: source.id,
      },
      select: {
        lastAnalyzedContentCreatedAt: true,
        lastAnalyzedPublishedAt: true,
      },
    }),
    prisma.contentItem.aggregate({
      where: {
        sourceId: source.id,
      },
      _max: {
        createdAt: true,
        publishedAt: true,
      },
    }),
  ]);
  const previousContentCreatedAt = state?.lastAnalyzedContentCreatedAt ?? null;
  const previousPublishedAt = state?.lastAnalyzedPublishedAt ?? null;
  const toContentCreatedAt = bounds._max.createdAt;
  const toPublishedAt = bounds._max.publishedAt;
  const mode: SnapshotAnalysisMode = previousContentCreatedAt || previousPublishedAt ? "incremental" : "initial";
  const overlapDays = envNonNegativeInt("SNAPSHOT_ANALYSIS_OVERLAP_DAYS", 7);
  const overlapPublishedAt = mode === "incremental" && previousPublishedAt
    ? minusDays(previousPublishedAt, overlapDays)
    : null;
  const newWhere = newContentWhere(source.id, previousContentCreatedAt, previousPublishedAt, toContentCreatedAt);
  const draftWindow: SnapshotAnalysisWindow = {
    mode,
    sourceId: source.id,
    previousContentCreatedAt,
    previousPublishedAt,
    toContentCreatedAt,
    toPublishedAt,
    overlapPublishedAt,
    newContentCount: 0,
    contentCount: 0,
  };
  const [newContentCount, contentCount] = await Promise.all([
    prisma.contentItem.count({
      where: newWhere,
    }),
    prisma.contentItem.count({
      where: contentWhereForAnalysisWindow(draftWindow),
    }),
  ]);

  return {
    ...draftWindow,
    newContentCount,
    contentCount,
  };
}

export async function readSnapshotAnalysisWindow(
  prisma: PrismaClient,
  snapshotId: string,
  sourceId: string,
) {
  const snapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
    select: {
      pipeline: true,
    },
  });

  return snapshotAnalysisWindowFromPipeline(snapshot?.pipeline, sourceId);
}

export async function markSnapshotAnalysisComplete(
  prisma: PrismaClient,
  snapshotId: string,
) {
  const snapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
    select: {
      id: true,
      sourceId: true,
      status: true,
      periodTo: true,
      pipeline: true,
      source: {
        select: {
          provider: true,
        },
      },
    },
  });

  if (!snapshot || snapshot.status !== "completed") {
    return null;
  }

  const window = snapshotAnalysisWindowFromPipeline(snapshot.pipeline, snapshot.sourceId);

  if (!window?.toContentCreatedAt) {
    return null;
  }

  const latestContentItem = await prisma.contentItem.findFirst({
    where: {
      sourceId: snapshot.sourceId,
      createdAt: {
        lte: window.toContentCreatedAt,
      },
    },
    orderBy: [
      {
        publishedAt: "desc",
      },
      {
        externalId: "desc",
      },
    ],
    select: {
      externalId: true,
    },
  });
  const lastAnalyzedPublishedAt = maxDate(window.toPublishedAt, snapshot.periodTo);
  const now = new Date();
  const cursor = {
    lastAnalyzedContentCreatedAt: window.toContentCreatedAt.toISOString(),
    lastAnalyzedPublishedAt: isoDate(lastAnalyzedPublishedAt),
    lastSnapshotId: snapshot.id,
    updatedAt: now.toISOString(),
  } satisfies Prisma.InputJsonValue;

  return prisma.sourceAnalysisState.upsert({
    where: {
      sourceId: snapshot.sourceId,
    },
    create: {
      sourceId: snapshot.sourceId,
      provider: snapshot.source.provider,
      lastAnalyzedContentCreatedAt: window.toContentCreatedAt,
      lastAnalyzedPublishedAt,
      lastAnalyzedExternalId: latestContentItem?.externalId ?? null,
      lastSnapshotId: snapshot.id,
      cursor,
      completedAt: now,
    },
    update: {
      provider: snapshot.source.provider,
      lastAnalyzedContentCreatedAt: window.toContentCreatedAt,
      lastAnalyzedPublishedAt,
      lastAnalyzedExternalId: latestContentItem?.externalId ?? undefined,
      lastSnapshotId: snapshot.id,
      cursor,
      completedAt: now,
    },
  });
}

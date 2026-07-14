import { Prisma, type PrismaClient } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

export type SnapshotPipelineStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type SnapshotPipelinePatch = {
  status?: SnapshotPipelineStageStatus;
  import?: JsonRecord;
  embeddings?: JsonRecord;
  analysis?: JsonRecord;
  sections?: JsonRecord;
  snapshot?: JsonRecord;
  curation?: JsonRecord;
  formatting?: JsonRecord;
  images?: JsonRecord;
  errors?: unknown[];
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function mergeRecord(current: unknown, patch: unknown): JsonRecord {
  const next = {
    ...asRecord(current),
  };

  for (const [key, value] of Object.entries(asRecord(patch))) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  return next;
}

export async function patchSnapshotPipeline(
  prisma: PrismaClient,
  snapshotId: string,
  patch: SnapshotPipelinePatch,
) {
  const snapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
    select: {
      pipeline: true,
    },
  });

  if (!snapshot) {
    return null;
  }

  const current = asRecord(snapshot.pipeline);
  const next: JsonRecord = {
    ...current,
    updatedAt: new Date().toISOString(),
  };

  if (patch.status) {
    next.status = patch.status;
  }

  for (const key of ["import", "embeddings", "analysis", "sections", "snapshot", "curation", "formatting", "images"] as const) {
    if (patch[key]) {
      next[key] = mergeRecord(current[key], patch[key]);
    }
  }

  if (patch.errors) {
    next.errors = [
      ...(Array.isArray(current.errors) ? current.errors : []),
      ...patch.errors,
    ];
  }

  return prisma.sourceSnapshot.update({
    where: {
      id: snapshotId,
    },
    data: {
      pipeline: next as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      pipeline: true,
    },
  });
}

export function initialSnapshotPipeline(params: {
  startedBy: "ui" | "cli" | "worker";
  model: string;
}): Prisma.InputJsonValue {
  const now = new Date().toISOString();

  return {
    status: "pending",
    startedBy: params.startedBy,
    model: params.model,
    createdAt: now,
    updatedAt: now,
    snapshot: {
      status: "pending",
    },
    analysis: {
      status: "pending",
    },
    sections: {
      status: "pending",
      total: 0,
      completed: 0,
      failed: 0,
    },
    curation: {
      status: "pending",
      processed: 0,
    },
    formatting: {
      status: "pending",
    },
    images: {
      status: "pending",
      previewsTotal: 0,
      previewsCompleted: 0,
    },
  } satisfies Prisma.InputJsonValue;
}

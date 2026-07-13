"use server";

import { Queue } from "bullmq";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "../src/db/prisma";
import { enqueueSourceSnapshotJob } from "../src/queue/snapshotQueue";
import { initialSnapshotPipeline } from "../src/snapshots/pipeline";

type TelegramImportJobData = {
  chat: string;
  mode: "sync" | "backfill" | "new";
  limit: number;
  batchSize: number;
  sleepMs: number;
  sinceDateIso?: string;
  phase?: "backfill" | "new";
  remaining?: number;
  importedTotal?: number;
  chainId?: string;
  importCommentsAfter?: {
    mode: "sync" | "new";
    postLimit: number;
    commentsPerPost: number;
  };
};

type SourceSnapshotSectionJobData = {
  chat: string;
  snapshotId: string;
  sectionId: string;
};

function redisConnectionOptions() {
  const url = new URL(process.env.REDIS_URL || "redis://localhost:6379");

  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

function slug(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9а-яё_-]+/giu, "-");
}

function uniqueJobId(prefix: string, chat: string) {
  return `${slug(prefix)}--${slug(chat)}--${Date.now()}--${Math.random().toString(36).slice(2, 8)}`;
}

function envInt(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function importSinceDateIso() {
  const days = envInt("TELEGRAM_IMPORT_SINCE_DAYS", 365);

  if (days <= 0) {
    return undefined;
  }

  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function chatRef(chat: { username: string | null; externalId: string }) {
  return chat.username ? `@${chat.username}` : chat.externalId;
}

async function enqueueTelegramImportJob(data: TelegramImportJobData) {
  const queue = new Queue<TelegramImportJobData, unknown, string>("telegram-import", {
    connection: redisConnectionOptions(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });

  try {
    return await queue.add("import", data, {
      jobId: uniqueJobId(`import-${data.mode}`, data.chat),
    });
  } finally {
    await queue.close();
  }
}

async function enqueueSnapshotSectionJob(data: SourceSnapshotSectionJobData) {
  const queue = new Queue<SourceSnapshotSectionJobData, unknown, string>("source-snapshot-section", {
    connection: redisConnectionOptions(),
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 10000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });

  try {
    return await queue.add("section", data, {
      jobId: uniqueJobId(`snapshot-section-${data.sectionId}`, data.snapshotId),
    });
  } finally {
    await queue.close();
  }
}

export async function createSnapshotAction(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");

  if (!sourceId) {
    throw new Error("Missing sourceId.");
  }

  const chat = await prisma.source.findUnique({
    where: {
      id: sourceId,
    },
  });

  if (!chat) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  const snapshot = await prisma.sourceSnapshot.create({
    data: {
      sourceId: chat.id,
      kind: "channel_structured_snapshot",
      title: `Снимок по каналу: ${chat.title}`,
      status: "pending",
      model: process.env.AI_MODEL || "unknown",
      pipeline: initialSnapshotPipeline({
        startedBy: "ui",
        model: process.env.AI_MODEL || "unknown",
      }),
    },
  });

  await enqueueSourceSnapshotJob({
    chat: chatRef(chat),
    snapshotId: snapshot.id,
  });

  revalidatePath("/");
  revalidatePath(`/sources/${chat.id}`);

  redirect(`/sources/${chat.id}?snapshot=queued`);
}

export async function retrySnapshotSectionAction(formData: FormData) {
  const snapshotId = String(formData.get("snapshotId") ?? "");
  const sectionId = String(formData.get("sectionId") ?? "");

  if (!snapshotId || !sectionId) {
    throw new Error("Missing snapshotId or sectionId.");
  }

  const snapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
    include: {
      source: true,
    },
  });

  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  await prisma.$transaction([
    prisma.sourceSnapshot.update({
      where: {
        id: snapshotId,
      },
      data: {
        status: "running",
        error: null,
        completedAt: null,
      },
    }),
    prisma.sourceSnapshotSection.update({
      where: {
        snapshotId_sectionId: {
          snapshotId,
          sectionId,
        },
      },
      data: {
        status: "pending",
        error: null,
        startedAt: null,
        completedAt: null,
      },
    }),
  ]);

  await enqueueSnapshotSectionJob({
    chat: chatRef(snapshot.source),
    snapshotId,
    sectionId,
  });

  revalidatePath(`/sources/${snapshot.sourceId}`);
  redirect(`/sources/${snapshot.sourceId}?snapshot=queued`);
}

export async function addTrackedSourceAction(formData: FormData) {
  const chat = String(formData.get("chat") ?? "").trim();

  if (!chat) {
    throw new Error("Missing channel or group.");
  }

  await enqueueTelegramImportJob({
    chat,
    mode: "sync",
    limit: envInt("UI_FULL_IMPORT_LIMIT", 500),
    batchSize: envInt("TELEGRAM_IMPORT_BATCH_SIZE", 100),
    sleepMs: envInt("TELEGRAM_IMPORT_SLEEP_MS", 3000),
    sinceDateIso: importSinceDateIso(),
    importCommentsAfter: {
      mode: "sync",
      postLimit: envInt("UI_FULL_COMMENT_POST_LIMIT", 100),
      commentsPerPost: envInt("UI_FULL_COMMENTS_PER_POST", 100),
    },
  });

  revalidatePath("/");
  redirect("/?import=source_queued");
}

export async function checkUpdatesAction(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");

  if (!sourceId) {
    throw new Error("Missing sourceId.");
  }

  const chat = await prisma.source.findUnique({
    where: {
      id: sourceId,
    },
  });

  if (!chat) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  await enqueueTelegramImportJob({
    chat: chatRef(chat),
    mode: "new",
    limit: envInt("UI_UPDATE_IMPORT_LIMIT", 200),
    batchSize: envInt("TELEGRAM_IMPORT_BATCH_SIZE", 100),
    sleepMs: envInt("TELEGRAM_IMPORT_SLEEP_MS", 3000),
    sinceDateIso: importSinceDateIso(),
    importCommentsAfter: {
      mode: "new",
      postLimit: envInt("UI_UPDATE_COMMENT_POST_LIMIT", 80),
      commentsPerPost: envInt("UI_UPDATE_COMMENTS_PER_POST", 100),
    },
  });

  revalidatePath("/");
  revalidatePath(`/sources/${chat.id}`);

  redirect(`/sources/${chat.id}?import=updates_queued`);
}

export async function fullImportAction(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");

  if (!sourceId) {
    throw new Error("Missing sourceId.");
  }

  const chat = await prisma.source.findUnique({
    where: {
      id: sourceId,
    },
  });

  if (!chat) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  await prisma.$transaction([
    prisma.sourceSnapshot.deleteMany({
      where: {
        sourceId: chat.id,
      },
    }),
    prisma.contentItem.deleteMany({
      where: {
        sourceId: chat.id,
      },
    }),
    prisma.sourceImportState.deleteMany({
      where: {
        sourceId: chat.id,
      },
    }),
    prisma.source.update({
      where: {
        id: chat.id,
      },
      data: {
        lastImportAt: null,
      },
    }),
  ]);

  await enqueueTelegramImportJob({
    chat: chatRef(chat),
    mode: "sync",
    limit: envInt("UI_FULL_IMPORT_LIMIT", 500),
    batchSize: envInt("TELEGRAM_IMPORT_BATCH_SIZE", 100),
    sleepMs: envInt("TELEGRAM_IMPORT_SLEEP_MS", 3000),
    sinceDateIso: importSinceDateIso(),
    importCommentsAfter: {
      mode: "sync",
      postLimit: envInt("UI_FULL_COMMENT_POST_LIMIT", 100),
      commentsPerPost: envInt("UI_FULL_COMMENTS_PER_POST", 100),
    },
  });

  revalidatePath("/");
  revalidatePath(`/sources/${chat.id}`);

  redirect(`/sources/${chat.id}?import=full_queued`);
}

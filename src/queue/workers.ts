import { Queue, Worker } from "bullmq";
import { loadConfig } from "../config.js";
import { findStoredSource } from "../db/sources.js";
import { prisma } from "../db/prisma.js";
import { loadAiConfig } from "../ai/config.js";
import { loadEmbeddingsConfig } from "../embeddings/config.js";
import { importChannelComments } from "../import/importComments.js";
import { importMessageBatch, type ImportBatchPhase } from "../import/importMessages.js";
import { embedMessages } from "../rag/embedMessages.js";
import { generateCommunitySnapshot, generateCommunitySnapshotSection } from "../snapshots/communitySnapshot.js";
import { generateAndStoreSnapshotCoverImage } from "../images/snapshotCoverImages.js";
import { generateAndStoreSignalPreviewImage } from "../images/signalPreviewImages.js";
import { connectTelegramClient } from "../telegram/client.js";
import { resolveDialogEntity } from "../telegram/dialogs.js";
import { createRedisConnectionOptions } from "./connection.js";
import { SOURCE_SNAPSHOT_QUEUE, SOURCE_SNAPSHOT_SECTION_QUEUE, COMMENT_IMPORT_QUEUE, MESSAGE_EMBEDDING_QUEUE, TELEGRAM_IMPORT_QUEUE, SIGNAL_PREVIEW_IMAGE_QUEUE, SNAPSHOT_COVER_IMAGE_QUEUE } from "./names.js";
import type { SourceSnapshotJobData, SourceSnapshotSectionJobData, CommentImportJobData, ContentEmbeddingJobData, TelegramImportJobData, SignalPreviewImageJobData, SnapshotCoverImageJobData } from "./types.js";

function sectionJobId(snapshotId: string, sectionId: string) {
  return `snapshot-section--${snapshotId}--${sectionId}`.replace(/[^a-z0-9_-]+/giu, "-");
}

function envInt(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function slug(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9а-яё_-]+/giu, "-");
}

function initialImportPhase(mode: TelegramImportJobData["mode"]): ImportBatchPhase {
  return mode === "new" ? "new" : "backfill";
}

function nextImportPhase(data: TelegramImportJobData, phase: ImportBatchPhase, reachedEnd: boolean) {
  if (data.mode === "sync" && phase === "new" && reachedEnd) {
    return "backfill";
  }

  return phase;
}

function shouldContinueImport(data: TelegramImportJobData, phase: ImportBatchPhase, imported: number, reachedEnd: boolean) {
  if ((data.remaining ?? data.limit) - imported <= 0) {
    return false;
  }

  if (data.mode === "sync" && phase === "new" && reachedEnd) {
    return true;
  }

  return imported > 0 && !reachedEnd;
}

function importContinuationJobId(data: TelegramImportJobData, phase: ImportBatchPhase, remaining: number, importedTotal: number) {
  const chainId = data.chainId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return `import-batch--${slug(data.chat)}--${slug(chainId)}--${phase}--${remaining}--${importedTotal}`;
}

function parseSinceDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const publishedAt = new Date(value);

  return Number.isNaN(publishedAt.getTime()) ? undefined : publishedAt;
}

export function startWorkers() {
  const snapshotSectionConcurrency = envInt("SNAPSHOT_SECTION_WORKER_CONCURRENCY", 4);
  const snapshotCoverImageConcurrency = envInt("SNAPSHOT_COVER_IMAGE_WORKER_CONCURRENCY", 2);
  const signalPreviewImageConcurrency = envInt("SIGNAL_PREVIEW_IMAGE_WORKER_CONCURRENCY", 10);
  const importConnection = createRedisConnectionOptions();
  const commentImportConnection = createRedisConnectionOptions();
  const embeddingConnection = createRedisConnectionOptions();
  const snapshotConnection = createRedisConnectionOptions();
  const snapshotSectionConnection = createRedisConnectionOptions();
  const snapshotCoverImageConnection = createRedisConnectionOptions();
  const signalPreviewImageConnection = createRedisConnectionOptions();
  const contentEmbeddingQueue = new Queue<ContentEmbeddingJobData, unknown, string>(MESSAGE_EMBEDDING_QUEUE, {
    connection: createRedisConnectionOptions(),
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
  const commentImportQueue = new Queue<CommentImportJobData, unknown, string>(COMMENT_IMPORT_QUEUE, {
    connection: createRedisConnectionOptions(),
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });
  const snapshotSectionQueue = new Queue<SourceSnapshotSectionJobData, unknown, string>(SOURCE_SNAPSHOT_SECTION_QUEUE, {
    connection: createRedisConnectionOptions(),
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
  const snapshotCoverImageQueue = new Queue<SnapshotCoverImageJobData, unknown, string>(SNAPSHOT_COVER_IMAGE_QUEUE, {
    connection: createRedisConnectionOptions(),
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
  const signalPreviewImageQueue = new Queue<SignalPreviewImageJobData, unknown, string>(SIGNAL_PREVIEW_IMAGE_QUEUE, {
    connection: createRedisConnectionOptions(),
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 10000,
      },
      removeOnComplete: 500,
      removeOnFail: 200,
    },
  });
  const telegramImportQueue = new Queue<TelegramImportJobData, unknown, string>(TELEGRAM_IMPORT_QUEUE, {
    connection: createRedisConnectionOptions(),
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

  const importWorker = new Worker<TelegramImportJobData>(
    TELEGRAM_IMPORT_QUEUE,
    async (job) => {
      console.log(`[${TELEGRAM_IMPORT_QUEUE}] job ${job.id} started`, job.data);

      const client = await connectTelegramClient(loadConfig());

      try {
        const entity = await resolveDialogEntity(client, job.data.chat);
        const phase = job.data.phase ?? initialImportPhase(job.data.mode);
        const remaining = job.data.remaining ?? job.data.limit;
        const importedTotal = job.data.importedTotal ?? 0;
        const batchLimit = Math.min(job.data.batchSize, remaining);
        const chainId = job.data.chainId ?? String(job.id ?? importContinuationJobId(job.data, phase, remaining, importedTotal));
        const sinceDate = parseSinceDate(job.data.sinceDateIso);
        const result = await importMessageBatch(prisma, client, entity, {
          mode: job.data.mode,
          phase,
          limit: batchLimit,
          batchSize: job.data.batchSize,
          sleepMs: job.data.sleepMs,
          sinceDate,
        });
        const nextRemaining = Math.max(remaining - result.imported, 0);
        const nextImportedTotal = importedTotal + result.imported;
        const shouldContinue = shouldContinueImport(job.data, phase, result.imported, result.reachedEnd);
        const nextPhase = nextImportPhase(job.data, phase, result.reachedEnd);

        if (result.imported > 0) {
          const embeddingJob = await contentEmbeddingQueue.add("embed", {
            chat: job.data.chat,
            limit: result.imported,
          }, {
            jobId: `embed-after-import--${job.id}`,
          });

          console.log(
            `[${TELEGRAM_IMPORT_QUEUE}] enqueued ${MESSAGE_EMBEDDING_QUEUE} job ${embeddingJob.id} for ${result.imported} imported messages`,
          );
        }

        if (shouldContinue) {
          const nextData: TelegramImportJobData = {
            ...job.data,
            phase: nextPhase,
            remaining: nextRemaining,
            importedTotal: nextImportedTotal,
            chainId,
          };
          const nextJob = await telegramImportQueue.add("import", nextData, {
            delay: job.data.sleepMs,
            jobId: importContinuationJobId(nextData, nextPhase, nextRemaining, nextImportedTotal),
          });

          console.log(
            `[${TELEGRAM_IMPORT_QUEUE}] scheduled next delayed batch ${nextJob.id}`,
            {
              chat: job.data.chat,
              mode: job.data.mode,
              phase: nextPhase,
              remaining: nextRemaining,
              importedTotal: nextImportedTotal,
              delay: job.data.sleepMs,
            },
          );
        } else if (job.data.importCommentsAfter) {
          const commentJob = await commentImportQueue.add("comments", {
            chat: job.data.chat,
            ...job.data.importCommentsAfter,
          }, {
            jobId: `comments-after-import--${job.id}`,
          });

          console.log(
            `[${TELEGRAM_IMPORT_QUEUE}] enqueued ${COMMENT_IMPORT_QUEUE} job ${commentJob.id} after post import`,
          );
        }

        const finalResult = {
          ...result,
          remaining: nextRemaining,
          importedTotal: nextImportedTotal,
          continued: shouldContinue,
          nextPhase: shouldContinue ? nextPhase : null,
        };

        console.log(`[${TELEGRAM_IMPORT_QUEUE}] job ${job.id} complete`, finalResult);
        return finalResult;
      } finally {
        await client.destroy();
      }
    },
    {
      connection: importConnection,
      concurrency: 1,
    },
  );

  const embeddingWorker = new Worker<ContentEmbeddingJobData>(
    MESSAGE_EMBEDDING_QUEUE,
    async (job) => {
      console.log(`[${MESSAGE_EMBEDDING_QUEUE}] job ${job.id} started`, job.data);

      const chat = await findStoredSource(prisma, job.data.chat);

      if (!chat) {
        throw new Error(`Source not found in database: ${job.data.chat}`);
      }

      const result = await embedMessages(prisma, loadEmbeddingsConfig(), {
        sourceId: chat.id,
        limit: job.data.limit,
      });

      console.log(`[${MESSAGE_EMBEDDING_QUEUE}] job ${job.id} complete`, result);
      return result;
    },
    {
      connection: embeddingConnection,
      concurrency: 1,
    },
  );

  const commentImportWorker = new Worker<CommentImportJobData>(
    COMMENT_IMPORT_QUEUE,
    async (job) => {
      console.log(`[${COMMENT_IMPORT_QUEUE}] job ${job.id} started`, job.data);

      const chat = await findStoredSource(prisma, job.data.chat);

      if (!chat) {
        throw new Error(`Source not found in database: ${job.data.chat}`);
      }

      const client = await connectTelegramClient(loadConfig());

      try {
        const entity = await resolveDialogEntity(client, job.data.chat);
        const result = await importChannelComments(prisma, client, entity, chat.id, {
          mode: job.data.mode,
          postLimit: job.data.postLimit,
          commentsPerPost: job.data.commentsPerPost,
        });

        if (result.imported > 0) {
          const embeddingJob = await contentEmbeddingQueue.add("embed", {
            chat: job.data.chat,
            limit: result.imported,
          }, {
            jobId: `embed-after-comments--${job.id}`,
          });

          console.log(
            `[${COMMENT_IMPORT_QUEUE}] enqueued ${MESSAGE_EMBEDDING_QUEUE} job ${embeddingJob.id} for ${result.imported} imported comments`,
          );
        }

        console.log(`[${COMMENT_IMPORT_QUEUE}] job ${job.id} complete`, result);
        return result;
      } finally {
        await client.destroy();
      }
    },
    {
      connection: commentImportConnection,
      concurrency: 1,
    },
  );

  const snapshotWorker = new Worker<SourceSnapshotJobData>(
    SOURCE_SNAPSHOT_QUEUE,
    async (job) => {
      console.log(`[${SOURCE_SNAPSHOT_QUEUE}] job ${job.id} started`, job.data);

      const chat = await findStoredSource(prisma, job.data.chat);

      if (!chat) {
        throw new Error(`Source not found in database: ${job.data.chat}`);
      }

      try {
        const result = await generateCommunitySnapshot(prisma, loadAiConfig(), {
          chat,
          snapshotId: job.data.snapshotId,
          onLog: (message, meta) => {
            console.log(
              `[${SOURCE_SNAPSHOT_QUEUE}] [agent:CommunitySnapshot] ${message}`,
              meta ?? {},
            );
          },
          onProgress: async (progress) => {
            await job.updateProgress(progress);
            console.log(`[${SOURCE_SNAPSHOT_QUEUE}] [agent:CommunitySnapshot] progress=${progress}%`);
          },
        });

        await Promise.all(result.signalJobs.map(async (signalJob) => {
          const queuedSectionJob = await snapshotSectionQueue.add("section", {
            chat: job.data.chat,
            snapshotId: result.snapshotId,
            sectionId: signalJob.signalGroupId,
          }, {
            jobId: sectionJobId(result.snapshotId, signalJob.signalGroupId),
          });

          console.log(
            `[${SOURCE_SNAPSHOT_QUEUE}] enqueued ${SOURCE_SNAPSHOT_SECTION_QUEUE} job ${queuedSectionJob.id} for ${signalJob.agent}`,
          );
        }));

        console.log(`[${SOURCE_SNAPSHOT_QUEUE}] job ${job.id} complete`, result);
        return result;
      } catch (error) {
        if (job.data.snapshotId) {
          await prisma.sourceSnapshot.update({
            where: {
              id: job.data.snapshotId,
            },
            data: {
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
              completedAt: new Date(),
            },
          });
        }

        throw error;
      }
    },
    {
      connection: snapshotConnection,
      concurrency: 1,
    },
  );

  const snapshotSectionWorker = new Worker<SourceSnapshotSectionJobData>(
    SOURCE_SNAPSHOT_SECTION_QUEUE,
    async (job) => {
      console.log(`[${SOURCE_SNAPSHOT_SECTION_QUEUE}] job ${job.id} started`, job.data);

      const chat = await findStoredSource(prisma, job.data.chat);

      if (!chat) {
        throw new Error(`Source not found in database: ${job.data.chat}`);
      }

      const result = await generateCommunitySnapshotSection(prisma, loadAiConfig(), {
        chat,
        snapshotId: job.data.snapshotId,
        sectionId: job.data.sectionId,
        onLog: (message, meta) => {
          console.log(
            `[${SOURCE_SNAPSHOT_SECTION_QUEUE}] [agent:${job.data.sectionId}] ${message}`,
            meta ?? {},
          );
        },
        onProgress: async (progress) => {
          await job.updateProgress(progress);
          console.log(`[${SOURCE_SNAPSHOT_SECTION_QUEUE}] [agent:${job.data.sectionId}] progress=${progress}%`);
        },
      });

      console.log(`[${SOURCE_SNAPSHOT_SECTION_QUEUE}] job ${job.id} complete`, {
        snapshotId: job.data.snapshotId,
        sectionId: result.id,
      });
      return result;
    },
    {
      connection: snapshotSectionConnection,
      concurrency: snapshotSectionConcurrency,
    },
  );

  const snapshotCoverImageWorker = new Worker<SnapshotCoverImageJobData>(
    SNAPSHOT_COVER_IMAGE_QUEUE,
    async (job) => {
      console.log(`[${SNAPSHOT_COVER_IMAGE_QUEUE}] job ${job.id} started`, job.data);

      const result = await generateAndStoreSnapshotCoverImage(prisma, job.data.snapshotId);

      console.log(`[${SNAPSHOT_COVER_IMAGE_QUEUE}] job ${job.id} complete`, {
        snapshotId: job.data.snapshotId,
        status: result.status,
        reason: result.status === "skipped" ? result.reason : undefined,
      });
      return result;
    },
    {
      connection: snapshotCoverImageConnection,
      concurrency: snapshotCoverImageConcurrency,
    },
  );

  const signalPreviewImageWorker = new Worker<SignalPreviewImageJobData>(
    SIGNAL_PREVIEW_IMAGE_QUEUE,
    async (job) => {
      console.log(`[${SIGNAL_PREVIEW_IMAGE_QUEUE}] job ${job.id} started`, job.data);

      const result = await generateAndStoreSignalPreviewImage(prisma, job.data.snapshotId, job.data.signalId);

      console.log(`[${SIGNAL_PREVIEW_IMAGE_QUEUE}] job ${job.id} complete`, {
        snapshotId: job.data.snapshotId,
        signalId: job.data.signalId,
        status: result.status,
        reason: result.status === "skipped" ? result.reason : undefined,
      });
      return result;
    },
    {
      connection: signalPreviewImageConnection,
      concurrency: signalPreviewImageConcurrency,
    },
  );

  console.log("Worker concurrency:", {
    [TELEGRAM_IMPORT_QUEUE]: 1,
    [COMMENT_IMPORT_QUEUE]: 1,
    [MESSAGE_EMBEDDING_QUEUE]: 1,
    [SOURCE_SNAPSHOT_QUEUE]: 1,
    [SOURCE_SNAPSHOT_SECTION_QUEUE]: snapshotSectionConcurrency,
    [SNAPSHOT_COVER_IMAGE_QUEUE]: snapshotCoverImageConcurrency,
    [SIGNAL_PREVIEW_IMAGE_QUEUE]: signalPreviewImageConcurrency,
  });

  for (const worker of [importWorker, commentImportWorker, embeddingWorker, snapshotWorker, snapshotSectionWorker, snapshotCoverImageWorker, signalPreviewImageWorker]) {
    worker.on("failed", (job, error) => {
      console.error(`[${worker.name}] job ${job?.id ?? "unknown"} failed:`, error);
    });

    worker.on("completed", (job) => {
      console.log(`[${worker.name}] job ${job.id} completed`);
    });
  }

  return {
    importWorker,
    commentImportWorker,
    embeddingWorker,
    snapshotWorker,
    snapshotSectionWorker,
    snapshotCoverImageWorker,
    signalPreviewImageWorker,
    contentEmbeddingQueue,
    commentImportQueue,
    telegramImportQueue,
    snapshotSectionQueue,
    snapshotCoverImageQueue,
    signalPreviewImageQueue,
  };
}

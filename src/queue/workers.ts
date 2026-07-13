import { Queue, Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { loadConfig } from "../config.js";
import { findStoredSource } from "../db/sources.js";
import { prisma } from "../db/prisma.js";
import { loadAiConfig } from "../ai/config.js";
import { loadEmbeddingsConfig } from "../embeddings/config.js";
import { importChannelComments } from "../import/importComments.js";
import { importMessageBatch, type ImportBatchPhase } from "../import/importMessages.js";
import { embedMessages } from "../rag/embedMessages.js";
import { formatContentBatch, formatContentItemsByExternalIds } from "../formatting/contentFormatter.js";
import { generateCommunitySnapshot, generateCommunitySnapshotSection } from "../snapshots/communitySnapshot.js";
import { generateAndStoreSnapshotCoverImage } from "../images/snapshotCoverImages.js";
import { generateAndStoreSignalPreviewImage } from "../images/signalPreviewImages.js";
import { curateSnapshotSignalsIntoSource } from "../signals/sourceSignalCurator.js";
import { patchSnapshotPipeline } from "../snapshots/pipeline.js";
import { connectTelegramClient } from "../telegram/client.js";
import { resolveDialogEntity } from "../telegram/dialogs.js";
import { createRedisConnectionOptions } from "./connection.js";
import { SOURCE_SNAPSHOT_QUEUE, SOURCE_SNAPSHOT_SECTION_QUEUE, COMMENT_IMPORT_QUEUE, MESSAGE_EMBEDDING_QUEUE, TELEGRAM_IMPORT_QUEUE, SIGNAL_PREVIEW_IMAGE_QUEUE, SNAPSHOT_COVER_IMAGE_QUEUE, CONTENT_FORMATTING_QUEUE, SOURCE_SIGNAL_CURATION_QUEUE } from "./names.js";
import type { SourceSnapshotJobData, SourceSnapshotSectionJobData, CommentImportJobData, ContentEmbeddingJobData, TelegramImportJobData, SignalPreviewImageJobData, SnapshotCoverImageJobData, ContentFormattingJobData, SourceSignalCurationJobData } from "./types.js";

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

async function initialRangeImportPhase(data: TelegramImportJobData, sinceDate: Date | undefined, untilDate: Date | undefined): Promise<ImportBatchPhase> {
  if (data.mode !== "sync" || !untilDate) {
    return initialImportPhase(data.mode);
  }

  const storedSource = await findStoredSource(prisma, data.chat);

  if (!storedSource) {
    return "backfill";
  }

  const bounds = await prisma.contentItem.aggregate({
    where: {
      sourceId: storedSource.id,
      kind: "post",
    },
    _min: {
      publishedAt: true,
    },
    _max: {
      publishedAt: true,
    },
  });
  const oldest = bounds._min.publishedAt;
  const newest = bounds._max.publishedAt;

  if (!oldest || !newest) {
    return "backfill";
  }

  if (sinceDate && sinceDate.getTime() > newest.getTime()) {
    return "new";
  }

  if (untilDate.getTime() < oldest.getTime()) {
    return "backfill";
  }

  return untilDate.getTime() >= newest.getTime() ? "new" : "backfill";
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

function shouldUseScannedLimit(data: TelegramImportJobData) {
  return Boolean(data.untilDateIso);
}

export function startWorkers() {
  const snapshotSectionConcurrency = envInt("SNAPSHOT_SECTION_WORKER_CONCURRENCY", 4);
  const snapshotCoverImageConcurrency = envInt("SNAPSHOT_COVER_IMAGE_WORKER_CONCURRENCY", 2);
  const signalPreviewImageConcurrency = envInt("SIGNAL_PREVIEW_IMAGE_WORKER_CONCURRENCY", 10);
  const sourceSignalCurationConcurrency = envInt("SOURCE_SIGNAL_CURATION_WORKER_CONCURRENCY", 1);
  const contentFormattingConcurrency = envInt("CONTENT_FORMATTING_WORKER_CONCURRENCY", 2);
  const importConnection = createRedisConnectionOptions();
  const commentImportConnection = createRedisConnectionOptions();
  const embeddingConnection = createRedisConnectionOptions();
  const formattingConnection = createRedisConnectionOptions();
  const snapshotConnection = createRedisConnectionOptions();
  const snapshotSectionConnection = createRedisConnectionOptions();
  const snapshotCoverImageConnection = createRedisConnectionOptions();
  const signalPreviewImageConnection = createRedisConnectionOptions();
  const sourceSignalCurationConnection = createRedisConnectionOptions();
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
  const contentFormattingQueue = new Queue<ContentFormattingJobData, unknown, string>(CONTENT_FORMATTING_QUEUE, {
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
  const sourceSignalCurationQueue = new Queue<SourceSignalCurationJobData, unknown, string>(SOURCE_SIGNAL_CURATION_QUEUE, {
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
        const sinceDate = parseSinceDate(job.data.sinceDateIso);
        const untilDate = parseSinceDate(job.data.untilDateIso);
        const phase = job.data.phase ?? await initialRangeImportPhase(job.data, sinceDate, untilDate);
        const remaining = job.data.remaining ?? job.data.limit;
        const importedTotal = job.data.importedTotal ?? 0;
        const batchLimit = Math.min(job.data.batchSize, remaining);
        const chainId = job.data.chainId ?? String(job.id ?? importContinuationJobId(job.data, phase, remaining, importedTotal));
        const result = await importMessageBatch(prisma, client, entity, {
          mode: job.data.mode,
          phase,
          limit: batchLimit,
          batchSize: job.data.batchSize,
          sleepMs: job.data.sleepMs,
          sinceDate,
          untilDate,
          backfillOffsetId: job.data.backfillOffsetId,
        });
        const progressCount = shouldUseScannedLimit(job.data) ? result.scanned : result.imported;
        const nextRemaining = Math.max(remaining - progressCount, 0);
        const nextImportedTotal = importedTotal + result.imported;
        const nextScannedTotal = (job.data.scannedTotal ?? 0) + result.scanned;
        const shouldContinue = shouldUseScannedLimit(job.data)
          ? nextRemaining > 0 && result.scanned > 0 && !result.reachedEnd
          : shouldContinueImport(job.data, phase, result.imported, result.reachedEnd);
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
            scannedTotal: nextScannedTotal,
            backfillOffsetId: nextPhase === "backfill"
              ? result.nextBackfillOffsetId ?? job.data.backfillOffsetId
              : job.data.backfillOffsetId,
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
              scannedTotal: nextScannedTotal,
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
          scannedTotal: nextScannedTotal,
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

  const contentFormattingWorker = new Worker<ContentFormattingJobData>(
    CONTENT_FORMATTING_QUEUE,
    async (job) => {
      console.log(`[${CONTENT_FORMATTING_QUEUE}] job ${job.id} started`, job.data);

      const chat = await findStoredSource(prisma, job.data.chat);

      if (!chat) {
        throw new Error(`Source not found in database: ${job.data.chat}`);
      }

      const result = job.data.itemIds?.length
        ? await formatContentItemsByExternalIds(prisma, loadAiConfig(), {
            sourceId: chat.id,
            externalIds: job.data.itemIds,
            skipExisting: job.data.skipExisting,
          })
        : await formatContentBatch(prisma, loadAiConfig(), {
            sourceId: chat.id,
            limit: job.data.limit,
            kind: job.data.kind,
            skipExisting: job.data.skipExisting,
          });

      if (job.data.snapshotId) {
        await patchSnapshotPipeline(prisma, job.data.snapshotId, {
          formatting: {
            status: "completed",
            completed: result.formatted,
            result,
            completedAt: new Date().toISOString(),
          },
        });
      }

      console.log(`[${CONTENT_FORMATTING_QUEUE}] job ${job.id} complete`, result);
      return result;
    },
    {
      connection: formattingConnection,
      concurrency: contentFormattingConcurrency,
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
      await patchSnapshotPipeline(prisma, job.data.snapshotId, {
        images: {
          coverStatus: result.status === "generated" ? "completed" : result.status,
          coverCompletedAt: new Date().toISOString(),
          coverReason: result.status === "skipped" ? result.reason : undefined,
        },
      });

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
      const previewsCompleted = await prisma.snapshotSignal.count({
        where: {
          snapshotId: job.data.snapshotId,
          previewImage: {
            not: Prisma.JsonNull,
          },
        },
      });
      await patchSnapshotPipeline(prisma, job.data.snapshotId, {
        images: {
          previewsCompleted,
          lastPreviewSignalId: job.data.signalId,
          lastPreviewStatus: result.status,
          lastPreviewCompletedAt: new Date().toISOString(),
        },
      });

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

  const sourceSignalCurationWorker = new Worker<SourceSignalCurationJobData>(
    SOURCE_SIGNAL_CURATION_QUEUE,
    async (job) => {
      console.log(`[${SOURCE_SIGNAL_CURATION_QUEUE}] job ${job.id} started`, job.data);

      const result = await curateSnapshotSignalsIntoSource(prisma, loadAiConfig(), job.data.snapshotId, {
        onProgress: (progress) => {
          void patchSnapshotPipeline(prisma, job.data.snapshotId, {
            curation: {
              status: "running",
              processed: progress.processed,
              total: progress.total,
              lastSignalId: progress.signalId,
              lastDecision: progress.decision,
              updatedAt: new Date().toISOString(),
            },
          }).catch((error) => {
            console.error(`[${SOURCE_SIGNAL_CURATION_QUEUE}] failed to update pipeline progress`, error);
          });
          console.log(`[${SOURCE_SIGNAL_CURATION_QUEUE}] job ${job.id} ${progress.processed}/${progress.total}`, {
            snapshotId: job.data.snapshotId,
            signalId: progress.signalId,
            decision: progress.decision,
          });
        },
      });
      const pending = await prisma.snapshotSignal.count({
        where: {
          snapshotId: job.data.snapshotId,
          status: "pending",
        },
      });
      await patchSnapshotPipeline(prisma, job.data.snapshotId, {
        status: pending === 0 ? "completed" : "running",
        curation: {
          status: pending === 0 ? "completed" : "running",
          processed: result.processed,
          created: result.created,
          merged: result.merged,
          rejected: result.rejected,
          evidence: result.evidence,
          pending,
          completedAt: new Date().toISOString(),
        },
      });

      console.log(`[${SOURCE_SIGNAL_CURATION_QUEUE}] job ${job.id} complete`, result);
      return result;
    },
    {
      connection: sourceSignalCurationConnection,
      concurrency: sourceSignalCurationConcurrency,
      lockDuration: envInt("SOURCE_SIGNAL_CURATION_LOCK_DURATION_MS", 10 * 60 * 1000),
      stalledInterval: envInt("SOURCE_SIGNAL_CURATION_STALLED_INTERVAL_MS", 2 * 60 * 1000),
      maxStalledCount: envInt("SOURCE_SIGNAL_CURATION_MAX_STALLED_COUNT", 2),
    },
  );

  console.log("Worker concurrency:", {
    [TELEGRAM_IMPORT_QUEUE]: 1,
    [COMMENT_IMPORT_QUEUE]: 1,
    [MESSAGE_EMBEDDING_QUEUE]: 1,
    [CONTENT_FORMATTING_QUEUE]: contentFormattingConcurrency,
    [SOURCE_SNAPSHOT_QUEUE]: 1,
    [SOURCE_SNAPSHOT_SECTION_QUEUE]: snapshotSectionConcurrency,
    [SOURCE_SIGNAL_CURATION_QUEUE]: sourceSignalCurationConcurrency,
    [SNAPSHOT_COVER_IMAGE_QUEUE]: snapshotCoverImageConcurrency,
    [SIGNAL_PREVIEW_IMAGE_QUEUE]: signalPreviewImageConcurrency,
  });

  for (const worker of [importWorker, commentImportWorker, embeddingWorker, contentFormattingWorker, snapshotWorker, snapshotSectionWorker, sourceSignalCurationWorker, snapshotCoverImageWorker, signalPreviewImageWorker]) {
    worker.on("error", (error) => {
      console.error(`[${worker.name}] worker error:`, error);
    });

    worker.on("failed", (job, error) => {
      console.error(`[${worker.name}] job ${job?.id ?? "unknown"} failed:`, error);
    });

    worker.on("completed", (job) => {
      console.log(`[${worker.name}] job ${job.id} completed`);
    });
  }

  for (const queue of [contentEmbeddingQueue, contentFormattingQueue, commentImportQueue, telegramImportQueue, snapshotSectionQueue, sourceSignalCurationQueue, snapshotCoverImageQueue, signalPreviewImageQueue]) {
    queue.on("error", (error) => {
      console.error(`[${queue.name}] queue error:`, error);
    });
  }

  return {
    importWorker,
    commentImportWorker,
    embeddingWorker,
    contentFormattingWorker,
    snapshotWorker,
    snapshotSectionWorker,
    sourceSignalCurationWorker,
    snapshotCoverImageWorker,
    signalPreviewImageWorker,
    contentEmbeddingQueue,
    contentFormattingQueue,
    commentImportQueue,
    telegramImportQueue,
    snapshotSectionQueue,
    sourceSignalCurationQueue,
    snapshotCoverImageQueue,
    signalPreviewImageQueue,
  };
}

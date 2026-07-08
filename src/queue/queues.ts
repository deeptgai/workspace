import { Queue } from "bullmq";
import { SOURCE_SNAPSHOT_QUEUE, SOURCE_SNAPSHOT_SECTION_QUEUE, COMMENT_IMPORT_QUEUE, MESSAGE_EMBEDDING_QUEUE, TELEGRAM_IMPORT_QUEUE, SIGNAL_PREVIEW_IMAGE_QUEUE, SNAPSHOT_COVER_IMAGE_QUEUE } from "./names.js";
import { createRedisConnectionOptions } from "./connection.js";
import type { SourceSnapshotJobData, SourceSnapshotSectionJobData, CommentImportJobData, ContentEmbeddingJobData, TelegramImportJobData, SignalPreviewImageJobData, SnapshotCoverImageJobData } from "./types.js";

export function createQueues() {
  const connection = createRedisConnectionOptions();

  return {
    telegramImportQueue: new Queue<TelegramImportJobData, unknown, string>(TELEGRAM_IMPORT_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
    contentEmbeddingQueue: new Queue<ContentEmbeddingJobData, unknown, string>(MESSAGE_EMBEDDING_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
    commentImportQueue: new Queue<CommentImportJobData, unknown, string>(COMMENT_IMPORT_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
    sourceSnapshotQueue: new Queue<SourceSnapshotJobData, unknown, string>(SOURCE_SNAPSHOT_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
    sourceSnapshotSectionQueue: new Queue<SourceSnapshotSectionJobData, unknown, string>(SOURCE_SNAPSHOT_SECTION_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 10000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
    snapshotCoverImageQueue: new Queue<SnapshotCoverImageJobData, unknown, string>(SNAPSHOT_COVER_IMAGE_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 10000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
    signalPreviewImageQueue: new Queue<SignalPreviewImageJobData, unknown, string>(SIGNAL_PREVIEW_IMAGE_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 10000,
        },
        removeOnComplete: 500,
        removeOnFail: 200,
      },
    }),
  };
}

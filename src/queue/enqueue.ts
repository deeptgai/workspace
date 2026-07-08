import { createQueues } from "./queues.js";
import { enqueueSourceSnapshotJob as enqueueSharedSourceSnapshotJob } from "./snapshotQueue.js";
import type { SourceSnapshotJobData, SourceSnapshotSectionJobData, CommentImportJobData, ContentEmbeddingJobData, TelegramImportJobData, SignalPreviewImageJobData } from "./types.js";

function slug(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9а-яё_-]+/giu, "-");
}

function uniqueJobId(prefix: string, chat: string): string {
  return `${slug(prefix)}--${slug(chat)}--${Date.now()}--${Math.random().toString(36).slice(2, 8)}`;
}

async function closeQueues(queues: ReturnType<typeof createQueues>) {
  await Promise.all([
    queues.telegramImportQueue.close(),
    queues.commentImportQueue.close(),
    queues.contentEmbeddingQueue.close(),
    queues.sourceSnapshotQueue.close(),
    queues.sourceSnapshotSectionQueue.close(),
    queues.signalPreviewImageQueue.close(),
  ]);
}

export async function enqueueTelegramImportJob(data: TelegramImportJobData) {
  const queues = createQueues();

  try {
    return await queues.telegramImportQueue.add("import", data, {
      jobId: uniqueJobId(`import-${data.mode}`, data.chat),
    });
  } finally {
    await closeQueues(queues);
  }
}

export async function enqueueCommentImportJob(data: CommentImportJobData) {
  const queues = createQueues();

  try {
    return await queues.commentImportQueue.add("comments", data, {
      jobId: uniqueJobId(`comments-${data.mode}`, data.chat),
    });
  } finally {
    await closeQueues(queues);
  }
}

export async function enqueueContentEmbeddingJob(data: ContentEmbeddingJobData) {
  const queues = createQueues();

  try {
    return await queues.contentEmbeddingQueue.add("embed", data, {
      jobId: uniqueJobId("embed", data.chat),
    });
  } finally {
    await closeQueues(queues);
  }
}

export async function enqueueSourceSnapshotJob(data: SourceSnapshotJobData) {
  return enqueueSharedSourceSnapshotJob(data);
}

export async function enqueueSourceSnapshotSectionJob(data: SourceSnapshotSectionJobData) {
  const queues = createQueues();

  try {
    return await queues.sourceSnapshotSectionQueue.add("section", data, {
      jobId: uniqueJobId(`snapshot-section-${data.sectionId}`, data.snapshotId),
    });
  } finally {
    await closeQueues(queues);
  }
}

export async function enqueueSignalPreviewImageJob(data: SignalPreviewImageJobData) {
  const queues = createQueues();

  try {
    return await queues.signalPreviewImageQueue.add("generate", data, {
      jobId: uniqueJobId("signal-preview-image", `${data.snapshotId}-${data.signalId}`),
    });
  } finally {
    await closeQueues(queues);
  }
}

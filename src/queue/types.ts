import type { ImportBatchPhase, ImportMode } from "../import/importMessages.js";

export type TelegramImportJobData = {
  chat: string;
  mode: ImportMode;
  limit: number;
  batchSize: number;
  sleepMs: number;
  sinceDateIso?: string;
  untilDateIso?: string;
  phase?: ImportBatchPhase;
  remaining?: number;
  importedTotal?: number;
  scannedTotal?: number;
  backfillOffsetId?: number;
  chainId?: string;
  importCommentsAfter?: {
    mode: "sync" | "new";
    postLimit: number;
    commentsPerPost: number;
  };
  snapshotAfterImport?: boolean;
};

export type ContentEmbeddingJobData = {
  chat: string;
  limit: number;
};

export type ContentFormattingJobData = {
  chat: string;
  limit: number;
  snapshotId?: string;
  kind?: "post" | "comment";
  itemIds?: string[];
  skipExisting?: boolean;
};

export type SourceUpdateSchedulerJobData = {
  reason: "daily" | "manual";
  limit: number;
  batchSize: number;
  sleepMs: number;
  sinceDays: number;
  comments: boolean;
  commentsPostLimit: number;
  commentsPerPost: number;
  autoSnapshot: boolean;
};

export type CommentImportJobData = {
  chat: string;
  mode: "sync" | "new";
  postLimit: number;
  commentsPerPost: number;
  snapshotAfterImport?: {
    postImportedTotal: number;
  };
};

export type SourceSnapshotJobData = {
  chat: string;
  snapshotId?: string;
};

export type SourceSnapshotSectionJobData = {
  chat: string;
  snapshotId: string;
  sectionId: string;
};

export type SnapshotCoverImageJobData = {
  snapshotId: string;
};

export type SignalPreviewImageJobData = {
  snapshotId: string;
  signalId: string;
};

export type SourceSignalCurationJobData = {
  snapshotId: string;
};

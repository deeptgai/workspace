import type { ImportBatchPhase, ImportMode } from "../import/importMessages.js";

export type TelegramImportJobData = {
  chat: string;
  mode: ImportMode;
  limit: number;
  batchSize: number;
  sleepMs: number;
  sinceDateIso?: string;
  phase?: ImportBatchPhase;
  remaining?: number;
  importedTotal?: number;
  chainId?: string;
  importCommentsAfter?: {
    mode: "sync" | "new";
    postLimit: number;
    commentsPerPost: number;
  };
};

export type ContentEmbeddingJobData = {
  chat: string;
  limit: number;
};

export type CommentImportJobData = {
  chat: string;
  mode: "sync" | "new";
  postLimit: number;
  commentsPerPost: number;
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

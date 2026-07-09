#!/usr/bin/env node

import { prisma } from "./db/prisma.js";
import { startWorkers } from "./queue/workers.js";

const workers = startWorkers();
let shuttingDown = false;

console.log("BullMQ workers started.");
console.log("Queues: telegram-import, comment-import, message-embedding, content-formatting, source-snapshot, source-snapshot-section, snapshot-cover-image, signal-preview-image");

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down workers...`);

  await Promise.all([
    workers.importWorker.close(),
    workers.commentImportWorker.close(),
    workers.embeddingWorker.close(),
    workers.contentFormattingWorker.close(),
    workers.snapshotWorker.close(),
    workers.snapshotSectionWorker.close(),
    workers.snapshotCoverImageWorker.close(),
    workers.signalPreviewImageWorker.close(),
    workers.telegramImportQueue.close(),
    workers.contentEmbeddingQueue.close(),
    workers.contentFormattingQueue.close(),
    workers.commentImportQueue.close(),
    workers.snapshotSectionQueue.close(),
    workers.snapshotCoverImageQueue.close(),
    workers.signalPreviewImageQueue.close(),
  ]);
  await prisma.$disconnect();

  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

#!/usr/bin/env node

import { Command } from "commander";
import { Prisma } from "@prisma/client";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { findStoredSource } from "./db/sources.js";
import { prisma } from "./db/prisma.js";
import { backfillEngagementFromRawJson } from "./engagement/rawJson.js";
import type { ImportMode } from "./import/importMessages.js";
import { isChannelSnapshotDocument } from "./snapshots/sourceSnapshotSchema.js";

const program = new Command();

function parsePositiveInteger(value: string, name: string): number {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsedValue;
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsedValue;
}

function getDefaultBatchSize(): string {
  return process.env.TELEGRAM_IMPORT_BATCH_SIZE || "100";
}

function getDefaultSleepMs(): string {
  return process.env.TELEGRAM_IMPORT_SLEEP_MS || "3000";
}

function getDefaultSinceDays(): string {
  return process.env.TELEGRAM_IMPORT_SINCE_DAYS || "365";
}

function sinceDateIsoFromDays(days: number): string | undefined {
  if (days <= 0) {
    return undefined;
  }

  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseOptionalNonNegativeNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }

  return parsedValue;
}

program
  .name("deeptg")
  .description("Community Intelligence Telegram CLI")
  .version("0.1.0");

program
  .command("login")
  .description("Authorize your Telegram account and print TELEGRAM_SESSION")
  .action(async () => {
    const { loginTelegram } = await import("./telegram/client.js");
    const config = loadConfig({ requireSession: false });
    const session = await loginTelegram(config);

    console.log("");
    console.log("Authorization successful.");
    console.log("Add this value to your .env file:");
    console.log("");
    console.log(`TELEGRAM_SESSION=${session}`);
  });

program
  .command("chats")
  .description("List available Telegram chats and channels")
  .option("-l, --limit <number>", "Number of dialogs to fetch", "50")
  .action(async (options: { limit: string }) => {
    const limit = parsePositiveInteger(options.limit, "--limit");
    const { connectTelegramClient } = await import("./telegram/client.js");
    const { listDialogs } = await import("./telegram/dialogs.js");

    const client = await connectTelegramClient(loadConfig());

    try {
      const dialogs = await listDialogs(client, limit);

      console.table(
        dialogs.map((dialog) => ({
          id: dialog.id,
          type: dialog.type,
          username: dialog.username ? `@${dialog.username}` : "",
          title: dialog.title,
        })),
      );
    } finally {
      await client.disconnect();
    }
  });

program
  .command("messages")
  .description("Print latest messages from a Telegram chat or channel")
  .argument("<chat>", "Source id, exact title, username, or @username")
  .option("-l, --limit <number>", "Number of messages to fetch", "10")
  .action(async (chat: string, options: { limit: string }) => {
    const limit = parsePositiveInteger(options.limit, "--limit");
    const { connectTelegramClient } = await import("./telegram/client.js");
    const { resolveDialogEntity } = await import("./telegram/dialogs.js");
    const { listLastMessages } = await import("./telegram/messages.js");

    const client = await connectTelegramClient(loadConfig());

    try {
      const entity = await resolveDialogEntity(client, chat);
      const messages = await listLastMessages(client, entity, limit);

      for (const message of messages) {
        console.log(`[${message.publishedAt}] #${message.id} sender=${message.senderId ?? "unknown"}`);
        console.log(message.text || "<no text>");
        console.log("");
      }
    } finally {
      await client.disconnect();
    }
  });

program
  .command("import")
  .description("Enqueue Telegram message import into Postgres with resumable checkpoints")
  .argument("<chat>", "Source id, exact title, username, or @username")
  .option("-m, --mode <mode>", "Import mode: sync, backfill, or new", "sync")
  .option("-l, --limit <number>", "Maximum number of messages to import", "100")
  .option("-b, --batch-size <number>", "Messages per Telegram request", getDefaultBatchSize())
  .option("-s, --sleep-ms <number>", "Pause between batches in milliseconds", getDefaultSleepMs())
  .option("--since-days <number>", "Only import messages from the last N days. Use 0 to disable.", getDefaultSinceDays())
  .action(async (
    chat: string,
    options: {
      mode: string;
      limit: string;
      batchSize: string;
      sleepMs: string;
      sinceDays: string;
    },
  ) => {
    const mode = options.mode as ImportMode;

    if (!["sync", "backfill", "new"].includes(mode)) {
      throw new Error("--mode must be one of: sync, backfill, new.");
    }

    const { enqueueTelegramImportJob } = await import("./queue/enqueue.js");
    const job = await enqueueTelegramImportJob({
      chat,
      mode,
      limit: parsePositiveInteger(options.limit, "--limit"),
      batchSize: parsePositiveInteger(options.batchSize, "--batch-size"),
      sleepMs: parseNonNegativeInteger(options.sleepMs, "--sleep-ms"),
      sinceDateIso: sinceDateIsoFromDays(parseNonNegativeInteger(options.sinceDays, "--since-days")),
    });

    console.log("");
    console.log("Import job enqueued.");
    console.table([{
      queue: "telegram-import",
      jobId: job.id,
      chat,
      mode,
    }]);
  });

program
  .command("engagement:backfill")
  .description("Extract engagement columns from already stored rawJson messages")
  .action(async () => {
    try {
      const updated = await backfillEngagementFromRawJson(prisma);
      console.log(`Backfilled engagement for ${updated} messages.`);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("comments:import")
  .description("Enqueue import of comments from channel posts")
  .argument("<chat>", "Stored chat id, exact title, username, or @username")
  .option("-m, --mode <mode>", "Import mode: sync or new", "new")
  .option("--post-limit <number>", "Number of recent channel posts with comments to scan", "50")
  .option("--comments-per-post <number>", "Maximum comments to import per post", "100")
  .action(async (
    chat: string,
    options: {
      mode: string;
      postLimit: string;
      commentsPerPost: string;
    },
  ) => {
    if (!["sync", "new"].includes(options.mode)) {
      throw new Error("--mode must be one of: sync, new.");
    }

    const { enqueueCommentImportJob } = await import("./queue/enqueue.js");
    const job = await enqueueCommentImportJob({
      chat,
      mode: options.mode as "sync" | "new",
      postLimit: parsePositiveInteger(options.postLimit, "--post-limit"),
      commentsPerPost: parsePositiveInteger(options.commentsPerPost, "--comments-per-post"),
    });

    console.log("");
    console.log("Comment import job enqueued.");
    console.table([{
      queue: "comment-import",
      jobId: job.id,
      chat,
      mode: options.mode,
    }]);
  });

program
  .command("stats")
  .description("Show stored Telegram chat or channel statistics")
  .argument("<chat>", "Source id, exact title, username, or @username")
  .option("-t, --top <number>", "Number of top messages to show", "10")
  .action(async (chat: string, options: { top: string }) => {
    const top = parsePositiveInteger(options.top, "--top");

    try {
      const storedChat = await findStoredSource(prisma, chat);

      if (!storedChat) {
        throw new Error(`Source not found in database: ${chat}`);
      }

      const [aggregate, topMessages] = await Promise.all([
        prisma.contentItem.aggregate({
          where: {
            sourceId: storedChat.id,
          },
          _count: {
            _all: true,
          },
          _sum: {
            views: true,
            forwards: true,
            reactionsTotal: true,
            repliesCount: true,
          },
          _avg: {
            views: true,
            forwards: true,
            reactionsTotal: true,
            repliesCount: true,
            engagementScore: true,
          },
          _max: {
            engagementScore: true,
          },
        }),
        prisma.contentItem.findMany({
          where: {
            sourceId: storedChat.id,
          },
          orderBy: {
            engagementScore: "desc",
          },
          take: top,
          select: {
            externalId: true,
            publishedAt: true,
            text: true,
            views: true,
            forwards: true,
            reactionsTotal: true,
            repliesCount: true,
            engagementScore: true,
          },
        }),
      ]);

      console.log("");
      console.table([{
        chat: storedChat.title,
        type: storedChat.type,
        messages: aggregate._count._all,
        views: aggregate._sum.views ?? 0,
        avgViews: Math.round(aggregate._avg.views ?? 0),
        forwards: aggregate._sum.forwards ?? 0,
        reactions: aggregate._sum.reactionsTotal ?? 0,
        replies: aggregate._sum.repliesCount ?? 0,
        avgEngagement: Number((aggregate._avg.engagementScore ?? 0).toFixed(2)),
        maxEngagement: Number((aggregate._max.engagementScore ?? 0).toFixed(2)),
      }]);

      console.log("");
      console.log("Top messages by engagement:");
      console.table(topMessages.map((message) => ({
        id: message.externalId,
        publishedAt: message.publishedAt.toISOString().slice(0, 10),
        views: message.views ?? 0,
        forwards: message.forwards ?? 0,
        reactions: message.reactionsTotal,
        replies: message.repliesCount,
        score: Number(message.engagementScore.toFixed(2)),
        text: (message.text ?? "<no text>").replace(/\s+/g, " ").slice(0, 90),
      })));
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("embed")
  .description("Enqueue embedding creation for stored messages in a chat or channel")
  .argument("<chat>", "Stored chat id, exact title, username, or @username")
  .option("-l, --limit <number>", "Maximum number of messages to embed", "100")
  .action(async (chat: string, options: { limit: string }) => {
    const limit = parsePositiveInteger(options.limit, "--limit");

    const { enqueueContentEmbeddingJob } = await import("./queue/enqueue.js");
    const job = await enqueueContentEmbeddingJob({
      chat,
      limit,
    });

    console.log("");
    console.log("Embedding job enqueued.");
    console.table([{
      queue: "message-embedding",
      jobId: job.id,
      chat,
      limit,
    }]);
  });

program
  .command("queue:status")
  .description("Show BullMQ queue status")
  .action(async () => {
    const { createQueues } = await import("./queue/queues.js");
    const queues = createQueues();

    try {
      const [importCounts, commentImportCounts, embeddingCounts, snapshotCounts, snapshotSectionCounts] = await Promise.all([
        queues.telegramImportQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.commentImportQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.contentEmbeddingQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.sourceSnapshotQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.sourceSnapshotSectionQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      ]);

      console.table([
        {
          queue: "telegram-import",
          ...importCounts,
        },
        {
          queue: "message-embedding",
          ...embeddingCounts,
        },
        {
          queue: "comment-import",
          ...commentImportCounts,
        },
        {
          queue: "source-snapshot",
          ...snapshotCounts,
        },
        {
          queue: "source-snapshot-section",
          ...snapshotSectionCounts,
        },
      ]);

      const activeJobs = [
        ...await queues.telegramImportQueue.getActive(),
        ...await queues.commentImportQueue.getActive(),
        ...await queues.contentEmbeddingQueue.getActive(),
        ...await queues.sourceSnapshotQueue.getActive(),
        ...await queues.sourceSnapshotSectionQueue.getActive(),
      ];

      if (activeJobs.length > 0) {
        console.log("");
        console.log("Active jobs:");
        console.table(activeJobs.map((job) => ({
          id: job.id,
          name: job.name,
          progress: job.progress,
          data: JSON.stringify(job.data),
        })));
      }
    } finally {
      await queues.telegramImportQueue.close();
      await queues.commentImportQueue.close();
      await queues.contentEmbeddingQueue.close();
      await queues.sourceSnapshotQueue.close();
      await queues.sourceSnapshotSectionQueue.close();
    }
  });

program
  .command("search")
  .description("Semantic RAG search over embedded messages")
  .argument("<chat>", "Stored chat id, exact title, username, or @username")
  .argument("<query>", "Natural language search query")
  .option("-l, --limit <number>", "Number of results", "10")
  .option("--min-engagement <number>", "Minimum engagement score")
  .action(async (
    chat: string,
    query: string,
    options: {
      limit: string;
      minEngagement?: string;
    },
  ) => {
    const limit = parsePositiveInteger(options.limit, "--limit");
    const minEngagementScore = parseOptionalNonNegativeNumber(options.minEngagement, "--min-engagement");

    try {
      const storedChat = await findStoredSource(prisma, chat);

      if (!storedChat) {
        throw new Error(`Source not found in database: ${chat}`);
      }

      const { loadEmbeddingsConfig } = await import("./embeddings/config.js");
      const { searchMessages } = await import("./rag/searchMessages.js");
      const results = await searchMessages(prisma, loadEmbeddingsConfig(), {
        sourceId: storedChat.id,
        query,
        limit,
        minEngagementScore,
      });

      console.log("");
      console.log(`Semantic results for: ${query}`);
      console.table(results.map((message) => ({
        id: message.externalId,
        publishedAt: message.publishedAt.toISOString().slice(0, 10),
        similarity: Number(message.similarity.toFixed(4)),
        engagement: Number(message.engagementScore.toFixed(2)),
        views: message.views ?? 0,
        reactions: message.reactionsTotal,
        replies: message.repliesCount,
        text: (message.text ?? "<no text>").replace(/\s+/g, " ").slice(0, 120),
      })));
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("snapshot")
  .description("Enqueue a source snapshot job")
  .argument("<chat>", "Stored chat id, exact title, username, or @username")
  .action(async (chat: string) => {
    try {
      const storedChat = await findStoredSource(prisma, chat);

      if (!storedChat) {
        throw new Error(`Source not found in database: ${chat}`);
      }

      const snapshot = await prisma.sourceSnapshot.create({
        data: {
          sourceId: storedChat.id,
          kind: "channel_structured_snapshot",
          title: `Снимок по каналу: ${storedChat.title}`,
          status: "pending",
          model: process.env.AI_MODEL || "unknown",
        },
      });
      const { enqueueSourceSnapshotJob } = await import("./queue/enqueue.js");
      const job = await enqueueSourceSnapshotJob({
        chat,
        snapshotId: snapshot.id,
      });

      console.log("");
      console.log("Snapshot job enqueued.");
      console.table([{
        queue: "source-snapshot",
        jobId: job.id,
        snapshotId: snapshot.id,
        chat,
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("snapshot:section")
  .description("Re-enqueue one section agent for an existing snapshot")
  .argument("<snapshotId>", "Stored snapshot id")
  .argument("<sectionId>", "Section id: ideas, pains, hypotheses, insights, materials, people, tools, places")
  .action(async (snapshotId: string, sectionId: string) => {
    try {
      const { SIGNAL_AGENTS } = await import("./snapshots/communitySnapshot.js");
      const definition = SIGNAL_AGENTS.find((section) => section.id === sectionId);

      if (!definition) {
        throw new Error(`Unknown snapshot section: ${sectionId}`);
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
        prisma.sourceSnapshotSection.upsert({
          where: {
            snapshotId_sectionId: {
              snapshotId,
              sectionId,
            },
          },
          create: {
            snapshotId,
            sectionId,
            title: definition.title,
            agent: definition.agent,
            status: "pending",
          },
          update: {
            title: definition.title,
            agent: definition.agent,
            status: "pending",
            error: null,
            startedAt: null,
            completedAt: null,
          },
        }),
      ]);

      const { enqueueSourceSnapshotSectionJob } = await import("./queue/enqueue.js");
      const chat = snapshot.source.username ? `@${snapshot.source.username}` : snapshot.source.title;
      const job = await enqueueSourceSnapshotSectionJob({
        chat,
        snapshotId,
        sectionId,
      });

      console.log("");
      console.log("Snapshot section job enqueued.");
      console.table([{
        queue: "source-snapshot-section",
        jobId: job.id,
        snapshotId,
        sectionId,
        chat,
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("signal:image")
  .description("Generate a fal.ai preview image for one signal id and save it into the snapshot document")
  .argument("<signalId>", "Signal id from snapshot.document.signals[].id")
  .option("-s, --snapshot <snapshotId>", "Restrict lookup to one snapshot id")
  .action(async (
    signalId: string,
    options: {
      snapshot?: string;
    },
  ) => {
    try {
      const snapshots = await prisma.sourceSnapshot.findMany({
        where: {
          id: options.snapshot,
          status: "completed",
          document: {
            not: Prisma.JsonNull,
          },
        },
        include: {
          source: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: options.snapshot ? 1 : 50,
      });

      const snapshot = snapshots.find((candidate) => {
        if (!isChannelSnapshotDocument(candidate.document)) {
          return false;
        }

        return candidate.document.signals.some((signal) => signal.id === signalId);
      });

      if (!snapshot || !isChannelSnapshotDocument(snapshot.document)) {
        const scope = options.snapshot ? ` in snapshot ${options.snapshot}` : " in the latest completed snapshots";
        throw new Error(`Signal not found${scope}: ${signalId}`);
      }

      const signal = snapshot.document.signals.find((item) => item.id === signalId);

      if (!signal) {
        throw new Error(`Signal not found in snapshot ${snapshot.id}: ${signalId}`);
      }

      const { generateSignalPreviewImage } = await import("./images/falSignalPreview.js");
      const { putObject, stableObjectKey } = await import("./storage/objectStorage.js");
      const previewImage = await generateSignalPreviewImage(signal, {
        chatTitle: snapshot.source.title,
      });
      const falImageResponse = await fetch(previewImage.url);

      if (!falImageResponse.ok) {
        throw new Error(`Cannot download fal image ${previewImage.url}: ${falImageResponse.status} ${await falImageResponse.text()}`);
      }

      const contentType = falImageResponse.headers.get("content-type") || previewImage.contentType || "image/jpeg";
      const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const imageBytes = new Uint8Array(await falImageResponse.arrayBuffer());
      const objectKey = stableObjectKey([snapshot.id, signal.id, previewImage.requestId ?? Date.now().toString()], extension);
      const storedObject = await putObject(objectKey, imageBytes, contentType);
      const storedPreviewImage = {
        ...previewImage,
        url: storedObject.url,
        sourceUrl: previewImage.url,
        storageProvider: "s3" as const,
        bucket: storedObject.bucket,
        objectKey: storedObject.key,
        sizeBytes: storedObject.sizeBytes,
        contentType: storedObject.contentType,
      };
      const updatedDocument = {
        ...snapshot.document,
        signals: snapshot.document.signals.map((item) => item.id === signalId
          ? {
              ...item,
              previewImage: storedPreviewImage,
            }
          : item),
      };

      await prisma.sourceSnapshot.update({
        where: {
          id: snapshot.id,
        },
        data: {
          document: updatedDocument as Prisma.InputJsonValue,
        },
      });

      console.log("");
      console.log("Signal preview image generated.");
      console.table([{
        snapshotId: snapshot.id,
        signalId,
        kind: signal.kind,
        title: signal.title,
        model: storedPreviewImage.model,
        bucket: storedPreviewImage.bucket,
        objectKey: storedPreviewImage.objectKey,
        url: storedPreviewImage.url,
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("storage:bootstrap")
  .description("Create required object storage buckets")
  .action(async () => {
    const { createBucketIfMissing, objectStorageConfig } = await import("./storage/objectStorage.js");
    const config = objectStorageConfig();
    const bucket = await createBucketIfMissing(config);

    console.log("");
    console.log("Object storage bootstrapped.");
    console.table([{
      endpoint: config.endpoint,
      bucket,
      publicBasePath: config.publicBasePath,
    }]);
  });

program
  .command("snapshots")
  .description("Show stored source snapshots")
  .argument("<chat>", "Stored chat id, exact title, username, or @username")
  .option("-l, --limit <number>", "Number of snapshots to list", "1")
  .option("--json", "Print the latest snapshot structured JSON document")
  .action(async (
    chat: string,
    options: {
      limit: string;
      json?: boolean;
    },
  ) => {
    const limit = parsePositiveInteger(options.limit, "--limit");

    try {
      const storedChat = await findStoredSource(prisma, chat);

      if (!storedChat) {
        throw new Error(`Source not found in database: ${chat}`);
      }

      const snapshots = await prisma.sourceSnapshot.findMany({
        where: {
          sourceId: storedChat.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
      });

      if (snapshots.length === 0) {
        console.log(`No snapshots found for ${storedChat.title}.`);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(snapshots[0].document, null, 2));
        return;
      }

      console.table(snapshots.map((snapshot) => ({
        id: snapshot.id,
        kind: snapshot.kind,
        model: snapshot.model,
        createdAt: snapshot.createdAt.toISOString(),
        title: snapshot.title,
      })));
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("export")
  .description("Export all stored source context to Markdown")
  .argument("<chat>", "Stored source id, exact title, username, or @username")
  .option("-o, --out <path>", "Output file path or directory. Defaults to generated source slug filename.")
  .option("--stdout", "Print Markdown to stdout instead of writing a file")
  .action(async (
    chat: string,
    options: {
      out?: string;
      stdout?: boolean;
    },
  ) => {
    try {
      const storedChat = await findStoredSource(prisma, chat);

      if (!storedChat) {
        throw new Error(`Source not found in database: ${chat}`);
      }

      const { exportSourceMarkdown } = await import("./export/sourceMarkdown.js");
      const exported = await exportSourceMarkdown(prisma, {
        sourceId: storedChat.id,
      });

      if (options.stdout) {
        process.stdout.write(exported.markdown);
        return;
      }

      let outputPath = options.out || exported.fileName;

      if (options.out) {
        const outputStat = await stat(options.out).catch(() => null);

        if (outputStat?.isDirectory()) {
          outputPath = join(options.out, exported.fileName);
        }
      }

      const { writeFile } = await import("node:fs/promises");
      await writeFile(outputPath, exported.markdown, "utf8");
      console.log(`Exported ${storedChat.title} to ${outputPath}`);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

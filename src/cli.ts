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
import { initialSnapshotPipeline } from "./snapshots/pipeline.js";

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

function sourceChatRef(source: { username: string | null; externalId: string }) {
  return source.username ? `@${source.username}` : source.externalId;
}

function parseDateOption(value: string, name: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} must be a valid date or ISO datetime.`);
  }

  return date;
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

async function findTelegramUserByRef(user: string) {
  const normalizedUser = user.trim().replace(/^@/, "");
  const telegramId = /^\d+$/.test(normalizedUser) ? BigInt(normalizedUser) : null;

  return prisma.telegramUser.findFirst({
    where: telegramId
      ? { telegramId }
      : {
          username: {
            equals: normalizedUser,
            mode: "insensitive",
          },
        },
  });
}

async function listTelegramPurchases(where: Prisma.TelegramPurchaseWhereInput) {
  const purchases = await prisma.telegramPurchase.findMany({
    where,
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      product: true,
      sourceId: true,
      status: true,
      amount: true,
      paidAt: true,
      updatedAt: true,
    },
  });
  const sources = purchases.length
    ? await prisma.source.findMany({
        where: {
          id: {
            in: [...new Set(purchases.map((purchase) => purchase.sourceId))],
          },
        },
        select: {
          id: true,
          title: true,
          username: true,
        },
      })
    : [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return purchases.map((purchase) => {
    const source = sourceById.get(purchase.sourceId);

    return {
      ...purchase,
      sourceTitle: source?.title ?? "",
      sourceUsername: source?.username ? `@${source.username}` : "",
    };
  });
}

async function listPayments(where: Prisma.PaymentWhereInput) {
  const payments = await prisma.payment.findMany({
    where,
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      provider: true,
      providerPaymentId: true,
      product: true,
      sourceId: true,
      status: true,
      currency: true,
      amount: true,
      paidAt: true,
    },
  });
  const sources = payments.length
    ? await prisma.source.findMany({
        where: {
          id: {
            in: [...new Set(payments.flatMap((payment) => payment.sourceId ? [payment.sourceId] : []))],
          },
        },
        select: {
          id: true,
          title: true,
          username: true,
        },
      })
    : [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return payments.map((payment) => {
    const source = payment.sourceId ? sourceById.get(payment.sourceId) : null;

    return {
      ...payment,
      sourceTitle: source?.title ?? "",
      sourceUsername: source?.username ? `@${source.username}` : "",
    };
  });
}

async function listSourceAccessGrants(where: Prisma.SourceAccessGrantWhereInput) {
  const grants = await prisma.sourceAccessGrant.findMany({
    where,
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      provider: true,
      product: true,
      sourceId: true,
      scope: true,
      status: true,
      grantedAt: true,
      expiresAt: true,
    },
  });
  const sources = grants.length
    ? await prisma.source.findMany({
        where: {
          id: {
            in: [...new Set(grants.map((grant) => grant.sourceId))],
          },
        },
        select: {
          id: true,
          title: true,
          username: true,
        },
      })
    : [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return grants.map((grant) => {
    const source = sourceById.get(grant.sourceId);

    return {
      ...grant,
      sourceTitle: source?.title ?? "",
      sourceUsername: source?.username ? `@${source.username}` : "",
    };
  });
}

function printTelegramPurchases(purchases: Awaited<ReturnType<typeof listTelegramPurchases>>) {
  console.table(purchases.map((purchase) => ({
    id: purchase.id,
    product: purchase.product,
    sourceId: purchase.sourceId,
    source: purchase.sourceUsername || purchase.sourceTitle,
    status: purchase.status,
    amount: purchase.amount,
    paidAt: purchase.paidAt?.toISOString() ?? "",
  })));
}

function printPayments(payments: Awaited<ReturnType<typeof listPayments>>) {
  console.table(payments.map((payment) => ({
    id: payment.id,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId ?? "",
    product: payment.product,
    source: payment.sourceUsername || payment.sourceTitle,
    status: payment.status,
    amount: `${payment.amount} ${payment.currency}`,
    paidAt: payment.paidAt?.toISOString() ?? "",
  })));
}

function printSourceAccessGrants(grants: Awaited<ReturnType<typeof listSourceAccessGrants>>) {
  console.table(grants.map((grant) => ({
    id: grant.id,
    provider: grant.provider ?? "",
    product: grant.product ?? "",
    sourceId: grant.sourceId,
    source: grant.sourceUsername || grant.sourceTitle,
    scope: grant.scope,
    status: grant.status,
    grantedAt: grant.grantedAt.toISOString(),
    expiresAt: grant.expiresAt?.toISOString() ?? "",
  })));
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
  .command("source:update")
  .description("Enqueue update import for an existing source: new posts first, then new comments")
  .argument("<source>", "Stored source id, exact title, username, or @username")
  .option("-l, --limit <number>", "Maximum number of new posts to import", "200")
  .option("-b, --batch-size <number>", "Messages per Telegram request", getDefaultBatchSize())
  .option("-s, --sleep-ms <number>", "Pause between batches in milliseconds", getDefaultSleepMs())
  .option("--since-days <number>", "Only scan messages from the last N days. Use 0 to disable.", getDefaultSinceDays())
  .option("--no-comments", "Skip importing new comments after new posts")
  .option("--comments-post-limit <number>", "Maximum posts to scan for new comments", "80")
  .option("--comments-per-post <number>", "Maximum comments per post", "100")
  .action(async (
    source: string,
    options: {
      limit: string;
      batchSize: string;
      sleepMs: string;
      sinceDays: string;
      comments: boolean;
      commentsPostLimit: string;
      commentsPerPost: string;
    },
  ) => {
    try {
      const storedSource = await findStoredSource(prisma, source);

      if (!storedSource) {
        throw new Error(`Source not found in database: ${source}`);
      }

      const chat = sourceChatRef(storedSource);
      const { enqueueTelegramImportJob } = await import("./queue/enqueue.js");
      const job = await enqueueTelegramImportJob({
        chat,
        mode: "new",
        limit: parsePositiveInteger(options.limit, "--limit"),
        batchSize: parsePositiveInteger(options.batchSize, "--batch-size"),
        sleepMs: parseNonNegativeInteger(options.sleepMs, "--sleep-ms"),
        sinceDateIso: sinceDateIsoFromDays(parseNonNegativeInteger(options.sinceDays, "--since-days")),
        importCommentsAfter: options.comments
          ? {
              mode: "new",
              postLimit: parsePositiveInteger(options.commentsPostLimit, "--comments-post-limit"),
              commentsPerPost: parsePositiveInteger(options.commentsPerPost, "--comments-per-post"),
            }
          : undefined,
      });

      console.log("");
      console.log("Source update job enqueued.");
      console.table([{
        queue: "telegram-import",
        jobId: job.id,
        sourceId: storedSource.id,
        chat,
        mode: "new",
        comments: options.comments ? "new" : "disabled",
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("import:range")
  .description("Import Telegram posts from a source within an exact date range")
  .argument("<chat>", "Source id, exact title, username, or @username")
  .requiredOption("--from <date>", "Inclusive start date, e.g. 2025-01-01")
  .requiredOption("--to <date>", "Inclusive end date, e.g. 2025-12-31T23:59:59Z")
  .option("-l, --limit <number>", "Maximum number of Telegram messages to scan", "2000")
  .option("-b, --batch-size <number>", "Messages per Telegram request", getDefaultBatchSize())
  .option("-s, --sleep-ms <number>", "Pause between batches in milliseconds", getDefaultSleepMs())
  .action(async (
    chat: string,
    options: {
      from: string;
      to: string;
      limit: string;
      batchSize: string;
      sleepMs: string;
    },
  ) => {
    const from = parseDateOption(options.from, "--from");
    const to = parseDateOption(options.to, "--to");

    if (from.getTime() > to.getTime()) {
      throw new Error("--from must be before --to.");
    }

    const { enqueueTelegramImportJob } = await import("./queue/enqueue.js");
    const job = await enqueueTelegramImportJob({
      chat,
      mode: "sync",
      limit: parsePositiveInteger(options.limit, "--limit"),
      batchSize: parsePositiveInteger(options.batchSize, "--batch-size"),
      sleepMs: parseNonNegativeInteger(options.sleepMs, "--sleep-ms"),
      sinceDateIso: from.toISOString(),
      untilDateIso: to.toISOString(),
    });

    console.log("");
    console.log("Range import job enqueued.");
    console.table([{
      queue: "telegram-import",
      jobId: job.id,
      chat,
      from: from.toISOString(),
      to: to.toISOString(),
      embeddings: "auto",
    }]);
  });

program
  .command("source:purge")
  .description("Delete local stored content, embeddings, snapshots, and signals for one source")
  .argument("<chat>", "Stored source id, exact title, username, or @username")
  .option("--all", "Delete content, embeddings, snapshots, signals, formats, and import state")
  .action(async (chat: string, options: { all?: boolean }) => {
    if (!options.all) {
      throw new Error("Pass --all to confirm destructive source purge.");
    }

    try {
      const storedChat = await findStoredSource(prisma, chat);

      if (!storedChat) {
        throw new Error(`Source not found in database: ${chat}`);
      }

      const result = await prisma.$transaction(async (tx) => {
        const sourceSignalEvidence = await tx.sourceSignalEvidence.deleteMany({
          where: {
            sourceSignal: {
              sourceId: storedChat.id,
            },
          },
        });
        const sourceSignals = await tx.sourceSignal.deleteMany({
          where: {
            sourceId: storedChat.id,
          },
        });
        const snapshotSignalEvidence = await tx.snapshotSignalEvidence.deleteMany({
          where: {
            snapshotSignal: {
              sourceId: storedChat.id,
            },
          },
        });
        const snapshotSignals = await tx.snapshotSignal.deleteMany({
          where: {
            sourceId: storedChat.id,
          },
        });
        const sections = await tx.sourceSnapshotSection.deleteMany({
          where: {
            snapshot: {
              sourceId: storedChat.id,
            },
          },
        });
        const snapshots = await tx.sourceSnapshot.deleteMany({
          where: {
            sourceId: storedChat.id,
          },
        });
        const importStates = await tx.sourceImportState.deleteMany({
          where: {
            sourceId: storedChat.id,
          },
        });
        const analysisStates = await tx.sourceAnalysisState.deleteMany({
          where: {
            sourceId: storedChat.id,
          },
        });
        const content = await tx.contentItem.deleteMany({
          where: {
            sourceId: storedChat.id,
          },
        });

        return {
          sourceSignalEvidence: sourceSignalEvidence.count,
          sourceSignals: sourceSignals.count,
          snapshotSignalEvidence: snapshotSignalEvidence.count,
          snapshotSignals: snapshotSignals.count,
          sections: sections.count,
          snapshots: snapshots.count,
          importStates: importStates.count,
          analysisStates: analysisStates.count,
          content: content.count,
        };
      });

      console.log("");
      console.log("Source purged.");
      console.table([{
        sourceId: storedChat.id,
        title: storedChat.title,
        ...result,
      }]);
    } finally {
      await prisma.$disconnect();
    }
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
  .command("source:state")
  .description("Show integration-test state for a stored source")
  .argument("<chat>", "Stored source id, exact title, username, or @username")
  .action(async (chat: string) => {
    try {
      const storedChat = await findStoredSource(prisma, chat);

      if (!storedChat) {
        throw new Error(`Source not found in database: ${chat}`);
      }

      const [
        posts,
        comments,
        embeddings,
        formats,
        snapshots,
        sections,
        snapshotSignals,
        snapshotEvidence,
        sourceSignals,
        sourceEvidence,
        pendingSnapshotSignals,
      ] = await Promise.all([
        prisma.contentItem.count({ where: { sourceId: storedChat.id, kind: "post" } }),
        prisma.contentItem.count({ where: { sourceId: storedChat.id, kind: "comment" } }),
        prisma.contentEmbedding.count({ where: { item: { sourceId: storedChat.id } } }),
        prisma.contentItemFormat.count({ where: { item: { sourceId: storedChat.id } } }),
        prisma.sourceSnapshot.count({ where: { sourceId: storedChat.id } }),
        prisma.sourceSnapshotSection.count({ where: { snapshot: { sourceId: storedChat.id } } }),
        prisma.snapshotSignal.count({ where: { sourceId: storedChat.id } }),
        prisma.snapshotSignalEvidence.count({ where: { snapshotSignal: { sourceId: storedChat.id } } }),
        prisma.sourceSignal.count({ where: { sourceId: storedChat.id } }),
        prisma.sourceSignalEvidence.count({ where: { sourceSignal: { sourceId: storedChat.id } } }),
        prisma.snapshotSignal.count({ where: { sourceId: storedChat.id, status: "pending" } }),
      ]);
      const latestSnapshot = await prisma.sourceSnapshot.findFirst({
        where: {
          sourceId: storedChat.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          status: true,
          periodFrom: true,
          periodTo: true,
          createdAt: true,
          completedAt: true,
          pipeline: true,
        },
      });
      const latestPipeline = latestSnapshot?.pipeline &&
        typeof latestSnapshot.pipeline === "object" &&
        !Array.isArray(latestSnapshot.pipeline)
        ? latestSnapshot.pipeline as Record<string, unknown>
        : {};
      const latestPipelineCuration = latestPipeline.curation &&
        typeof latestPipeline.curation === "object" &&
        !Array.isArray(latestPipeline.curation)
        ? latestPipeline.curation as Record<string, unknown>
        : {};
      const latestPipelineImages = latestPipeline.images &&
        typeof latestPipeline.images === "object" &&
        !Array.isArray(latestPipeline.images)
        ? latestPipeline.images as Record<string, unknown>
        : {};
      const analysisState = await prisma.sourceAnalysisState.findUnique({
        where: {
          sourceId: storedChat.id,
        },
        select: {
          lastAnalyzedContentCreatedAt: true,
          lastAnalyzedPublishedAt: true,
          lastAnalyzedExternalId: true,
          lastSnapshotId: true,
          completedAt: true,
        },
      });

      console.log("");
      console.log("Source state.");
      console.table([{
        sourceId: storedChat.id,
        title: storedChat.title,
        username: storedChat.username ? `@${storedChat.username}` : "",
        posts,
        comments,
        embeddings,
        formats,
        snapshots,
        sections,
        snapshotSignals,
        snapshotEvidence,
        sourceSignals,
        sourceEvidence,
        pendingSnapshotSignals,
        latestSnapshotId: latestSnapshot?.id,
        latestSnapshotStatus: latestSnapshot?.status,
        latestPipelineStatus: latestPipeline.status,
        latestCurationStatus: latestPipelineCuration.status,
        latestImagesStatus: latestPipelineImages.status,
        latestPeriodFrom: latestSnapshot?.periodFrom?.toISOString(),
        latestPeriodTo: latestSnapshot?.periodTo?.toISOString(),
        analysisContentCreatedAt: analysisState?.lastAnalyzedContentCreatedAt?.toISOString(),
        analysisPublishedAt: analysisState?.lastAnalyzedPublishedAt?.toISOString(),
        analysisExternalId: analysisState?.lastAnalyzedExternalId,
        analysisSnapshotId: analysisState?.lastSnapshotId,
        analysisCompletedAt: analysisState?.completedAt?.toISOString(),
      }]);
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
  .command("format:enqueue")
  .description("Enqueue editorial Markdown formatting for stored posts/comments")
  .argument("<chat>", "Stored chat id, exact title, username, or @username")
  .option("-l, --limit <number>", "Maximum number of content items to format", "50")
  .option("-k, --kind <kind>", "Restrict to kind: post or comment")
  .option("--force", "Reformat even when a format already exists for the current AI model")
  .action(async (
    chat: string,
    options: {
      limit: string;
      kind?: string;
      force?: boolean;
    },
  ) => {
    const limit = parsePositiveInteger(options.limit, "--limit");

    if (options.kind && !["post", "comment"].includes(options.kind)) {
      throw new Error("--kind must be one of: post, comment.");
    }

    const { enqueueContentFormattingJob } = await import("./queue/enqueue.js");
    const job = await enqueueContentFormattingJob({
      chat,
      limit,
      kind: options.kind as "post" | "comment" | undefined,
      skipExisting: !options.force,
    });

    console.log("");
    console.log("Content formatting job enqueued.");
    console.table([{
      queue: "content-formatting",
      jobId: job.id,
      chat,
      limit,
      kind: options.kind ?? "all",
      force: Boolean(options.force),
    }]);
  });

program
  .command("format:run")
  .description("Run editorial Markdown formatting locally without BullMQ")
  .argument("<chat>", "Stored chat id, exact title, username, or @username")
  .option("-l, --limit <number>", "Maximum number of content items to format", "10")
  .option("-k, --kind <kind>", "Restrict to kind: post or comment")
  .option("--force", "Reformat even when a format already exists for the current AI model")
  .action(async (
    chat: string,
    options: {
      limit: string;
      kind?: string;
      force?: boolean;
    },
  ) => {
    const limit = parsePositiveInteger(options.limit, "--limit");

    if (options.kind && !["post", "comment"].includes(options.kind)) {
      throw new Error("--kind must be one of: post, comment.");
    }

    try {
      const storedChat = await findStoredSource(prisma, chat);

      if (!storedChat) {
        throw new Error(`Source not found in database: ${chat}`);
      }

      const { loadAiConfig } = await import("./ai/config.js");
      const { formatContentBatch } = await import("./formatting/contentFormatter.js");
      const result = await formatContentBatch(prisma, loadAiConfig(), {
        sourceId: storedChat.id,
        limit,
        kind: options.kind as "post" | "comment" | undefined,
        skipExisting: !options.force,
      });

      console.log("");
      console.log("Content formatting complete.");
      console.table([{
        chat: storedChat.title,
        kind: options.kind ?? "all",
        ...result,
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("queue:status")
  .description("Show BullMQ queue status")
  .action(async () => {
    const { createQueues } = await import("./queue/queues.js");
    const queues = createQueues();

    try {
      const [importCounts, commentImportCounts, embeddingCounts, formattingCounts, snapshotCounts, snapshotSectionCounts, curationCounts, coverImageCounts, previewImageCounts] = await Promise.all([
        queues.telegramImportQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.commentImportQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.contentEmbeddingQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.contentFormattingQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.sourceSnapshotQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.sourceSnapshotSectionQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.sourceSignalCurationQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.snapshotCoverImageQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        queues.signalPreviewImageQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
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
          queue: "content-formatting",
          ...formattingCounts,
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
        {
          queue: "source-signal-curation",
          ...curationCounts,
        },
        {
          queue: "snapshot-cover-image",
          ...coverImageCounts,
        },
        {
          queue: "signal-preview-image",
          ...previewImageCounts,
        },
      ]);

      const activeJobs = [
        ...await queues.telegramImportQueue.getActive(),
        ...await queues.commentImportQueue.getActive(),
        ...await queues.contentEmbeddingQueue.getActive(),
        ...await queues.contentFormattingQueue.getActive(),
        ...await queues.sourceSnapshotQueue.getActive(),
        ...await queues.sourceSnapshotSectionQueue.getActive(),
        ...await queues.sourceSignalCurationQueue.getActive(),
        ...await queues.snapshotCoverImageQueue.getActive(),
        ...await queues.signalPreviewImageQueue.getActive(),
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
      await queues.contentFormattingQueue.close();
      await queues.sourceSnapshotQueue.close();
      await queues.sourceSnapshotSectionQueue.close();
      await queues.sourceSignalCurationQueue.close();
      await queues.snapshotCoverImageQueue.close();
      await queues.signalPreviewImageQueue.close();
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
          pipeline: initialSnapshotPipeline({
            startedBy: "cli",
            model: process.env.AI_MODEL || "unknown",
          }),
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
  .command("snapshot:summary")
  .description("Run ChannelSummaryAgent and store the top-level channel summary for a completed source snapshot")
  .argument("<target>", "Stored chat id/title/username/@username, or a snapshot id")
  .option("-s, --snapshot-id <snapshotId>", "Use an explicit snapshot id instead of resolving target as a source")
  .option("--verbose", "Print agent logs")
  .action(async (
    target: string,
    options: {
      snapshotId?: string;
      verbose?: boolean;
    },
  ) => {
    try {
      let snapshotId = options.snapshotId;

      if (!snapshotId) {
        const directSnapshot = await prisma.sourceSnapshot.findUnique({
          where: {
            id: target,
          },
          select: {
            id: true,
            source: {
              select: {
                title: true,
              },
            },
          },
        });

        if (directSnapshot) {
          snapshotId = directSnapshot.id;
        } else {
          const storedChat = await findStoredSource(prisma, target);

          if (!storedChat) {
            throw new Error(`Source or snapshot not found in database: ${target}`);
          }

          const latestSnapshot = await prisma.sourceSnapshot.findFirst({
            where: {
              sourceId: storedChat.id,
              kind: "channel_structured_snapshot",
              status: "completed",
            },
            orderBy: {
              createdAt: "desc",
            },
            select: {
              id: true,
            },
          });

          if (!latestSnapshot) {
            throw new Error(`Completed snapshot not found for ${storedChat.title}.`);
          }

          snapshotId = latestSnapshot.id;
        }
      }

      const { loadAiConfig } = await import("./ai/config.js");
      const { generateAndStoreSnapshotSummary } = await import("./snapshots/communitySnapshot.js");
      const result = await generateAndStoreSnapshotSummary(prisma, loadAiConfig(), snapshotId, {
        onLog: options.verbose
          ? (message, meta) => {
              console.error(message, meta ?? {});
            }
          : undefined,
      });

      console.log("");
      console.log("Snapshot channel summary generated.");
      console.table([{
        snapshotId: result.snapshotId,
        sourceId: result.sourceId,
        sourceTitle: result.sourceTitle,
        previousChars: result.previousSummary?.length ?? 0,
        chars: result.summary.length,
      }]);
      console.log(result.summary);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("snapshot:section")
  .description("Re-enqueue one section agent for an existing snapshot")
  .argument("<snapshotId>", "Stored snapshot id")
  .argument("<sectionId>", "Section id: ideas, pains, risks, hypotheses, insights, trends, events, materials, people, tools, places")
  .action(async (snapshotId: string, sectionId: string) => {
    try {
      const { SIGNAL_AGENTS } = await import("./prompts/snapshotAgents.js");
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
  .command("signals:curate")
  .description("Enqueue source-signal curation for a completed source snapshot")
  .argument("<snapshotId>", "Completed source snapshot id")
  .action(async (snapshotId: string) => {
    try {
      const snapshot = await prisma.sourceSnapshot.findUnique({
        where: {
          id: snapshotId,
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      const { enqueueSourceSignalCurationJob } = await import("./queue/enqueue.js");
      const job = await enqueueSourceSignalCurationJob({
        snapshotId,
      });

      console.log("");
      console.log("Source signal curation job enqueued.");
      console.table([{
        queue: "source-signal-curation",
        jobId: job.id,
        snapshotId,
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("signals:curate:run")
  .description("Run source-signal curation synchronously for debugging")
  .argument("<snapshotId>", "Completed source snapshot id")
  .option("-l, --limit <number>", "Process at most N pending snapshot signals")
  .action(async (
    snapshotId: string,
    options: {
      limit?: string;
    },
  ) => {
    try {
      const { curateSnapshotSignalsIntoSource } = await import("./signals/sourceSignalCurator.js");
      const { loadAiConfig } = await import("./ai/config.js");
      const limit = options.limit ? parsePositiveInteger(options.limit, "--limit") : undefined;
      const result = await curateSnapshotSignalsIntoSource(prisma, loadAiConfig(), snapshotId, {
        limit,
        onProgress: (progress) => {
          console.log(`[signals:curate] ${progress.processed}/${progress.total} ${progress.decision} ${progress.signalId}`);
        },
      });

      console.log("");
      console.log("Snapshot signals curated into source signals.");
      console.table([result]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("snapshot:image")
  .description("Generate a fal.ai cover image for a completed snapshot")
  .argument("[snapshotId]", "Stored snapshot id. Defaults to the latest completed snapshot.")
  .action(async (snapshotId: string | undefined) => {
    try {
      const snapshot = await prisma.sourceSnapshot.findFirst({
        where: {
          id: snapshotId,
          status: "completed",
        },
        include: {
          source: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (!snapshot) {
        throw new Error(snapshotId
          ? `Completed channel snapshot not found: ${snapshotId}`
          : "No completed channel snapshots found.");
      }

      const { generateAndStoreSnapshotCoverImage } = await import("./images/snapshotCoverImages.js");
      const result = await generateAndStoreSnapshotCoverImage(prisma, snapshot.id, {
        skipExisting: false,
      });

      if (result.status === "skipped") {
        console.log("");
        console.log("Snapshot cover image skipped.");
        console.table([{
          snapshotId: snapshot.id,
          title: result.title,
          reason: result.reason,
        }]);
        return;
      }

      console.log("");
      console.log("Snapshot cover image generated.");
      console.table([{
        snapshotId: snapshot.id,
        title: result.title,
        model: result.coverImage.model,
        bucket: result.coverImage.bucket,
        objectKey: result.coverImage.objectKey,
        url: result.coverImage.url,
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("signal:image")
  .description("Generate a fal.ai preview image for one snapshot signal id")
  .argument("<signalId>", "SnapshotSignal.externalSignalId")
  .option("-s, --snapshot <snapshotId>", "Restrict lookup to one snapshot id")
  .action(async (
    signalId: string,
    options: {
      snapshot?: string;
    },
  ) => {
    try {
      const snapshotSignal = await prisma.snapshotSignal.findFirst({
        where: {
          snapshotId: options.snapshot,
          externalSignalId: signalId,
          snapshot: {
            status: "completed",
          },
        },
        include: {
          snapshot: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (!snapshotSignal) {
        const scope = options.snapshot ? ` in snapshot ${options.snapshot}` : " in the latest completed snapshots";
        throw new Error(`Signal not found${scope}: ${signalId}`);
      }

      const { generateAndStoreSignalPreviewImage } = await import("./images/signalPreviewImages.js");
      const result = await generateAndStoreSignalPreviewImage(prisma, snapshotSignal.snapshotId, signalId, {
        skipExisting: false,
      });

      if (result.status === "skipped") {
        console.log("");
        console.log("Signal preview image skipped.");
        console.table([{
          snapshotId: snapshotSignal.snapshotId,
          signalId,
          kind: result.kind,
          title: result.title,
          reason: result.reason,
        }]);
        return;
      }

      console.log("");
      console.log("Signal preview image generated.");
      console.table([{
        snapshotId: snapshotSignal.snapshotId,
        signalId,
        kind: result.kind,
        title: result.title,
        model: result.previewImage.model,
        bucket: result.previewImage.bucket,
        objectKey: result.previewImage.objectKey,
        url: result.previewImage.url,
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("snapshot:images:enqueue")
  .description("Enqueue fal.ai preview image jobs for all supported signals without images in a snapshot")
  .argument("<snapshotId>", "Completed source snapshot id")
  .action(async (snapshotId: string) => {
    try {
      const snapshot = await prisma.sourceSnapshot.findUnique({
        where: {
          id: snapshotId,
        },
        select: {
          id: true,
        },
      });

      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      const { canGenerateSignalPreview } = await import("./images/falSignalPreview.js");
      const { enqueueSignalPreviewImageJob } = await import("./queue/enqueue.js");
      const { snapshotSignalsAsDocumentSignals } = await import("./signals/snapshotSignals.js");
      const signals = (await snapshotSignalsAsDocumentSignals(prisma, snapshotId))
        .filter((signal) => canGenerateSignalPreview(signal) && !signal.previewImage?.url);
      const jobs = await Promise.all(signals.map((signal) => enqueueSignalPreviewImageJob({
        snapshotId,
        signalId: signal.id,
      })));

      console.log("");
      console.log("Signal preview image jobs enqueued.");
      console.table([{
        snapshotId,
        enqueued: jobs.length,
        totalSignals: signals.length,
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
  .command("snapshot:timeline")
  .description("Backfill signal timeline fields for normalized snapshot signals")
  .option("-s, --snapshot <snapshotId>", "Restrict backfill to one snapshot id")
  .action(async (options: { snapshot?: string }) => {
    try {
      const snapshots = await prisma.sourceSnapshot.findMany({
        where: {
          id: options.snapshot,
          status: "completed",
        },
        select: {
          id: true,
          sourceId: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      const { enrichSignalsWithTimeline } = await import("./snapshots/signalTimeline.js");
      const { snapshotSignalsAsDocumentSignals } = await import("./signals/snapshotSignals.js");
      let updated = 0;
      let skipped = 0;

      for (const snapshot of snapshots) {
        const currentSignals = await snapshotSignalsAsDocumentSignals(prisma, snapshot.id);

        if (!currentSignals.length) {
          skipped += 1;
          continue;
        }

        const signals = await enrichSignalsWithTimeline(prisma, snapshot.sourceId, currentSignals);

        await Promise.all(signals.map((signal) => prisma.snapshotSignal.updateMany({
          where: {
            snapshotId: snapshot.id,
            externalSignalId: signal.id,
          },
          data: {
            timeline: signal.timeline ? signal.timeline satisfies Prisma.InputJsonValue : Prisma.JsonNull,
          },
        })));
        updated += 1;
      }

      console.log("");
      console.log("Snapshot timelines backfilled.");
      console.table([{
        updated,
        skipped,
        scope: options.snapshot ?? "completed snapshots",
      }]);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("signal:image:prune")
  .description("Remove generated preview metadata from signal kinds that should not have images")
  .option("-s, --snapshot <snapshotId>", "Restrict pruning to one snapshot id")
  .action(async (options: { snapshot?: string }) => {
    try {
      const { canGenerateSignalPreview } = await import("./images/falSignalPreview.js");
      const { snapshotSignalsAsDocumentSignals } = await import("./signals/snapshotSignals.js");
      const snapshots = await prisma.sourceSnapshot.findMany({
        where: {
          id: options.snapshot,
          status: "completed",
        },
        select: {
          id: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      let updatedSnapshots = 0;
      let removedPreviews = 0;

      for (const snapshot of snapshots) {
        const signals = await snapshotSignalsAsDocumentSignals(prisma, snapshot.id);
        const unsupportedSignalIds = signals
          .filter((signal) => !canGenerateSignalPreview(signal) && signal.previewImage?.url)
          .map((signal) => signal.id);

        if (!unsupportedSignalIds.length) {
          continue;
        }

        await prisma.snapshotSignal.updateMany({
          where: {
            snapshotId: snapshot.id,
            externalSignalId: {
              in: unsupportedSignalIds,
            },
          },
          data: {
            previewImage: Prisma.JsonNull,
          },
        });
        removedPreviews += unsupportedSignalIds.length;
        updatedSnapshots += 1;
      }

      console.log("");
      console.log("Signal preview metadata pruned.");
      console.table([{
        updatedSnapshots,
        removedPreviews,
        scope: options.snapshot ?? "completed snapshots",
      }]);
    } finally {
      await prisma.$disconnect();
    }
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

program
  .command("payments:revoke")
  .description("Delete Telegram Stars access for a stored Telegram user")
  .argument("<user>", "Telegram username, @username, or numeric telegram id")
  .option("--product <product>", "Limit to a product, e.g. tools-section")
  .option("--source <sourceId>", "Limit to a source id")
  .option("--status <status>", "Purchase status to delete: paid, pending, or all", "paid")
  .action(async (
    user: string,
    options: {
      product?: string;
      source?: string;
      status: string;
    },
  ) => {
    try {
      const telegramUser = await findTelegramUserByRef(user);

      if (!telegramUser) {
        throw new Error(`Telegram user not found: ${user}`);
      }

      if (!["paid", "pending", "all"].includes(options.status)) {
        throw new Error("--status must be one of: paid, pending, all.");
      }

      const deleteWhere: Prisma.TelegramPurchaseWhereInput = {
        telegramId: telegramUser.telegramId,
        ...(options.product ? { product: options.product } : {}),
        ...(options.source ? { sourceId: options.source } : {}),
        ...(options.status === "all" ? {} : { status: options.status }),
      };
      const purchases = await listTelegramPurchases(deleteWhere);
      const deleted = await prisma.telegramPurchase.deleteMany({
        where: deleteWhere,
      });
      let revokedGrants = 0;

      if (telegramUser.customerId && options.status !== "pending") {
        const affectedSourceIds = [...new Set(purchases.map((purchase) => purchase.sourceId))];

        for (const sourceId of affectedSourceIds) {
          const remainingPaidPurchase = await prisma.telegramPurchase.findFirst({
            where: {
              telegramId: telegramUser.telegramId,
              sourceId,
              status: "paid",
            },
          });

          if (!remainingPaidPurchase) {
            const deletedGrants = await prisma.sourceAccessGrant.deleteMany({
              where: {
                customerId: telegramUser.customerId,
                sourceId,
                provider: "telegram_stars",
              },
            });
            revokedGrants += deletedGrants.count;
          }
        }
      }

      console.log(
        `Revoked ${deleted.count} Telegram receipt(s) and ${revokedGrants} access grant(s) for @${telegramUser.username ?? telegramUser.telegramId.toString()}.`,
      );

      if (purchases.length) {
        printTelegramPurchases(purchases);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("payments:reset-user")
  .description("Delete all payment records and channel access grants for a user")
  .argument("<user>", "Telegram username, @username, or numeric telegram id")
  .option("--dry-run", "Print matching records without deleting them")
  .action(async (
    user: string,
    options: {
      dryRun?: boolean;
    },
  ) => {
    try {
      const telegramUser = await findTelegramUserByRef(user);

      if (!telegramUser) {
        throw new Error(`Telegram user not found: ${user}`);
      }

      const resetWhere: Prisma.TelegramPurchaseWhereInput = {
        OR: [
          { telegramUserId: telegramUser.id },
          { telegramId: telegramUser.telegramId },
        ],
      };
      const paymentWhere: Prisma.PaymentWhereInput = telegramUser.customerId
        ? { customerId: telegramUser.customerId }
        : { provider: "telegram_stars", providerCustomerId: telegramUser.telegramId.toString() };
      const grantWhere: Prisma.SourceAccessGrantWhereInput = telegramUser.customerId
        ? { customerId: telegramUser.customerId }
        : { id: "__missing_customer__" };
      const purchases = await listTelegramPurchases(resetWhere);
      const payments = await listPayments(paymentWhere);
      const grants = await listSourceAccessGrants(grantWhere);
      const displayName = telegramUser.username ? `@${telegramUser.username}` : telegramUser.telegramId.toString();

      if (options.dryRun) {
        console.log(
          `Would reset ${purchases.length} Telegram receipt(s), ${payments.length} payment record(s), and ${grants.length} access grant(s) for ${displayName}.`,
        );
      } else {
        const [deletedGrants, deletedPurchases, deletedPayments] = await prisma.$transaction([
          prisma.sourceAccessGrant.deleteMany({
            where: grantWhere,
          }),
          prisma.telegramPurchase.deleteMany({
            where: resetWhere,
          }),
          prisma.payment.deleteMany({
            where: paymentWhere,
          }),
        ]);

        console.log(
          `Reset ${deletedPurchases.count} Telegram receipt(s), ${deletedPayments.count} payment record(s), and ${deletedGrants.count} access grant(s) for ${displayName}.`,
        );
      }

      if (grants.length) {
        console.log("Access grants:");
        printSourceAccessGrants(grants);
      }

      if (payments.length) {
        console.log("Payments:");
        printPayments(payments);
      }

      if (purchases.length) {
        console.log("Telegram receipts:");
        printTelegramPurchases(purchases);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command("access:backfill")
  .description("Create source access grants from historical paid Telegram Stars receipts")
  .option("--dry-run", "Print grants that would be created without writing them")
  .action(async (options: { dryRun?: boolean }) => {
    try {
      const paidPurchases = await prisma.telegramPurchase.findMany({
        where: {
          status: "paid",
        },
        include: {
          telegramUser: true,
          payment: true,
        },
        orderBy: {
          paidAt: "desc",
        },
      });
      let created = 0;

      for (const purchase of paidPurchases) {
        if (options.dryRun && !purchase.telegramUser.customerId) {
          created += 1;
          continue;
        }

        const customerId = purchase.telegramUser.customerId ?? (await prisma.customer.create({ data: {} })).id;

        if (!purchase.telegramUser.customerId) {
          await prisma.telegramUser.update({
            where: {
              id: purchase.telegramUser.id,
            },
            data: {
              customerId,
            },
          });
        }

        if (options.dryRun) {
          const existing = await prisma.sourceAccessGrant.findFirst({
            where: {
              customerId,
              sourceId: purchase.sourceId,
              scope: "source",
              status: "active",
            },
          });

          if (!existing) {
            created += 1;
          }
          continue;
        }

        await prisma.sourceAccessGrant.upsert({
          where: {
            customerId_sourceId_scope_status: {
              customerId,
              sourceId: purchase.sourceId,
              scope: "source",
              status: "active",
            },
          },
          update: {
            provider: "telegram_stars",
            product: purchase.product,
            paymentId: purchase.paymentId,
            reason: "purchase",
            grantedAt: purchase.paidAt ?? purchase.updatedAt,
            revokedAt: null,
            expiresAt: null,
          },
          create: {
            customerId,
            sourceId: purchase.sourceId,
            scope: "source",
            status: "active",
            provider: "telegram_stars",
            product: purchase.product,
            paymentId: purchase.paymentId,
            reason: "purchase",
            grantedAt: purchase.paidAt ?? purchase.updatedAt,
          },
        });

        created += 1;
      }

      console.log(`${options.dryRun ? "Would backfill" : "Backfilled"} ${created} source access grant(s).`);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

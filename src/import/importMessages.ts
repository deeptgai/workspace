import { Prisma, type Source, type SourceImportState, type PrismaClient } from "@prisma/client";
import type { TelegramClient } from "telegram";
import { Api } from "telegram";
import type { ResolvedDialogEntity } from "../telegram/dialogs.js";
import { getDialogInfo } from "../telegram/dialogs.js";
import { sleep } from "../utils/sleep.js";

export type ImportMode = "sync" | "backfill" | "new";
export type ImportBatchPhase = "backfill" | "new";

export type ImportOptions = {
  mode: ImportMode;
  limit: number;
  batchSize: number;
  sleepMs: number;
  sinceDate?: Date;
};

export type ImportResult = {
  sourceId: string;
  chatTitle: string;
  mode: ImportMode;
  imported: number;
  oldestExternalId: string | null;
  newestExternalId: string | null;
};

export type ImportBatchResult = {
  sourceId: string;
  chatTitle: string;
  mode: ImportMode;
  phase: ImportBatchPhase;
  imported: number;
  reachedEnd: boolean;
  oldestExternalId: string | null;
  newestExternalId: string | null;
};

type SaveMessageBatchOptions = {
  kind?: "post" | "comment";
  parentId?: string | null;
  importState?: Pick<SourceImportState, "oldestExternalId" | "newestExternalId"> | null;
};

const DEFAULT_MESSAGE_LIMIT = 100;
const PROFILE_PHOTO_MAX_BYTES = 32_000;
const CONTENT_IMPORT_SCOPE = "content";

function externalIdToTelegramId(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function minTelegramExternalId(a: string | null, b: number) {
  const current = externalIdToTelegramId(a);
  return current === 0 ? String(b) : String(Math.min(current, b));
}

function maxTelegramExternalId(a: string | null, b: number) {
  return String(Math.max(externalIdToTelegramId(a), b));
}

function filterMessagesSince(messages: Api.Message[], sinceDate?: Date) {
  if (!sinceDate) {
    return {
      messages,
      reachedSinceDate: false,
    };
  }

  const sinceTime = sinceDate.getTime();

  return {
    messages: messages.filter((message) => message.date * 1000 >= sinceTime),
    reachedSinceDate: messages.some((message) => message.date * 1000 < sinceTime),
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === "bigint") {
        return nestedValue.toString();
      }

      return nestedValue;
    }),
  ) as Prisma.InputJsonValue;
}

function getReplyToMessageId(message: Api.Message): number | null {
  const replyTo = message.replyTo;

  if (replyTo instanceof Api.MessageReplyHeader) {
    return replyTo.replyToMsgId ?? null;
  }

  return null;
}

function getSenderTelegramId(message: Api.Message): string | null {
  return message.senderId?.toString() ?? null;
}

function imageDataUrl(buffer: Buffer): string | null {
  if (!buffer.length || buffer.length > PROFILE_PHOTO_MAX_BYTES) {
    return null;
  }

  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function downloadSenderPhoto(client: TelegramClient, sender: Api.User | Api.Channel | Api.Chat) {
  try {
    const photo = await client.downloadProfilePhoto(sender, {
      isBig: false,
    });

    return Buffer.isBuffer(photo) ? imageDataUrl(photo) : null;
  } catch {
    return null;
  }
}

async function getSenderProfile(
  client: TelegramClient,
  message: Api.Message,
  photoBySenderId: Map<string, string | null>,
) {
  try {
    const sender = await message.getSender();

    if (sender instanceof Api.User) {
      const senderId = sender.id.toString();
      const photo = photoBySenderId.has(senderId)
        ? photoBySenderId.get(senderId) ?? null
        : await downloadSenderPhoto(client, sender);

      if (!photoBySenderId.has(senderId)) {
        photoBySenderId.set(senderId, photo);
      }

      return {
        externalId: senderId,
        username: sender.username ?? null,
        firstName: sender.firstName ?? null,
        lastName: sender.lastName ?? null,
        photo,
        isBot: sender.bot ?? null,
      };
    }

    if (sender instanceof Api.Channel || sender instanceof Api.Chat) {
      const senderId = message.senderId?.toString() ?? sender.id.toString();
      const photo = photoBySenderId.has(senderId)
        ? photoBySenderId.get(senderId) ?? null
        : await downloadSenderPhoto(client, sender);

      if (!photoBySenderId.has(senderId)) {
        photoBySenderId.set(senderId, photo);
      }

      return {
        externalId: senderId,
        username: "username" in sender ? sender.username ?? null : null,
        firstName: sender.title ?? null,
        lastName: null,
        photo,
        isBot: null,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function getRawMessageJson(message: Api.Message): Prisma.InputJsonValue {
  const messageWithJson = message as Api.Message & {
    toJSON?: () => unknown;
  };

  return toJsonValue(messageWithJson.toJSON ? messageWithJson.toJSON() : {
    id: message.id,
    date: message.date,
    message: message.message,
    senderId: message.senderId?.toString() ?? null,
    replyTo: getReplyToMessageId(message),
    views: message.views ?? null,
    forwards: message.forwards ?? null,
  });
}

function getReactionKey(reaction: Api.TypeReaction): string {
  if (reaction instanceof Api.ReactionEmoji) {
    return reaction.emoticon;
  }

  if (reaction instanceof Api.ReactionCustomEmoji) {
    return reaction.documentId.toString();
  }

  if (reaction instanceof Api.ReactionPaid) {
    return "paid";
  }

  return "unknown";
}

function getReactionCounts(message: Api.Message): Record<string, number> {
  const reactions = message.reactions;

  if (!(reactions instanceof Api.MessageReactions)) {
    return {};
  }

  return Object.fromEntries(
    reactions.results.map((reactionCount) => [
      getReactionKey(reactionCount.reaction),
      reactionCount.count,
    ]),
  );
}

function getReactionsTotal(message: Api.Message): number {
  return Object.values(getReactionCounts(message)).reduce((sum, count) => sum + count, 0);
}

function getRepliesCount(message: Api.Message): number {
  const replies = message.replies;

  if (!(replies instanceof Api.MessageReplies)) {
    return 0;
  }

  return replies.replies ?? 0;
}

function getHasComments(message: Api.Message): boolean {
  const replies = message.replies;

  if (!(replies instanceof Api.MessageReplies)) {
    return false;
  }

  return replies.comments ?? false;
}

function getCommentsPeerId(message: Api.Message): string | null {
  const replies = message.replies;

  if (!(replies instanceof Api.MessageReplies)) {
    return null;
  }

  return replies.channelId?.toString() ?? null;
}

function getEngagementScore(message: Api.Message): number {
  const views = message.views ?? 0;
  const forwards = message.forwards ?? 0;
  const reactions = getReactionsTotal(message);
  const replies = getRepliesCount(message);

  return reactions + forwards * 2 + replies * 3 + views * 0.01;
}

function getMessageEngagementData(message: Api.Message) {
  const reactionCounts = getReactionCounts(message);

  return {
    reactionsTotal: Object.values(reactionCounts).reduce((sum, count) => sum + count, 0),
    reactionCounts: toJsonValue(reactionCounts),
    repliesCount: getRepliesCount(message),
    hasComments: getHasComments(message),
    commentsPeerId: getCommentsPeerId(message),
    engagementScore: getEngagementScore(message),
  };
}

async function upsertSource(
  prisma: PrismaClient,
  client: TelegramClient,
  entity: ResolvedDialogEntity,
): Promise<Source> {
  const dialog = getDialogInfo(entity);
  const audienceCount = await getSubscriberCount(client, entity);

  return prisma.source.upsert({
    where: {
      provider_externalId: {
        provider: "telegram",
        externalId: dialog.id,
      },
    },
    create: {
      provider: "telegram",
      externalId: dialog.id,
      title: dialog.title,
      username: dialog.username,
      type: dialog.type,
      url: dialog.username ? `https://t.me/${dialog.username}` : null,
      audienceCount,
    },
    update: {
      title: dialog.title,
      username: dialog.username,
      type: dialog.type,
      url: dialog.username ? `https://t.me/${dialog.username}` : null,
      audienceCount,
    },
  });
}

async function getContentImportState(prisma: PrismaClient, source: Source) {
  return prisma.sourceImportState.upsert({
    where: {
      sourceId_scope: {
        sourceId: source.id,
        scope: CONTENT_IMPORT_SCOPE,
      },
    },
    create: {
      sourceId: source.id,
      provider: source.provider,
      scope: CONTENT_IMPORT_SCOPE,
    },
    update: {
      provider: source.provider,
    },
  });
}

async function getSubscriberCount(
  client: TelegramClient,
  entity: ResolvedDialogEntity,
): Promise<number | null> {
  const entityWithCount = entity as { participantsCount?: number };

  if (typeof entityWithCount.participantsCount === "number") {
    return entityWithCount.participantsCount;
  }

  try {
    if (entity instanceof Api.Channel) {
      const result = await client.invoke(new Api.channels.GetFullChannel({
        channel: entity,
      }));
      const fullChat = result.fullChat as { participantsCount?: number };

      return typeof fullChat.participantsCount === "number" ? fullChat.participantsCount : null;
    }

    if (entity instanceof Api.Chat) {
      const result = await client.invoke(new Api.messages.GetFullChat({
        chatId: entity.id,
      }));
      const fullChat = result.fullChat as { participantsCount?: number };

      return typeof fullChat.participantsCount === "number" ? fullChat.participantsCount : null;
    }
  } catch (error) {
    console.warn("Could not load subscriber count:", error instanceof Error ? error.message : error);
  }

  return null;
}

export async function saveMessageBatch(
  prisma: PrismaClient,
  client: TelegramClient,
  chat: Source,
  messages: Api.Message[],
  options: SaveMessageBatchOptions = {},
): Promise<number> {
  if (messages.length === 0) {
    return 0;
  }

  const sortedMessages = [...messages].sort((a, b) => a.id - b.id);
  const senderProfileById = new Map<string, Awaited<ReturnType<typeof getSenderProfile>>>();
  const photoBySenderId = new Map<string, string | null>();

  await prisma.$transaction(async (tx) => {
    for (const message of sortedMessages) {
      const senderTelegramId = getSenderTelegramId(message);
      const senderProfile = senderTelegramId
        ? senderProfileById.get(senderTelegramId) ?? await getSenderProfile(client, message, photoBySenderId)
        : null;

      if (senderTelegramId && !senderProfileById.has(senderTelegramId)) {
        senderProfileById.set(senderTelegramId, senderProfile);
      }

      const user = senderTelegramId
        ? await tx.actor.upsert({
          where: {
            provider_externalId: {
              provider: "telegram",
              externalId: senderTelegramId,
            },
          },
          create: {
            provider: "telegram",
            externalId: senderTelegramId,
            username: senderProfile?.username ?? null,
            displayName: ([senderProfile?.firstName, senderProfile?.lastName].filter(Boolean).join(" ") || senderProfile?.username) ?? null,
            firstName: senderProfile?.firstName ?? null,
            lastName: senderProfile?.lastName ?? null,
            url: senderProfile?.username ? `https://t.me/${senderProfile.username}` : null,
            photo: senderProfile?.photo ?? null,
            isBot: senderProfile?.isBot ?? null,
          },
          update: {
            username: senderProfile?.username ?? undefined,
            displayName: ([senderProfile?.firstName, senderProfile?.lastName].filter(Boolean).join(" ") || senderProfile?.username) ?? undefined,
            firstName: senderProfile?.firstName ?? undefined,
            lastName: senderProfile?.lastName ?? undefined,
            url: senderProfile?.username ? `https://t.me/${senderProfile.username}` : undefined,
            photo: senderProfile?.photo ?? undefined,
            isBot: senderProfile?.isBot ?? undefined,
          },
        })
        : null;

      const engagementData = getMessageEngagementData(message);
      await tx.contentItem.upsert({
        where: {
          provider_sourceId_externalId_kind: {
            provider: "telegram",
            sourceId: chat.id,
            externalId: String(message.id),
            kind: options.kind ?? "post",
          },
        },
        create: {
          provider: "telegram",
          externalId: String(message.id),
          sourceId: chat.id,
          kind: options.kind ?? "post",
          parentId: options.parentId ?? null,
          actorId: user?.id ?? null,
          text: message.message || null,
          publishedAt: new Date(message.date * 1000),
          replyToExternalId: getReplyToMessageId(message)?.toString() ?? null,
          views: message.views ?? null,
          forwards: message.forwards ?? null,
          reactionsTotal: engagementData.reactionsTotal,
          reactionCounts: engagementData.reactionCounts,
          repliesCount: engagementData.repliesCount,
          hasComments: engagementData.hasComments,
          commentsPeerId: engagementData.commentsPeerId,
          engagementScore: engagementData.engagementScore,
          rawJson: getRawMessageJson(message),
        },
        update: {
          parentId: options.parentId ?? null,
          actorId: user?.id ?? null,
          text: message.message || null,
          publishedAt: new Date(message.date * 1000),
          replyToExternalId: getReplyToMessageId(message)?.toString() ?? null,
          views: message.views ?? null,
          forwards: message.forwards ?? null,
          reactionsTotal: engagementData.reactionsTotal,
          reactionCounts: engagementData.reactionCounts,
          repliesCount: engagementData.repliesCount,
          hasComments: engagementData.hasComments,
          commentsPeerId: engagementData.commentsPeerId,
          engagementScore: engagementData.engagementScore,
          rawJson: getRawMessageJson(message),
        },
      });
    }

    if ((options.kind ?? "post") === "post") {
      const minId = Math.min(...sortedMessages.map((message) => message.id));
      const maxId = Math.max(...sortedMessages.map((message) => message.id));

      const oldestExternalId = minTelegramExternalId(options.importState?.oldestExternalId ?? null, minId);
      const newestExternalId = maxTelegramExternalId(options.importState?.newestExternalId ?? null, maxId);

      await tx.sourceImportState.upsert({
        where: {
          sourceId_scope: {
            sourceId: chat.id,
            scope: CONTENT_IMPORT_SCOPE,
          },
        },
        create: {
          sourceId: chat.id,
          provider: chat.provider,
          scope: CONTENT_IMPORT_SCOPE,
          oldestExternalId,
          newestExternalId,
          lastImportAt: new Date(),
        },
        update: {
          oldestExternalId,
          newestExternalId,
          lastImportAt: new Date(),
        },
      });

      await tx.source.update({
        where: {
          id: chat.id,
        },
        data: {
          lastImportAt: new Date(),
        },
      });

      if (options.importState) {
        options.importState.oldestExternalId = oldestExternalId;
        options.importState.newestExternalId = newestExternalId;
      }
    }
  });

  return sortedMessages.length;
}

async function importBackfillBatch(
  prisma: PrismaClient,
  client: TelegramClient,
  entity: ResolvedDialogEntity,
  chat: Source,
  importState: Pick<SourceImportState, "oldestExternalId" | "newestExternalId">,
  batchSize: number,
  sinceDate?: Date,
): Promise<Pick<ImportBatchResult, "imported" | "reachedEnd">> {
  const offsetId = externalIdToTelegramId(importState.oldestExternalId);
  const messages = await client.getMessages(entity, {
    limit: batchSize,
    offsetId,
  });
  const realMessages = messages.filter((message): message is Api.Message => message instanceof Api.Message);
  const filtered = filterMessagesSince(realMessages, sinceDate);

  return {
    imported: await saveMessageBatch(prisma, client, chat, filtered.messages, { importState }),
    reachedEnd: realMessages.length === 0 || filtered.reachedSinceDate,
  };
}

async function importNewBatch(
  prisma: PrismaClient,
  client: TelegramClient,
  entity: ResolvedDialogEntity,
  chat: Source,
  importState: Pick<SourceImportState, "oldestExternalId" | "newestExternalId">,
  batchSize: number,
  sinceDate?: Date,
): Promise<Pick<ImportBatchResult, "imported" | "reachedEnd">> {
  const minId = externalIdToTelegramId(importState.newestExternalId);
  const messages = await client.getMessages(entity, {
    limit: batchSize,
    minId,
    reverse: true,
  });
  const realMessages = messages.filter((message): message is Api.Message => message instanceof Api.Message);
  const filtered = filterMessagesSince(realMessages, sinceDate);

  return {
    imported: await saveMessageBatch(prisma, client, chat, filtered.messages, { importState }),
    reachedEnd: realMessages.length === 0 || filtered.reachedSinceDate,
  };
}

async function runMode(
  prisma: PrismaClient,
  client: TelegramClient,
  entity: ResolvedDialogEntity,
  chat: Source,
  importState: Pick<SourceImportState, "oldestExternalId" | "newestExternalId">,
  options: Omit<ImportOptions, "mode"> & { mode: "backfill" | "new" },
): Promise<number> {
  let imported = 0;

  while (imported < options.limit) {
    const remaining = options.limit - imported;
    const batchSize = Math.min(options.batchSize, remaining);
    const result = options.mode === "new"
      ? await importNewBatch(prisma, client, entity, chat, importState, batchSize, options.sinceDate)
      : await importBackfillBatch(prisma, client, entity, chat, importState, batchSize, options.sinceDate);

    if (result.imported === 0) {
      break;
    }

    imported += result.imported;
    console.log(
      `Imported ${imported}/${options.limit}; oldest=${importState.oldestExternalId ?? "-"} newest=${importState.newestExternalId ?? "-"}`,
    );

    if (result.reachedEnd || imported >= options.limit) {
      break;
    }

    await sleep(options.sleepMs);
  }

  return imported;
}

export async function importMessages(
  prisma: PrismaClient,
  client: TelegramClient,
  entity: ResolvedDialogEntity,
  options: ImportOptions,
): Promise<ImportResult> {
  const chat = await upsertSource(prisma, client, entity);
  const importState = await getContentImportState(prisma, chat);
  const normalizedOptions = {
    mode: options.mode,
    limit: Math.max(options.limit, 0) || DEFAULT_MESSAGE_LIMIT,
    batchSize: Math.max(options.batchSize, 1),
    sleepMs: Math.max(options.sleepMs, 0),
  };

  let imported = 0;

  if (normalizedOptions.mode === "sync" || normalizedOptions.mode === "new") {
    imported += await runMode(prisma, client, entity, chat, importState, {
      ...normalizedOptions,
      mode: "new",
    });
  }

  if (normalizedOptions.mode === "sync" || normalizedOptions.mode === "backfill") {
    const remainingLimit = normalizedOptions.limit - imported;

    if (remainingLimit > 0) {
      imported += await runMode(prisma, client, entity, chat, importState, {
        ...normalizedOptions,
        limit: remainingLimit,
        mode: "backfill",
      });
    }
  }

  const refreshedChat = await prisma.source.findUniqueOrThrow({
    where: {
      id: chat.id,
    },
  });
  const refreshedImportState = await getContentImportState(prisma, refreshedChat);

  return {
    sourceId: refreshedChat.id,
    chatTitle: refreshedChat.title,
    mode: options.mode,
    imported,
    oldestExternalId: refreshedImportState.oldestExternalId,
    newestExternalId: refreshedImportState.newestExternalId,
  };
}

export async function importMessageBatch(
  prisma: PrismaClient,
  client: TelegramClient,
  entity: ResolvedDialogEntity,
  options: ImportOptions & { phase: ImportBatchPhase },
): Promise<ImportBatchResult> {
  const chat = await upsertSource(prisma, client, entity);
  const importState = await getContentImportState(prisma, chat);
  const normalizedBatchSize = Math.max(Math.min(options.batchSize, options.limit), 1);
  const result = options.phase === "new"
    ? await importNewBatch(prisma, client, entity, chat, importState, normalizedBatchSize, options.sinceDate)
    : await importBackfillBatch(prisma, client, entity, chat, importState, normalizedBatchSize, options.sinceDate);
  const refreshedChat = await prisma.source.findUniqueOrThrow({
    where: {
      id: chat.id,
    },
  });
  const refreshedImportState = await getContentImportState(prisma, refreshedChat);

  return {
    sourceId: refreshedChat.id,
    chatTitle: refreshedChat.title,
    mode: options.mode,
    phase: options.phase,
    imported: result.imported,
    reachedEnd: result.reachedEnd,
    oldestExternalId: refreshedImportState.oldestExternalId,
    newestExternalId: refreshedImportState.newestExternalId,
  };
}

import type { PrismaClient } from "@prisma/client";
import type { TelegramClient } from "telegram";
import { Api } from "telegram";
import type { ResolvedDialogEntity } from "../telegram/dialogs.js";
import { saveMessageBatch } from "./importMessages.js";

export type ImportCommentsOptions = {
  postLimit: number;
  commentsPerPost: number;
  mode: "sync" | "new";
};

export type ImportCommentsResult = {
  sourceId: string;
  scannedPosts: number;
  imported: number;
  skippedPosts: number;
};

function externalIdToTelegramId(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function importChannelComments(
  prisma: PrismaClient,
  client: TelegramClient,
  entity: ResolvedDialogEntity,
  sourceId: string,
  options: ImportCommentsOptions,
): Promise<ImportCommentsResult> {
  const chat = await prisma.source.findUnique({
    where: {
      id: sourceId,
    },
  });

  if (!chat) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  const posts = await prisma.contentItem.findMany({
    where: {
      sourceId,
      kind: "post",
      hasComments: true,
      repliesCount: {
        gt: 0,
      },
    },
    orderBy: {
      publishedAt: "desc",
    },
    take: options.postLimit,
    select: {
      id: true,
      externalId: true,
      repliesCount: true,
    },
  });

  let imported = 0;
  let skippedPosts = 0;

  for (const post of posts) {
    const newestExistingComment = options.mode === "new"
      ? await prisma.contentItem.findFirst({
          where: {
            sourceId,
            kind: "comment",
            parentId: post.id,
          },
          orderBy: {
            publishedAt: "desc",
          },
          select: {
            externalId: true,
          },
        })
      : null;

    try {
      const replyTo = externalIdToTelegramId(post.externalId);
      const minId = externalIdToTelegramId(newestExistingComment?.externalId);
      const messages = await client.getMessages(entity, {
        replyTo,
        limit: Math.min(options.commentsPerPost, post.repliesCount),
        ...(newestExistingComment
          ? {
              minId,
              reverse: true,
            }
          : {}),
      });
      const comments = messages.filter((message): message is Api.Message => (
        message instanceof Api.Message &&
        Boolean(message.message?.trim())
      ));

      imported += await saveMessageBatch(prisma, client, chat, comments, {
        kind: "comment",
        parentId: post.id,
      });
    } catch (error) {
      skippedPosts += 1;
      console.warn(
        `[comment-import] skipped post ${post.externalId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    sourceId,
    scannedPosts: posts.length,
    imported,
    skippedPosts,
  };
}
